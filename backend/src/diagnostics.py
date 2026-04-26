"""Diagnostic logger for detection/tracking analysis.

Set DIAG_ENABLED = True to log frame-by-frame data to a JSONL file.
Set DIAG_ENABLED = False (default) for zero overhead.
Delete this file entirely when analysis is complete.
"""

import json
import time
from datetime import datetime
from pathlib import Path

# ──────────────────────────────────────────────
# Toggle this to enable/disable diagnostic logging
DIAG_ENABLED = True
# ──────────────────────────────────────────────

_file = None
_start_time = None


def _ensure_file():
    global _file, _start_time
    if _file is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = Path(__file__).parent.parent / f"diagnostics_{ts}.jsonl"
        _file = open(path, "w", encoding="utf-8")
        _start_time = time.perf_counter()
        _file.write(json.dumps({"type": "start", "t": 0, "timestamp": ts}) + "\n")
        _file.flush()


def _t():
    return round(time.perf_counter() - _start_time, 4) if _start_time else 0


def log_detections(detections, frame_seq: int, latency_ms: float):
    """Log raw detections from inference (before tracking)."""
    if not DIAG_ENABLED:
        return
    _ensure_file()
    dets = []
    for d in detections:
        dets.append({
            "class": d.class_name,
            "conf": round(d.confidence, 3),
            "x": d.x, "y": d.y, "w": d.w, "h": d.h,
        })
    _file.write(json.dumps({
        "type": "detections",
        "t": _t(),
        "frame_seq": frame_seq,
        "latency_ms": round(latency_ms, 1),
        "count": len(dets),
        "dets": dets,
    }) + "\n")
    _file.flush()


def log_tracker_state(tracked_list, matches, suppressions):
    """Log tracker state after an update.

    matches: list of {"det_idx": int, "track_id": int, "method": str, "detail": float}
    suppressions: list of {"det_idx": int, "reason": str}
    """
    if not DIAG_ENABLED:
        return
    _ensure_file()
    tracks = []
    for t in tracked_list:
        tracks.append({
            "id": t.track_id,
            "class": t.class_name,
            "conf": round(t.confidence, 3),
            "x": round(t.x, 1), "y": round(t.y, 1),
            "w": round(t.w, 1), "h": round(t.h, 1),
            "appear": t.appear_count,
            "disappear": t.disappear_count,
            "visible": t.visible,
            "opacity": round(t.opacity, 2),
        })
    _file.write(json.dumps({
        "type": "tracker",
        "t": _t(),
        "track_count": len(tracks),
        "visible_count": sum(1 for t in tracks if t["visible"]),
        "tracks": tracks,
        "matches": matches,
        "suppressions": suppressions,
    }) + "\n")
    _file.flush()


def log_overlay(tracked_boxes, pixmap_cache_keys):
    """Log what the overlay actually drew."""
    if not DIAG_ENABLED:
        return
    _ensure_file()
    boxes = []
    for track_id, x, y, w, h, opacity, class_name in tracked_boxes:
        boxes.append({
            "id": track_id,
            "class": class_name,
            "x": x, "y": y, "w": w, "h": h,
            "opacity": round(opacity, 2),
            "has_pixmap": track_id in pixmap_cache_keys,
        })
    _file.write(json.dumps({
        "type": "overlay",
        "t": _t(),
        "box_count": len(boxes),
        "boxes": boxes,
    }) + "\n")
    _file.flush()


def close():
    """Flush and close the diagnostic file."""
    global _file
    if _file:
        _file.close()
        _file = None
