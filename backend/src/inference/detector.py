"""Per-monitor ONNX inference — long-lived thread, pull-based."""

import logging
import time
from pathlib import Path

import cv2
import numpy as np
from PySide6.QtCore import QThread, Signal

from ..config import SharedConfig
from .preprocessor import preprocess_frame
from .postprocessor import postprocess_output

logger = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).parent.parent.parent / "models" / "640m.onnx"


class InferenceThread(QThread):
    """Long-lived inference thread. ONNX session initialized once, reused across
    start/stop cycles. Idles when inactive, processes when active.
    """

    detections_ready = Signal(list, float)
    status_update = Signal(float, int)

    def __init__(self, config: SharedConfig, frame_store=None, detection_store=None):
        super().__init__()
        self.config = config
        self._frame_store = frame_store
        self._detection_store = detection_store
        self._active = False
        self._alive = True
        self._session = None
        self._has_cuda = False
        self._last_seq = 0
        self._fps_timestamps: list[float] = []
        self._consecutive_failures = 0

    def set_active(self, active: bool):
        self._active = active
        if active and self._frame_store:
            self._frame_store.wake()  # Unblock get_if_new if waiting

    def shutdown(self):
        self._active = False
        self._alive = False
        if self._frame_store:
            self._frame_store.wake()

    def _init_session(self):
        import onnxruntime as ort

        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

        available = ort.get_available_providers()
        logger.info("Available ONNX providers: %s", available)

        providers = []
        if "CUDAExecutionProvider" in available:
            providers.append(("CUDAExecutionProvider", {"device_id": 0}))
            self._has_cuda = True
        if not self._has_cuda:
            logger.warning(
                "CUDAExecutionProvider NOT available. Using DirectML (slower). "
                "To fix: pip install nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 "
                "nvidia-cudnn-cu12 nvidia-cufft-cu12 nvidia-curand-cu12"
            )
        if "DmlExecutionProvider" in available:
            providers.append("DmlExecutionProvider")
        providers.append("CPUExecutionProvider")

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if not self._has_cuda:
            opts.intra_op_num_threads = 4

        self._session = ort.InferenceSession(str(MODEL_PATH), sess_options=opts, providers=providers)
        active = self._session.get_providers()
        logger.info("Active ONNX providers: %s", active)

        if self._has_cuda:
            logger.info("Using CUDA — full GPU acceleration")
        elif "DmlExecutionProvider" in active:
            logger.info("Using DirectML — frames will be downscaled for performance")
        else:
            logger.warning("Using CPU only — performance will be very limited")

        inp = self._session.get_inputs()[0].name
        self._session.run(None, {inp: np.zeros((1, 3, 640, 640), dtype=np.float32)})
        logger.info("ONNX session ready")

    def run(self):
        logger.info("Inference thread starting")

        try:
            self._init_session()
        except Exception as e:
            logger.error("Failed to init ONNX: %s", e)
            return

        input_name = self._session.get_inputs()[0].name
        _cfg_version = -1
        _cfg = None
        enabled = set()
        scale = 1 if self._has_cuda else 2

        while self._alive:
            # --- Idle when inactive ---
            if not self._active:
                time.sleep(0.05)
                continue

            try:
                if self._frame_store is None:
                    time.sleep(0.1)
                    continue

                frame_data, self._last_seq = self._frame_store.get_if_new(
                    self._last_seq, timeout=0.5
                )
                if frame_data is None:
                    continue
                if not self._active:
                    continue

                screenshots, vd_left, vd_top = frame_data
                timestamp = time.perf_counter()

                new_cfg, _cfg_version = self.config.get_if_changed(_cfg_version)
                if new_cfg is not None:
                    _cfg = new_cfg
                    enabled = set(_cfg.censor.enabled_classes)
                if _cfg is None:
                    continue
                if not enabled:
                    continue

                all_batches = []
                all_crop_infos = []

                for mon_idx, (frame_raw, monitor) in enumerate(screenshots):
                    frame_bgr = frame_raw[:, :, :3] if frame_raw.shape[2] == 4 else frame_raw

                    if scale > 1:
                        h, w = frame_bgr.shape[:2]
                        frame_bgr = cv2.resize(frame_bgr, (w // scale, h // scale),
                                               interpolation=cv2.INTER_LINEAR)

                    batch, crop_infos = preprocess_frame(frame_bgr, target_size=640)

                    mon_offset_x = monitor["left"] - vd_left
                    mon_offset_y = monitor["top"] - vd_top

                    for ci in crop_infos:
                        ci["_mon_offset_x"] = mon_offset_x
                        ci["_mon_offset_y"] = mon_offset_y
                        ci["_mon_idx"] = mon_idx
                        ci["_scale"] = scale

                    all_batches.append(batch)
                    all_crop_infos.extend(crop_infos)

                if not all_batches:
                    self.detections_ready.emit([], timestamp)
                    continue

                mega_batch = np.concatenate(all_batches, axis=0)

                t_infer = time.perf_counter()
                try:
                    output = self._session.run(None, {input_name: mega_batch})[0]
                except Exception as e:
                    self._consecutive_failures += 1
                    logger.error("Inference failed (%d consecutive): %s",
                                 self._consecutive_failures, e)
                    if self._consecutive_failures >= 3:
                        logger.error("Too many failures. Reinitializing ONNX session...")
                        try:
                            self._init_session()
                            input_name = self._session.get_inputs()[0].name
                            self._consecutive_failures = 0
                        except Exception as reinit_err:
                            logger.error("ONNX reinit failed: %s", reinit_err)
                            time.sleep(1.0)
                    continue

                self._consecutive_failures = 0
                infer_time = time.perf_counter() - t_infer
                if infer_time > 2.0:
                    logger.warning("Inference took %.1fs — possible GPU stall", infer_time)

                all_detections = []
                total_dets = 0
                crop_start = 0

                for mon_idx, (frame_raw, monitor) in enumerate(screenshots):
                    mon_crops = [ci for ci in all_crop_infos if ci.get("_mon_idx") == mon_idx]
                    n_crops = len(mon_crops)
                    if n_crops == 0:
                        continue

                    mon_output = output[crop_start:crop_start + n_crops]
                    crop_start += n_crops

                    mon_offset_x = monitor["left"] - vd_left
                    mon_offset_y = monitor["top"] - vd_top

                    detections = postprocess_output(
                        mon_output, mon_crops,
                        enabled_classes=enabled,
                        confidence_threshold=_cfg.censor.confidence_threshold,
                        monitor_offset_x=mon_offset_x,
                        monitor_offset_y=mon_offset_y,
                        master_size=_cfg.censor.master_size,
                        per_category_size=_cfg.censor.per_category_size,
                    )

                    if scale > 1:
                        for det in detections:
                            det.x = int(det.x * scale)
                            det.y = int(det.y * scale)
                            det.w = int(det.w * scale)
                            det.h = int(det.h * scale)

                    all_detections.extend(detections)
                    total_dets += len(detections)

                if self._detection_store:
                    self._detection_store.update(all_detections, timestamp)
                self.detections_ready.emit(all_detections, timestamp)

                # Diagnostic hook
                from ..diagnostics import DIAG_ENABLED, log_detections
                if DIAG_ENABLED:
                    log_detections(all_detections, self._last_seq, infer_time * 1000)

                now = time.perf_counter()
                self._fps_timestamps.append(now)
                self._fps_timestamps = [t for t in self._fps_timestamps if t > now - 1.0]
                self.status_update.emit(float(len(self._fps_timestamps)), total_dets)

            except Exception as e:
                logger.error("Inference error: %s", e, exc_info=True)

        logger.info("Inference thread stopped")
