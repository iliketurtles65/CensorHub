"""Censorship rendering effects: mosaic, blur, black box, pixelation."""

from collections import OrderedDict

import numpy as np
import cv2
from PySide6.QtGui import QImage, QPixmap


def apply_mosaic(region: np.ndarray, intensity: int) -> np.ndarray:
    """Apply mosaic/pixelation effect. Higher intensity = blockier."""
    h, w = region.shape[:2]
    if h < 2 or w < 2:
        return region

    # Map intensity (0-100) to block size (2-80)
    block_size = max(2, int(2 + (intensity / 100) * 78))

    small_w = max(1, w // block_size)
    small_h = max(1, h // block_size)

    small = cv2.resize(region, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


def apply_blur(region: np.ndarray, intensity: int) -> np.ndarray:
    """Apply Gaussian blur. Higher intensity = more blur."""
    # Map intensity (0-100) to kernel size (5-99, must be odd)
    ksize = max(5, int(5 + (intensity / 100) * 94))
    if ksize % 2 == 0:
        ksize += 1

    return cv2.GaussianBlur(region, (ksize, ksize), 0)


def apply_black_box(region: np.ndarray, intensity: int) -> np.ndarray:
    """Apply solid black box. Higher intensity = more opaque."""
    # Map intensity (0-100) to opacity (0.3-1.0)
    opacity = 0.3 + (intensity / 100) * 0.7
    black = np.zeros_like(region)
    return cv2.addWeighted(region, 1.0 - opacity, black, opacity, 0)


def apply_pixelation(region: np.ndarray, intensity: int) -> np.ndarray:
    """Apply pixelation with color quantization."""
    h, w = region.shape[:2]
    if h < 2 or w < 2:
        return region

    # Mosaic first
    block_size = max(2, int(2 + (intensity / 100) * 24))
    small_w = max(1, w // block_size)
    small_h = max(1, h // block_size)
    small = cv2.resize(region, (small_w, small_h), interpolation=cv2.INTER_LINEAR)

    # Color quantization: reduce color levels
    color_levels = max(2, int(16 - (intensity / 100) * 14))
    factor = 256 // color_levels
    small = (small // factor) * factor

    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


EFFECT_MAP = {
    "mosaic": apply_mosaic,
    "blur": apply_blur,
    "black_box": apply_black_box,
    "pixelation": apply_pixelation,
}


# --- Shape alpha masks ---
# Rectangle is the fastpath: None sentinel, no per-pixel alpha work.
# Ellipse / rounded_rect masks are cached by (shape, bucketed w, bucketed h)
# so jittering boxes don't churn the cache.

_MASK_BUCKET = 4
_MASK_CACHE_MAX = 256
_mask_cache: "OrderedDict[tuple[str, int, int], np.ndarray]" = OrderedDict()


def _bucket(n: int) -> int:
    # Round up to nearest _MASK_BUCKET so tracker jitter doesn't create new entries.
    if n < _MASK_BUCKET:
        return _MASK_BUCKET
    return ((n + _MASK_BUCKET - 1) // _MASK_BUCKET) * _MASK_BUCKET


def _build_mask(shape: str, w: int, h: int) -> np.ndarray | None:
    """Build the base (hard-edge) mask. Returns None for rectangle (fastpath sentinel)."""
    if shape == "rectangle":
        return None
    mask = np.zeros((h, w), dtype=np.uint8)
    if shape == "ellipse":
        cx = w // 2
        cy = h // 2
        ax = max(1, w // 2)
        ay = max(1, h // 2)
        cv2.ellipse(mask, (cx, cy), (ax, ay), 0, 0, 360, 255, -1, lineType=cv2.LINE_AA)
    elif shape == "rounded_rect":
        r = max(2, min(w, h) // 6)
        r = min(r, w // 2, h // 2)
        cv2.rectangle(mask, (r, 0), (w - r, h), 255, -1)
        cv2.rectangle(mask, (0, r), (w, h - r), 255, -1)
        cv2.circle(mask, (r, r), r, 255, -1, lineType=cv2.LINE_AA)
        cv2.circle(mask, (w - r - 1, r), r, 255, -1, lineType=cv2.LINE_AA)
        cv2.circle(mask, (r, h - r - 1), r, 255, -1, lineType=cv2.LINE_AA)
        cv2.circle(mask, (w - r - 1, h - r - 1), r, 255, -1, lineType=cv2.LINE_AA)
    else:
        return None
    return mask


def get_shape_mask(shape: str, w: int, h: int, feather_px: int = 0) -> np.ndarray | None:
    """Return cached alpha mask sized to (h, w). Returns None for the
    rectangle + no-feather fastpath so the caller can fill alpha with 255 directly.
    """
    if w <= 0 or h <= 0:
        return None
    # Fastpath: hard-edge rectangle needs no mask at all.
    if shape == "rectangle" and feather_px <= 0:
        return None

    bw = _bucket(w)
    bh = _bucket(h)
    key = (shape, bw, bh, feather_px)
    cached = _mask_cache.get(key)
    if cached is not None:
        _mask_cache.move_to_end(key)
        return cached[:h, :w]

    # Build the base silhouette at bucket size.
    if shape == "rectangle":
        # For a feathered rectangle we inset the fill so that the GaussianBlur
        # below has transparent pixels to soften into. Otherwise a full-fill
        # all-255 mask stays all-255 through the blur and feathering is a no-op.
        if feather_px > 0:
            mask = np.zeros((bh, bw), dtype=np.uint8)
            inset_x = min(bw // 2, feather_px)
            inset_y = min(bh // 2, feather_px)
            cv2.rectangle(mask, (inset_x, inset_y), (bw - inset_x, bh - inset_y), 255, -1)
        else:
            mask = np.full((bh, bw), 255, dtype=np.uint8)
    else:
        mask = _build_mask(shape, bw, bh)
        if mask is None:
            return None

    if feather_px > 0:
        k = feather_px * 2 + 1
        mask = cv2.GaussianBlur(mask, (k, k), 0)

    _mask_cache[key] = mask
    if len(_mask_cache) > _MASK_CACHE_MAX:
        _mask_cache.popitem(last=False)
    return mask[:h, :w]


def _hex_to_bgr(color_hex: str) -> tuple[int, int, int]:
    s = color_hex.lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
    except ValueError:
        return (102, 0, 255)  # fallback neon-pink-ish in BGR
    return (b, g, r)


def draw_stroke(region: np.ndarray, shape: str, color_hex: str, thickness: int) -> None:
    """Draw an inset stroke on `region` following the given shape. In-place."""
    if thickness < 1:
        return
    h, w = region.shape[:2]
    if h < 2 or w < 2:
        return
    color = _hex_to_bgr(color_hex)
    # Inset: draw strictly inside the region. Clamp thickness to avoid filling.
    t = max(1, min(thickness, min(w, h) // 2 - 1))
    if shape == "rectangle":
        half = t // 2
        cv2.rectangle(region, (half, half), (w - 1 - half, h - 1 - half), color, t)
    elif shape == "ellipse":
        cx = w // 2
        cy = h // 2
        ax = max(1, w // 2 - t // 2)
        ay = max(1, h // 2 - t // 2)
        cv2.ellipse(region, (cx, cy), (ax, ay), 0, 0, 360, color, t, lineType=cv2.LINE_AA)
    elif shape == "rounded_rect":
        r = max(2, min(w, h) // 6)
        r = min(r, w // 2, h // 2)
        half = t // 2
        # Top, bottom straight segments
        cv2.line(region, (r, half), (w - 1 - r, half), color, t)
        cv2.line(region, (r, h - 1 - half), (w - 1 - r, h - 1 - half), color, t)
        # Left, right straight segments
        cv2.line(region, (half, r), (half, h - 1 - r), color, t)
        cv2.line(region, (w - 1 - half, r), (w - 1 - half, h - 1 - r), color, t)
        # Rounded corners
        cv2.ellipse(region, (r, r), (r - half, r - half), 180, 0, 90, color, t, lineType=cv2.LINE_AA)
        cv2.ellipse(region, (w - 1 - r, r), (r - half, r - half), 270, 0, 90, color, t, lineType=cv2.LINE_AA)
        cv2.ellipse(region, (r, h - 1 - r), (r - half, r - half), 90, 0, 90, color, t, lineType=cv2.LINE_AA)
        cv2.ellipse(region, (w - 1 - r, h - 1 - r), (r - half, r - half), 0, 0, 90, color, t, lineType=cv2.LINE_AA)


def composite_bgra_onto_bgr(dst_bgr: np.ndarray, overlay_bgra: np.ndarray,
                            cx: int, cy: int, opacity: float = 1.0) -> None:
    """Alpha-blend a BGRA overlay centered at (cx, cy) onto dst_bgr. In-place.

    Uses pre-multiplied alpha math with numpy slicing. No Python per-pixel loops.
    """
    dh, dw = dst_bgr.shape[:2]
    oh, ow = overlay_bgra.shape[:2]
    if oh <= 0 or ow <= 0 or opacity <= 0:
        return

    x0 = cx - ow // 2
    y0 = cy - oh // 2

    # Clip overlay to dst bounds
    src_x0 = max(0, -x0)
    src_y0 = max(0, -y0)
    src_x1 = min(ow, dw - x0)
    src_y1 = min(oh, dh - y0)
    if src_x1 <= src_x0 or src_y1 <= src_y0:
        return
    dst_x0 = max(0, x0)
    dst_y0 = max(0, y0)
    dst_x1 = dst_x0 + (src_x1 - src_x0)
    dst_y1 = dst_y0 + (src_y1 - src_y0)

    over_slice = overlay_bgra[src_y0:src_y1, src_x0:src_x1]
    dst_slice = dst_bgr[dst_y0:dst_y1, dst_x0:dst_x1]

    alpha = over_slice[:, :, 3].astype(np.float32) / 255.0
    if opacity < 1.0:
        alpha *= opacity
    alpha_3 = alpha[:, :, None]
    blended = over_slice[:, :, :3].astype(np.float32) * alpha_3 + \
              dst_slice.astype(np.float32) * (1.0 - alpha_3)
    np.copyto(dst_slice, blended.astype(np.uint8))


def render_censored_region(
    screen_region: np.ndarray,
    censor_type: str,
    intensity: int,
) -> QPixmap:
    """Apply censorship effect to a screen region and return as QPixmap."""
    effect_fn = EFFECT_MAP.get(censor_type, apply_mosaic)
    censored = effect_fn(screen_region, intensity)

    # Convert BGR numpy array to QPixmap
    h, w = censored.shape[:2]
    if len(censored.shape) == 3:
        rgb = cv2.cvtColor(censored, cv2.COLOR_BGR2RGB)
        qimg = QImage(rgb.data, w, h, w * 3, QImage.Format.Format_RGB888)
    else:
        qimg = QImage(censored.data, w, h, w, QImage.Format.Format_Grayscale8)

    return QPixmap.fromImage(qimg.copy())
