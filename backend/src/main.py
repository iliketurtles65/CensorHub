"""Entry point for the censorship engine backend."""

import ctypes
import importlib.util
import os
import logging
import sys
import signal


def _register_cuda_dlls():
    """Register NVIDIA pip-package DLL directories so onnxruntime finds CUDA."""
    for pkg in ['nvidia.cuda_runtime', 'nvidia.cublas', 'nvidia.cudnn',
                'nvidia.cufft', 'nvidia.curand']:
        try:
            spec = importlib.util.find_spec(pkg)
            if spec and spec.submodule_search_locations:
                for loc in spec.submodule_search_locations:
                    for sub in ('lib', 'bin', ''):
                        p = os.path.join(loc, sub) if sub else loc
                        if os.path.isdir(p):
                            os.add_dll_directory(p)
        except Exception:
            pass


_register_cuda_dlls()

os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "0"

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
try:
    ctypes.windll.user32.SetProcessDPIAware()
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("censor")


def main():
    import os as _os
    from pathlib import Path as _Path
    from .config import SharedConfig
    from .overlay.asset_store import AssetStore
    from .ws_server import ServerThread

    config = SharedConfig()
    logger.info("Configuration loaded")

    _data_root = _Path(__file__).parent.parent / "data" / "assets" / "images"
    asset_store = AssetStore(_data_root)
    try:
        asset_store.load_existing(config.get().image_assets)
        logger.info("Asset store ready at %s (%d assets)", _data_root, len(config.get().image_assets))
    except Exception as e:
        logger.warning("Asset preload failed: %s", e)

    server = ServerThread(config, host="127.0.0.1", port=9099, asset_store=asset_store)
    server.start()
    logger.info("WebSocket server starting on ws://127.0.0.1:9099/ws")

    from PySide6.QtWidgets import QApplication
    from PySide6.QtCore import QTimer, Signal, QObject

    from .overlay.overlay_window import OverlayWindow
    from .capture.screen_capture import ScreenCapture
    from .capture.frame_buffer import SharedFrameStore, SharedDetectionStore
    from .inference.detector import InferenceThread
    from .tracking.tracker import TrackerThread
    from .overlay.render_worker import RenderWorker

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    # Shared stores — persist for entire app lifetime
    frame_store = SharedFrameStore()
    detection_store = SharedDetectionStore()

    # Create all long-lived threads ONCE
    render_worker = RenderWorker(frame_store, asset_store=asset_store)
    overlay = OverlayWindow(config, frame_store, render_worker)
    capture = ScreenCapture(config, frame_store, target_fps=60)
    inference = InferenceThread(config, frame_store, detection_store)
    tracker = TrackerThread(config, detection_store)

    # Wire signals ONCE — never reconnected
    tracker.smoothed_ready.connect(overlay.update_tracked)
    inference.status_update.connect(on_status_update := (lambda fps, det_count: None))
    render_worker.render_done.connect(overlay._on_render_done)

    _active_flag = [False]

    def _on_status_update(fps, det_count):
        if server.app:
            status = server.app.state.status_data
            status["fps"] = round(fps, 1)
            status["detections"] = det_count
            status["active"] = _active_flag[0]

    # Reconnect with the real handler (the lambda above was a placeholder)
    inference.status_update.disconnect()
    inference.status_update.connect(_on_status_update)

    # Start all threads ONCE — they idle until activated
    render_worker.start()
    inference.start()
    tracker.start()
    capture.start()

    # Thread-safe bridge for overlay show/hide (safe to emit from any thread)
    class OverlayBridge(QObject):
        request_show = Signal()
        request_hide = Signal()

    bridge = OverlayBridge()
    bridge.request_show.connect(overlay.show_overlay)
    bridge.request_hide.connect(overlay.hide_overlay)

    def on_config_change(cfg):
        """Called from WebSocket server thread — must be thread-safe.

        Only uses set_active() (flag assignment) and signal.emit() — both
        are safe from any thread. No QTimer, no thread creation.
        """
        active = cfg.censor_active
        _active_flag[0] = active
        capture.set_active(active)
        inference.set_active(active)
        tracker.set_active(active)
        render_worker.set_active(active)
        if active:
            bridge.request_show.emit()
        else:
            bridge.request_hide.emit()

    config.add_listener(on_config_change)

    def cleanup():
        capture.shutdown()
        inference.shutdown()
        tracker.shutdown()
        render_worker.shutdown()

    app.aboutToQuit.connect(cleanup)

    signal.signal(signal.SIGINT, lambda *_: app.quit())
    tick = QTimer()
    tick.timeout.connect(lambda: None)
    tick.start(100)

    logger.info("Backend ready. Waiting for frontend connection...")
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
