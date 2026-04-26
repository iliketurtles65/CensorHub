"""Image asset storage + bucketed resize cache.

Images uploaded by the user are decoded once, stored on disk, kept in memory
as BGRA ndarrays, and reused via a bucketed LRU cache of pre-resized variants.

The render hot path never decodes or resizes from disk — everything it needs
is already in RAM in the exact target size bucket.
"""

import logging
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

SUPPORTED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MAX_SIDE = 4096          # downscale source if larger
RESIZE_BUCKET = 4        # px bucket for resize cache keys
RESIZE_CACHE_MAX = 512   # LRU cap


def _bucket(n: int) -> int:
    if n < RESIZE_BUCKET:
        return RESIZE_BUCKET
    return ((n + RESIZE_BUCKET - 1) // RESIZE_BUCKET) * RESIZE_BUCKET


class ImageRecord:
    __slots__ = ("id", "filename", "path", "w", "h")

    def __init__(self, id: str, filename: str, path: str, w: int, h: int):
        self.id = id
        self.filename = filename
        self.path = path
        self.w = w
        self.h = h

    def to_dict(self) -> dict:
        return {"id": self.id, "filename": self.filename, "path": self.path,
                "w": self.w, "h": self.h}


def _ensure_bgra(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:  # grayscale
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    elif img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    elif img.shape[2] == 4:
        pass
    else:
        raise ValueError(f"Unsupported channel count: {img.shape[2]}")
    return np.ascontiguousarray(img)


def _resize_cover(src: np.ndarray, w: int, h: int) -> np.ndarray:
    """Scale + center-crop so output fills (w,h) preserving aspect."""
    sh, sw = src.shape[:2]
    if sw == 0 or sh == 0:
        return np.zeros((h, w, src.shape[2]), dtype=src.dtype)
    scale = max(w / sw, h / sh)
    nw = max(w, int(round(sw * scale)))
    nh = max(h, int(round(sh * scale)))
    resized = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_AREA)
    x0 = max(0, (nw - w) // 2)
    y0 = max(0, (nh - h) // 2)
    return np.ascontiguousarray(resized[y0:y0 + h, x0:x0 + w])


def _resize_contain(src: np.ndarray, w: int, h: int) -> np.ndarray:
    """Scale to fit inside (w,h) preserving aspect; transparent letterbox."""
    sh, sw = src.shape[:2]
    if sw == 0 or sh == 0:
        return np.zeros((h, w, 4), dtype=np.uint8)
    scale = min(w / sw, h / sh)
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    resized = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_AREA)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    x0 = (w - nw) // 2
    y0 = (h - nh) // 2
    out[y0:y0 + nh, x0:x0 + nw] = resized
    return out


def _resize_stretch(src: np.ndarray, w: int, h: int) -> np.ndarray:
    return np.ascontiguousarray(cv2.resize(src, (w, h), interpolation=cv2.INTER_AREA))


class AssetStore:
    """Owns image asset files + in-memory decode + bucketed resize cache."""

    def __init__(self, root: Path):
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        # id → BGRA ndarray (original, possibly downscaled to MAX_SIDE)
        self._originals: dict[str, np.ndarray] = {}
        # (id, bw, bh, stretch) → BGRA ndarray
        self._resized: "OrderedDict[tuple[str, int, int, str], np.ndarray]" = OrderedDict()
        self._lock = threading.Lock()

    @property
    def root(self) -> Path:
        return self._root

    def save_upload(self, filename: str, raw_bytes: bytes) -> ImageRecord:
        """Decode + persist + cache. Returns the new ImageRecord."""
        ext = Path(filename).suffix.lower()
        if ext not in SUPPORTED_EXT:
            raise ValueError(f"Unsupported image extension: {ext}")

        arr = np.frombuffer(raw_bytes, dtype=np.uint8)
        decoded = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
        if decoded is None:
            raise ValueError("cv2.imdecode failed — not a valid image")

        # Downscale very large images in place to keep memory + resize cost bounded.
        h, w = decoded.shape[:2]
        longest = max(w, h)
        if longest > MAX_SIDE:
            scale = MAX_SIDE / longest
            nw = int(round(w * scale))
            nh = int(round(h * scale))
            decoded = cv2.resize(decoded, (nw, nh), interpolation=cv2.INTER_AREA)
            h, w = nh, nw

        bgra = _ensure_bgra(decoded)

        # Persist the normalized (possibly downscaled) image as PNG to preserve alpha.
        asset_id = uuid.uuid4().hex
        stored_name = f"{asset_id}.png"
        stored_path = self._root / stored_name
        ok, enc = cv2.imencode(".png", bgra)
        if not ok:
            raise ValueError("cv2.imencode failed")
        stored_path.write_bytes(enc.tobytes())

        with self._lock:
            self._originals[asset_id] = bgra

        rec = ImageRecord(
            id=asset_id,
            filename=filename,
            path=str(stored_path.relative_to(self._root.parent.parent)).replace("\\", "/"),
            w=w, h=h,
        )
        logger.info("Asset uploaded: %s (%dx%d) id=%s", filename, w, h, asset_id)
        return rec

    def delete(self, asset_id: str) -> None:
        with self._lock:
            self._originals.pop(asset_id, None)
            dead_keys = [k for k in self._resized if k[0] == asset_id]
            for k in dead_keys:
                del self._resized[k]
        try:
            (self._root / f"{asset_id}.png").unlink(missing_ok=True)
        except Exception as e:
            logger.warning("Asset file delete failed: %s", e)

    def load_existing(self, records: list[ImageRecord]) -> None:
        """Lazy-load existing assets from disk into the originals cache."""
        for rec in records:
            p = self._root / f"{rec.id}.png"
            if not p.exists():
                continue
            raw = p.read_bytes()
            arr = np.frombuffer(raw, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
            if img is None:
                continue
            bgra = _ensure_bgra(img)
            with self._lock:
                self._originals[rec.id] = bgra

    def get_raw(self, asset_id: str) -> np.ndarray | None:
        with self._lock:
            return self._originals.get(asset_id)

    def get_resized(self, asset_id: str, w: int, h: int, stretch: str = "cover") -> np.ndarray | None:
        if w <= 0 or h <= 0:
            return None
        bw = _bucket(w)
        bh = _bucket(h)
        key = (asset_id, bw, bh, stretch)
        with self._lock:
            cached = self._resized.get(key)
            if cached is not None:
                self._resized.move_to_end(key)
                return cached[:h, :w]
            src = self._originals.get(asset_id)
        if src is None:
            return None
        if stretch == "cover":
            out = _resize_cover(src, bw, bh)
        elif stretch == "contain":
            out = _resize_contain(src, bw, bh)
        elif stretch == "stretch":
            out = _resize_stretch(src, bw, bh)
        else:
            out = _resize_cover(src, bw, bh)
        with self._lock:
            self._resized[key] = out
            if len(self._resized) > RESIZE_CACHE_MAX:
                self._resized.popitem(last=False)
            return out[:h, :w]
