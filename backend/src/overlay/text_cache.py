"""Text rasterization cache using Pillow.

Rendered text pixmaps (as BGRA numpy arrays) are cached by
(phrase, font_id, color, font_px, stroke_color, stroke_px). Fonts are
resolved once at startup from a small table of candidate paths — we rely on
Windows system fonts to avoid shipping TTFs and licensing hassle. If a font
can't be found the Pillow default bitmap font is used as fallback.
"""

import logging
import os
from collections import OrderedDict

import numpy as np
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)


# Font table. Each entry has a human-readable display name and a list of
# candidate file paths — the first one that exists wins. Windows paths first,
# cross-platform paths after.
_WIN_FONTS = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")

FONT_TABLE: dict[str, dict] = {
    "impact": {
        "name": "Impact",
        "paths": [
            os.path.join(_WIN_FONTS, "impact.ttf"),
            "/Library/Fonts/Impact.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Impact.ttf",
        ],
    },
    "arial_bold": {
        "name": "Arial Bold",
        "paths": [
            os.path.join(_WIN_FONTS, "arialbd.ttf"),
            "/Library/Fonts/Arial Bold.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
        ],
    },
    "consolas_bold": {
        "name": "Consolas Bold (mono)",
        "paths": [
            os.path.join(_WIN_FONTS, "consolab.ttf"),
            "/Library/Fonts/Courier New Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        ],
    },
    "times_bold": {
        "name": "Times Bold",
        "paths": [
            os.path.join(_WIN_FONTS, "timesbd.ttf"),
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        ],
    },
}
DEFAULT_FONT_ID = "impact"


_loaded_fonts: dict[tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}
_resolved_paths: dict[str, str | None] = {}


def _resolve_path(font_id: str) -> str | None:
    if font_id in _resolved_paths:
        return _resolved_paths[font_id]
    entry = FONT_TABLE.get(font_id) or FONT_TABLE[DEFAULT_FONT_ID]
    for p in entry["paths"]:
        if os.path.isfile(p):
            _resolved_paths[font_id] = p
            return p
    logger.warning("Font not found for id=%s; using Pillow default", font_id)
    _resolved_paths[font_id] = None
    return None


def _load_font(font_id: str, size_px: int):
    key = (font_id, size_px)
    cached = _loaded_fonts.get(key)
    if cached is not None:
        return cached
    path = _resolve_path(font_id)
    if path is None:
        font = ImageFont.load_default()
    else:
        try:
            font = ImageFont.truetype(path, size_px)
        except Exception as e:
            logger.warning("Font load failed (%s): %s", path, e)
            font = ImageFont.load_default()
    _loaded_fonts[key] = font
    return font


def available_fonts() -> list[dict]:
    """Return [{id, name, available}] for frontend display."""
    out = []
    for fid, entry in FONT_TABLE.items():
        out.append({
            "id": fid,
            "name": entry["name"],
            "available": _resolve_path(fid) is not None,
        })
    return out


# --- Text raster cache ---

PX_BUCKET = 4
CACHE_MAX = 256
_text_cache: "OrderedDict[tuple, np.ndarray]" = OrderedDict()


def _bucket_px(px: int) -> int:
    if px < PX_BUCKET:
        return PX_BUCKET
    return ((px + PX_BUCKET - 1) // PX_BUCKET) * PX_BUCKET


def _parse_hex(h: str) -> tuple[int, int, int]:
    s = h.lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    try:
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except Exception:
        return 255, 255, 255


def render_text_bgra(phrase: str, font_id: str, color_hex: str, font_px: int,
                     stroke_enabled: bool = False, stroke_color: str = "#000000",
                     stroke_px: int = 0) -> np.ndarray | None:
    """Render phrase to a tight BGRA numpy array. Cached."""
    if not phrase:
        return None
    px_b = _bucket_px(max(6, font_px))
    key = (phrase, font_id, color_hex.lower(), px_b, stroke_enabled, stroke_color.lower(), stroke_px)
    cached = _text_cache.get(key)
    if cached is not None:
        _text_cache.move_to_end(key)
        return cached

    font = _load_font(font_id, px_b)
    r, g, b = _parse_hex(color_hex)
    sr, sg, sb = _parse_hex(stroke_color)
    effective_stroke = stroke_px if (stroke_enabled and stroke_px > 0) else 0

    # Measure the phrase. Use a throwaway canvas to get the bbox.
    tmp = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tmp)
    try:
        bbox = draw.textbbox((0, 0), phrase, font=font, stroke_width=effective_stroke)
    except TypeError:
        # Older Pillow
        bbox = draw.textbbox((0, 0), phrase, font=font)
    text_w = max(1, bbox[2] - bbox[0])
    text_h = max(1, bbox[3] - bbox[1])
    # Pad a little for stroke/diacritics bleed
    pad = max(2, effective_stroke + 2)
    canvas_w = text_w + 2 * pad
    canvas_h = text_h + 2 * pad

    img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Draw at -bbox[0] offset so the glyphs sit flush left/top within our pad.
    try:
        d.text(
            (pad - bbox[0], pad - bbox[1]),
            phrase, font=font, fill=(r, g, b, 255),
            stroke_width=effective_stroke if effective_stroke else 0,
            stroke_fill=(sr, sg, sb, 255) if effective_stroke else None,
        )
    except TypeError:
        # Older Pillow fallback (no stroke support)
        d.text((pad - bbox[0], pad - bbox[1]), phrase, font=font, fill=(r, g, b, 255))

    # PIL gives RGBA; convert to BGRA for cv2 compositing.
    rgba = np.array(img, dtype=np.uint8)
    bgra = rgba[:, :, [2, 1, 0, 3]].copy()

    _text_cache[key] = bgra
    if len(_text_cache) > CACHE_MAX:
        _text_cache.popitem(last=False)
    return bgra
