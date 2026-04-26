"""Fast per-monitor capture using dxcam one-shot grab — long-lived thread."""

import logging
import time

import numpy as np
from PySide6.QtCore import QThread, Signal

logger = logging.getLogger(__name__)


class ScreenCapture(QThread):
    """Long-lived capture thread. Idles when inactive, captures when active.

    Uses dxcam's one-shot grab() instead of continuous mode. Each grab()
    makes a fresh Desktop Duplication acquisition — no internal thread,
    no ring buffer that can go stale on static screens.
    """

    monitors_captured = Signal(list, int, int, float)
    capture_mode = Signal(str)

    def __init__(self, config, frame_store=None, target_fps: int = 30):
        super().__init__()
        self.config = config
        self._frame_store = frame_store
        self.target_fps = target_fps
        self._active = False
        self._alive = True

    def set_active(self, active: bool):
        self._active = active

    def shutdown(self):
        self._active = False
        self._alive = False

    def run(self):
        import mss as mss_lib

        frame_interval = 1.0 / self.target_fps

        # Get virtual desktop + physical monitors from mss (one-time)
        with mss_lib.mss() as sct:
            vd = sct.monitors[0]
            vd_left, vd_top = vd["left"], vd["top"]
            mss_mons = [dict(m) for m in sct.monitors[1:]]

            mss_patches = []
            for m in mss_mons:
                raw = sct.grab(m)
                patch = np.array(raw)[:50, :50, :3].astype(float)
                mss_patches.append((m, patch))

        # Initialize dxcam cameras (one-time, no continuous mode)
        cameras = self._init_dxcam(mss_mons, mss_patches)
        use_mss = cameras is None

        if use_mss:
            logger.warning("No dxcam cameras — will use mss fallback")

        logger.info("ScreenCapture thread started (idle, target %d FPS)", self.target_fps)

        # mss context for fallback (kept open for thread lifetime)
        mss_sct = None
        if use_mss:
            import mss as mss_lib2
            mss_sct = mss_lib2.mss()

        while self._alive:
            if not self._active:
                time.sleep(0.05)
                continue

            t0 = time.perf_counter()
            screenshots = []

            if use_mss:
                # mss fallback
                for mon in mss_mons:
                    try:
                        raw = mss_sct.grab(mon)
                        frame = np.array(raw, dtype=np.uint8)
                        screenshots.append((frame, mon))
                    except Exception as e:
                        logger.warning("mss grab failed: %s", e)
            else:
                # dxcam one-shot grab — fresh acquisition each time
                for c in cameras:
                    try:
                        f = c["cam"].grab()
                        if f is not None:
                            screenshots.append((f, c["mon"]))
                    except Exception as e:
                        logger.warning("dxcam[%d] grab failed: %s", c["idx"], e)

            if screenshots:
                if self._frame_store:
                    self._frame_store.update(screenshots, vd_left, vd_top)
                self.monitors_captured.emit(
                    screenshots, vd_left, vd_top, time.perf_counter()
                )

            elapsed = time.perf_counter() - t0
            if elapsed < frame_interval:
                time.sleep(frame_interval - elapsed)

        # Cleanup
        if mss_sct:
            mss_sct.close()
        logger.info("ScreenCapture thread stopped")

    def _init_dxcam(self, mss_mons, mss_patches):
        """Create dxcam camera objects (one per monitor). No continuous mode."""
        cameras = []
        try:
            import dxcam

            for idx in range(len(mss_mons)):
                try:
                    cam = dxcam.create(output_idx=idx, output_color="BGR")
                    f = cam.grab()
                    if f is None:
                        del cam
                        continue

                    dx_patch = f[:50, :50].astype(float)
                    best_mon, best_diff = None, float("inf")
                    for m, mp in mss_patches:
                        diff = np.mean(np.abs(dx_patch - mp))
                        if diff < best_diff:
                            best_diff = diff
                            best_mon = m

                    if best_mon:
                        cameras.append({"cam": cam, "mon": best_mon, "idx": idx})
                        logger.info("dxcam[%d] -> (%d,%d) %dx%d",
                                    idx, best_mon["left"], best_mon["top"],
                                    best_mon["width"], best_mon["height"])
                    else:
                        del cam
                except Exception as e:
                    logger.warning("dxcam[%d] failed: %s", idx, e)
        except ImportError:
            logger.warning("dxcam not available")
        except Exception as e:
            logger.warning("dxcam init failed: %s", e)

        return cameras if cameras else None
