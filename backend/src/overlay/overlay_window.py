"""Transparent click-through overlay — delegates rendering to RenderWorker."""

import ctypes
import logging

from PySide6.QtCore import Qt, QRect, QTimer, Slot
from PySide6.QtGui import QPainter
from PySide6.QtWidgets import QApplication, QWidget

from ..config import SharedConfig, layer_applies
from .render_worker import RenderWorker, RenderRequest

logger = logging.getLogger(__name__)

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080

# Generous margin for clip region — covers fast movement between
# _do_paint (which schedules repaints) and paintEvent (which draws)
CLIP_MARGIN = 50

# Tight margin around actual painted area — for clearing next frame
CLEAR_MARGIN = 2


class OverlayWindow(QWidget):
    """Full-desktop transparent overlay with background-rendered pixmaps.

    paintEvent records exactly what was drawn. The NEXT paintEvent clears
    those exact areas. No timing mismatch — clear rects always match
    what was actually painted.
    """

    def __init__(self, config: SharedConfig, frame_store=None, render_worker=None):
        super().__init__()
        self.config = config
        self._frame_store = frame_store
        self._render_worker = render_worker
        self._tracked_boxes = []
        self._visible = False
        self._vx = 0
        self._vy = 0

        self._cfg_version = -1
        self._effect_name = "mosaic"
        self._intensity = 75
        self._master_shape = "rectangle"
        self._master_size = 1.0  # held for future use; postprocessor already reads from config
        self._master_stroke = None
        self._master_base_image = None
        self._master_overlay_image = None
        self._master_text = None
        self._stroke_targets: list[str] = ["*"]
        self._feather_px = 0
        self._phrases_by_id: dict[str, str] = {}

        # Rects that were ACTUALLY painted last frame — cleared in the next paint
        self._last_painted_rects: list[QRect] = []
        self._frame_count = 0
        self._full_clear_needed = False

        # Pixmap history — keeps last known pixmap per track_id to avoid black flashes
        self._pixmap_history: dict[int, object] = {}  # track_id → RenderedPixmap

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
            | Qt.WindowType.WindowTransparentForInput
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)

        self._build_geometry()

        self._refresh_timer = QTimer(self)
        self._refresh_timer.timeout.connect(self._do_paint)

        self._stale_timer = QTimer(self)
        self._stale_timer.setSingleShot(True)
        self._stale_timer.timeout.connect(self._clear_stale)

        if self._render_worker:
            self._render_worker.render_done.connect(self._on_render_done)

    def _build_geometry(self):
        screens = QApplication.screens()
        if not screens:
            return
        min_x = min(s.geometry().x() for s in screens)
        min_y = min(s.geometry().y() for s in screens)
        max_x = max(s.geometry().x() + s.geometry().width() for s in screens)
        max_y = max(s.geometry().y() + s.geometry().height() for s in screens)
        self._vx = min_x
        self._vy = min_y
        self.setGeometry(min_x, min_y, max_x - min_x, max_y - min_y)
        logger.info("Overlay: %dx%d at (%d,%d)", max_x - min_x, max_y - min_y, min_x, min_y)

    def _make_click_through(self):
        try:
            hwnd = int(self.winId())
            style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            ctypes.windll.user32.SetWindowLongW(
                hwnd, GWL_EXSTYLE,
                style | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW,
            )
            WDA_EXCLUDEFROMCAPTURE = 0x00000011
            ctypes.windll.user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
            logger.info("Overlay excluded from screen capture")
        except Exception as e:
            logger.error("Click-through/display affinity failed: %s", e)

    def show_overlay(self):
        if self._visible:
            return
        self._build_geometry()
        self.show()
        self._make_click_through()
        self._visible = True
        logger.info("Overlay shown")

    def hide_overlay(self):
        if not self._visible:
            return
        self._stale_timer.stop()
        self._refresh_timer.stop()
        self._tracked_boxes = []
        self._last_painted_rects = []
        self._pixmap_history = {}
        self._full_clear_needed = True
        self.update()
        self.hide()
        self._visible = False

    @Slot(list)
    def update_mosaics(self, mosaics_list: list):
        self._tracked_boxes = []
        self._full_clear_needed = True
        self.update()
        self._stale_timer.start(500)

    @Slot(list)
    def update_tracked(self, tracked_boxes: list):
        self._tracked_boxes = tracked_boxes

        new_cfg, self._cfg_version = self.config.get_if_changed(self._cfg_version)
        if new_cfg is not None:
            cs = new_cfg.censor
            self._effect_name = cs.censor_type
            self._intensity = cs.intensity
            self._master_shape = cs.master_shape
            self._master_size = cs.master_size
            self._master_stroke = cs.master_stroke
            self._master_base_image = cs.master_base_image
            self._master_overlay_image = cs.master_overlay_image
            self._master_text = cs.master_text
            self._stroke_targets = list(cs.stroke_targets)
            self._feather_px = cs.master_feather_px
            self._phrases_by_id = {p.id: p.text for p in new_cfg.phrases}

        if tracked_boxes:
            if self._render_worker:
                requests = []
                for track_id, x, y, w, h, opacity, class_name in tracked_boxes:
                    # --- Base effect (with per-class image assignment filter) ---
                    effect_name = self._effect_name
                    base_image = None
                    if effect_name == "image":
                        base_assignments = (
                            self._master_base_image.assignments
                            if self._master_base_image is not None else []
                        )
                        applicable = [
                            a for a in base_assignments
                            if layer_applies(a.targets, class_name)
                        ]
                        if applicable:
                            idx = track_id % len(applicable)
                            base_image = (
                                applicable[idx].asset_id,
                                self._master_base_image.stretch,
                            )
                        else:
                            # No image maps to this class — fall back to mosaic
                            # so the region is still censored.
                            effect_name = "mosaic"

                    # --- Stroke (layer-level targeting) ---
                    stroke = None
                    if (self._master_stroke is not None
                            and self._master_stroke.enabled
                            and layer_applies(self._stroke_targets, class_name)):
                        stroke = (self._master_stroke.color, self._master_stroke.thickness)

                    # --- Overlay image (per-asset targeting) ---
                    overlay_image = None
                    ov = self._master_overlay_image
                    if ov is not None and ov.enabled and ov.assignments:
                        applicable = [
                            a for a in ov.assignments
                            if layer_applies(a.targets, class_name)
                        ]
                        if applicable:
                            idx = track_id % len(applicable)
                            overlay_image = (applicable[idx].asset_id, ov.scale_pct, ov.opacity)

                    # --- Text (per-phrase targeting) ---
                    text_spec = None
                    txt = self._master_text
                    if txt is not None and txt.enabled and txt.assignments:
                        applicable = [
                            a for a in txt.assignments
                            if a.phrase_id in self._phrases_by_id
                            and layer_applies(a.targets, class_name)
                        ]
                        if applicable:
                            assignment = applicable[track_id % len(applicable)]
                            phrase = self._phrases_by_id[assignment.phrase_id]
                            text_spec = (
                                phrase, txt.font_id, txt.color, txt.size_pct,
                                txt.stroke_enabled, txt.stroke_color, txt.stroke_px,
                            )

                    requests.append(RenderRequest(
                        box_id=track_id, abs_x=x, abs_y=y, w=w, h=h,
                        opacity=opacity,
                        effect_name=effect_name,
                        intensity=self._intensity,
                        shape=self._master_shape,
                        stroke=stroke,
                        base_image=base_image,
                        overlay_image=overlay_image,
                        text_spec=text_spec,
                        feather_px=self._feather_px,
                    ))
                self._render_worker.submit(requests, self._vx, self._vy)

            if not self._refresh_timer.isActive():
                self._refresh_timer.start(16)  # 60Hz
        else:
            self._full_clear_needed = True
            self._last_painted_rects = []
            if self._refresh_timer.isActive():
                self._refresh_timer.stop()
            self.update()

        self._stale_timer.start(500)

    def _clear_stale(self):
        self._tracked_boxes = []
        self._last_painted_rects = []
        self._full_clear_needed = True
        self._refresh_timer.stop()
        self.update()

    @Slot()
    def _on_render_done(self):
        pass

    def _do_paint(self):
        """60Hz timer. Schedule generous clip regions for paintEvent."""
        M = CLIP_MARGIN

        # Schedule current box positions with generous margin
        for track_id, x, y, w, h, opacity, _class_name in self._tracked_boxes:
            self.update(QRect(x - self._vx - M, y - self._vy - M,
                              w + 2 * M, h + 2 * M))

        # Schedule previous painted areas with generous margin (for clearing)
        for r in self._last_painted_rects:
            self.update(r.adjusted(-M, -M, M, M))

    def paintEvent(self, event):
        """Clear previous painted areas, draw current pixmaps, record what was drawn."""
        painter = QPainter(self)
        self._frame_count += 1

        # Safety-net full clear every ~2s, or on explicit request
        if self._full_clear_needed or self._frame_count % 120 == 0:
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_Clear)
            painter.eraseRect(self.rect())
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)
            self._full_clear_needed = False
            self._last_painted_rects = []
        elif self._last_painted_rects:
            # Clear exactly where we ACTUALLY painted last time
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_Clear)
            for r in self._last_painted_rects:
                painter.eraseRect(r)
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)

        if not self._tracked_boxes:
            painter.end()
            return

        # Draw current pixmaps and record exactly what we painted
        pixmap_cache = self._render_worker.get_cache() if self._render_worker else {}
        new_painted_rects = []
        CM = CLEAR_MARGIN
        active_ids = set()

        for track_id, x, y, w, h, opacity, _class_name in self._tracked_boxes:
            draw_x = x - self._vx
            draw_y = y - self._vy
            active_ids.add(track_id)

            # Try current cache first, then fall back to last known pixmap
            rp = pixmap_cache.get(track_id)
            if rp is not None and not rp.pixmap.isNull():
                self._pixmap_history[track_id] = rp  # Update history
            else:
                rp = self._pixmap_history.get(track_id)  # Use last known

            if rp is not None and not rp.pixmap.isNull():
                pw = rp.pixmap.width()
                ph = rp.pixmap.height()
                if opacity < 1.0:
                    painter.setOpacity(opacity)
                painter.drawPixmap(draw_x, draw_y, rp.pixmap)
                if opacity < 1.0:
                    painter.setOpacity(1.0)
                new_painted_rects.append(QRect(
                    draw_x - CM, draw_y - CM, pw + 2 * CM, ph + 2 * CM))
            else:
                # No pixmap yet — skip drawing entirely (appears next frame)
                pass

        # Clean up history for track_ids that are no longer active
        stale = [tid for tid in self._pixmap_history if tid not in active_ids]
        for tid in stale:
            del self._pixmap_history[tid]

        self._last_painted_rects = new_painted_rects

        # Diagnostic hook
        from ..diagnostics import DIAG_ENABLED, log_overlay
        if DIAG_ENABLED:
            cache_keys = set(pixmap_cache.keys()) if pixmap_cache else set()
            hist_keys = set(self._pixmap_history.keys())
            log_overlay(self._tracked_boxes, cache_keys | hist_keys)

        painter.end()
