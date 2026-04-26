"""Background thread for rendering censor effect pixmaps — long-lived."""

import logging
import threading
import time

import cv2
import numpy as np
from PySide6.QtCore import QThread, Signal
from PySide6.QtGui import QImage, QPixmap

from .censor_effects import (
    apply_mosaic, apply_blur, apply_black_box, apply_pixelation,
    get_shape_mask, draw_stroke, composite_bgra_onto_bgr,
)
from .text_cache import render_text_bgra

logger = logging.getLogger(__name__)

EFFECT_MAP = {
    "mosaic": apply_mosaic,
    "blur": apply_blur,
    "black_box": apply_black_box,
    "pixelation": apply_pixelation,
}


class RenderRequest:
    __slots__ = ("box_id", "abs_x", "abs_y", "w", "h", "opacity",
                 "effect_name", "intensity", "shape", "stroke",
                 "base_image", "overlay_image", "text_spec", "feather_px")

    def __init__(self, box_id, abs_x, abs_y, w, h, opacity, effect_name, intensity,
                 shape="rectangle", stroke=None, base_image=None, overlay_image=None,
                 text_spec=None, feather_px=0):
        self.box_id = box_id
        self.abs_x = abs_x
        self.abs_y = abs_y
        self.w = w
        self.h = h
        self.opacity = opacity
        self.effect_name = effect_name
        self.intensity = intensity
        self.shape = shape
        # stroke: None (off) or tuple (color_hex: str, thickness: int)
        self.stroke = stroke
        # base_image: None (not 'image' type) or tuple (asset_id: str, stretch: str)
        self.base_image = base_image
        # overlay_image: None (off) or tuple (asset_id, scale_pct, opacity)
        self.overlay_image = overlay_image
        # text_spec: None (off) or tuple
        #   (phrase: str, font_id: str, color_hex: str, size_pct: int,
        #    stroke_enabled: bool, stroke_color: str, stroke_px: int)
        self.text_spec = text_spec
        # feather_px: Gaussian blur radius applied to the shape alpha mask (0 = hard edges)
        self.feather_px = feather_px


class RenderedPixmap:
    __slots__ = ("box_id", "pixmap", "x", "y", "w", "h", "opacity")

    def __init__(self, box_id, pixmap, x, y, w, h, opacity):
        self.box_id = box_id
        self.pixmap = pixmap
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.opacity = opacity


class RenderWorker(QThread):
    """Long-lived render thread. Idles when inactive, renders when active."""

    render_done = Signal()

    def __init__(self, frame_store, asset_store=None):
        super().__init__()
        self._frame_store = frame_store
        self._asset_store = asset_store
        self._active = False
        self._alive = True

        self._pending_requests = None
        self._lock = threading.Lock()
        self._event = threading.Event()

        self._cache: dict[int, RenderedPixmap] = {}
        self._cache_lock = threading.Lock()

    def set_active(self, active: bool):
        self._active = active
        if not active:
            with self._cache_lock:
                self._cache = {}

    def shutdown(self):
        self._active = False
        self._alive = False
        self._event.set()

    def submit(self, requests: list[RenderRequest], vx: int, vy: int):
        with self._lock:
            self._pending_requests = (requests, vx, vy)
        self._event.set()

    def get_cache(self) -> dict[int, RenderedPixmap]:
        with self._cache_lock:
            return dict(self._cache)

    def run(self):
        logger.info("RenderWorker started (idle)")

        while self._alive:
            if not self._active:
                time.sleep(0.05)
                continue

            if not self._event.wait(timeout=0.1):
                continue
            self._event.clear()

            if not self._active:
                continue

            with self._lock:
                pending = self._pending_requests
                self._pending_requests = None
            if pending is None:
                continue

            requests, vx, vy = pending
            frame_data = self._frame_store.get() if self._frame_store else None
            if not frame_data:
                continue

            screenshots, vd_left, vd_top = frame_data
            new_cache = {}

            for req in requests:
                region = self._extract_region(
                    screenshots, vd_left, vd_top,
                    req.abs_x, req.abs_y, req.w, req.h,
                )
                if region is None:
                    continue

                censored = self._apply_base(req, region)
                ch, cw = censored.shape[:2]

                # Fixed draw order: stroke → overlay image → text.
                # Each branch guarded by `is not None` so disabled layers stay
                # on the fastpath (same cost as no-layers-on baseline).
                if req.stroke is not None:
                    s_color, s_thick = req.stroke
                    if s_thick > 0:
                        draw_stroke(censored, req.shape, s_color, s_thick)

                if req.overlay_image is not None and self._asset_store is not None:
                    ov_asset, ov_scale_pct, ov_opacity = req.overlay_image
                    short = min(cw, ch)
                    target = max(4, (short * ov_scale_pct) // 100)
                    ov_img = self._asset_store.get_resized(ov_asset, target, target, "contain")
                    if ov_img is not None:
                        composite_bgra_onto_bgr(censored, ov_img, cw // 2, ch // 2, ov_opacity)

                if req.text_spec is not None:
                    phrase, font_id, color_hex, size_pct, s_en, s_color, s_px = req.text_spec
                    font_px = max(6, (ch * size_pct) // 100)
                    text_bgra = render_text_bgra(
                        phrase, font_id, color_hex, font_px, s_en, s_color, s_px,
                    )
                    if text_bgra is not None:
                        th, tw = text_bgra.shape[:2]
                        max_w = int(cw * 0.95)
                        if tw > max_w and tw > 0:
                            scale = max_w / tw
                            nw = max(1, int(tw * scale))
                            nh = max(1, int(th * scale))
                            text_bgra = cv2.resize(text_bgra, (nw, nh), interpolation=cv2.INTER_AREA)
                        composite_bgra_onto_bgr(censored, text_bgra, cw // 2, ch // 2, 1.0)

                argb = np.empty((ch, cw, 4), dtype=np.uint8)
                argb[:, :, :3] = censored
                mask = get_shape_mask(req.shape, cw, ch, req.feather_px)
                if mask is None:
                    argb[:, :, 3] = 255
                else:
                    argb[:, :, 3] = mask
                argb = np.ascontiguousarray(argb)
                qimg = QImage(argb.data, cw, ch, cw * 4, QImage.Format.Format_ARGB32)
                pixmap = QPixmap.fromImage(qimg)

                new_cache[req.box_id] = RenderedPixmap(
                    req.box_id, pixmap,
                    req.abs_x - vx, req.abs_y - vy,
                    cw, ch, req.opacity,
                )

            with self._cache_lock:
                self._cache = new_cache

            self.render_done.emit()

        logger.info("RenderWorker stopped")

    def _apply_base(self, req, region):
        """Run the base effect. For effect_name='image', substitute an asset."""
        if req.effect_name == "image" and req.base_image is not None and self._asset_store is not None:
            asset_id, stretch = req.base_image
            h, w = region.shape[:2]
            img = self._asset_store.get_resized(asset_id, w, h, stretch)
            if img is not None:
                # img is BGRA at exact (h, w); drop alpha — shape mask handles silhouette.
                return np.ascontiguousarray(img[:, :, :3])
            # Fall through: missing asset → behave like mosaic for a sane default.
        effect_fn = EFFECT_MAP.get(req.effect_name, apply_mosaic)
        return effect_fn(region, req.intensity)

    def _extract_region(self, screenshots, vd_left, vd_top, abs_x, abs_y, w, h):
        for frame, monitor in screenshots:
            mon_off_x = monitor["left"] - vd_left
            mon_off_y = monitor["top"] - vd_top
            mon_w = monitor["width"]
            mon_h = monitor["height"]
            if abs_x + w <= mon_off_x or abs_x >= mon_off_x + mon_w:
                continue
            if abs_y + h <= mon_off_y or abs_y >= mon_off_y + mon_h:
                continue
            local_x = abs_x - mon_off_x
            local_y = abs_y - mon_off_y
            x1 = max(0, local_x)
            y1 = max(0, local_y)
            x2 = min(mon_w, local_x + w)
            y2 = min(mon_h, local_y + h)
            if x2 <= x1 or y2 <= y1:
                continue
            fh, fw = frame.shape[:2]
            x1, y1 = min(x1, fw - 1), min(y1, fh - 1)
            x2, y2 = min(x2, fw), min(y2, fh)
            if x2 <= x1 or y2 <= y1:
                continue
            if frame.shape[2] == 4:
                return frame[y1:y2, x1:x2, :3]
            return frame[y1:y2, x1:x2]
        return None
