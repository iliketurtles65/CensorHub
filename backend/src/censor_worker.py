"""Single-threaded censor pipeline: capture → detect → render → emit.

Combines capture, inference, and mosaic rendering in one thread to eliminate
inter-thread signal latency. Emits pre-rendered ARGB arrays directly to overlay.
"""

import logging
import time
from pathlib import Path

import cv2
import numpy as np
from PySide6.QtCore import QThread, Signal

from .config import SharedConfig
from .inference.preprocessor import preprocess_frame
from .inference.postprocessor import postprocess_output
from .overlay.censor_effects import apply_mosaic, apply_blur, apply_black_box, apply_pixelation

logger = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).parent.parent / "models" / "640m.onnx"

EFFECT_MAP = {
    "mosaic": apply_mosaic,
    "blur": apply_blur,
    "black_box": apply_black_box,
    "pixelation": apply_pixelation,
}


class CensorWorker(QThread):
    """All-in-one censor pipeline running in a single thread.

    capture (mss) → preprocess → infer (ONNX) → postprocess → render mosaic → emit

    One thread, one signal, no inter-thread latency.
    """

    # list of (argb_bytes, w, h, abs_x, abs_y)
    frame_ready = Signal(list)
    status_update = Signal(float, int)  # fps, detection_count

    def __init__(self, config: SharedConfig):
        super().__init__()
        self.config = config
        self._running = False

    def run(self):
        import mss as mss_lib
        import onnxruntime as ort

        self._running = True

        # --- Init ONNX ---
        if not MODEL_PATH.exists():
            logger.error("Model not found: %s", MODEL_PATH)
            return

        providers = []
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            providers.append(("CUDAExecutionProvider", {"device_id": 0}))
        if "DmlExecutionProvider" in available:
            providers.append("DmlExecutionProvider")
        providers.append("CPUExecutionProvider")

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = 4

        session = ort.InferenceSession(str(MODEL_PATH), sess_options=opts, providers=providers)
        input_name = session.get_inputs()[0].name
        logger.info("ONNX providers: %s", session.get_providers())

        # Warmup
        session.run(None, {input_name: np.zeros((1, 3, 640, 640), dtype=np.float32)})

        # --- Init capture ---
        sct = mss_lib.mss()
        vd = sct.monitors[0]
        vd_left, vd_top = vd["left"], vd["top"]
        monitors = [dict(m) for m in sct.monitors[1:]]

        logger.info("Virtual desktop: %dx%d at (%d,%d), %d monitors",
                     vd["width"], vd["height"], vd_left, vd_top, len(monitors))

        fps_times: list[float] = []

        # --- Main loop ---
        try:
            while self._running:
                cfg = self.config.get()
                if not cfg.censor_active:
                    time.sleep(0.05)
                    continue

                enabled = set(cfg.censor.enabled_classes)
                if not enabled:
                    time.sleep(0.05)
                    continue

                t_start = time.perf_counter()
                all_mosaics = []
                total_dets = 0

                # --- Capture + detect + render per monitor ---
                for monitor in monitors:
                    # Capture this monitor
                    raw = sct.grab(monitor)
                    frame = np.array(raw, dtype=np.uint8)  # BGRA
                    frame_bgr = frame[:, :, :3]

                    mon_off_x = monitor["left"] - vd_left
                    mon_off_y = monitor["top"] - vd_top

                    # Preprocess
                    batch, crop_infos = preprocess_frame(frame_bgr, target_size=640)

                    # Infer
                    output = session.run(None, {input_name: batch})[0]

                    # Postprocess
                    detections = postprocess_output(
                        output, crop_infos,
                        enabled_classes=enabled,
                        confidence_threshold=cfg.censor.confidence_threshold,
                        monitor_offset_x=mon_off_x,
                        monitor_offset_y=mon_off_y,
                        master_size=cfg.censor.master_size,
                    )
                    total_dets += len(detections)

                    # Render each detection
                    censor_type = cfg.censor.censor_type
                    intensity = cfg.censor.intensity
                    effect_fn = EFFECT_MAP.get(censor_type, apply_mosaic)

                    for det in detections:
                        local_x = det.x - mon_off_x
                        local_y = det.y - mon_off_y
                        fh, fw = frame_bgr.shape[:2]

                        x1 = max(0, local_x)
                        y1 = max(0, local_y)
                        x2 = min(fw, local_x + det.w)
                        y2 = min(fh, local_y + det.h)
                        if x2 <= x1 or y2 <= y1:
                            continue

                        region = frame_bgr[y1:y2, x1:x2]
                        censored = effect_fn(region, intensity)

                        ch, cw = censored.shape[:2]
                        argb = np.empty((ch, cw, 4), dtype=np.uint8)
                        argb[:, :, 0] = censored[:, :, 0]
                        argb[:, :, 1] = censored[:, :, 1]
                        argb[:, :, 2] = censored[:, :, 2]
                        argb[:, :, 3] = 255

                        # Store as bytes to prevent GC issues with QImage
                        all_mosaics.append((argb.tobytes(), cw, ch, det.x, det.y))

                # --- Emit only when detections found ---
                # Skip empty frames to prevent rhythmic on/off flicker.
                # Overlay has a timeout to clear stale mosaics.
                if all_mosaics:
                    self.frame_ready.emit(all_mosaics)

                # FPS
                now = time.perf_counter()
                fps_times.append(now)
                fps_times = [t for t in fps_times if t > now - 1.0]
                dt = now - t_start
                self.status_update.emit(float(len(fps_times)), total_dets)

                if dt < 0.01:
                    time.sleep(0.01 - dt)

        except Exception as e:
            if self._running:
                logger.error("Worker error: %s", e, exc_info=True)
        finally:
            sct.close()
            logger.info("Worker stopped")

    def stop(self):
        self._running = False
        self.wait(5000)
