"""Detection tracking with simple snap positioning — long-lived thread."""

import logging
import time

from PySide6.QtCore import QThread, Signal

logger = logging.getLogger(__name__)

_next_track_id = 0

JITTER_DEADZONE = 8


class TrackedDetection:
    """A tracked detection with snap positioning."""

    __slots__ = (
        "track_id",
        "class_name", "confidence", "peak_confidence",
        "x", "y", "w", "h",
        "appear_count", "disappear_count",
        "visible", "opacity",
        "last_seen",
    )

    def __init__(self, det):
        global _next_track_id
        _next_track_id += 1
        self.track_id = _next_track_id
        self.class_name = det.class_name
        self.confidence = det.confidence
        self.peak_confidence = det.confidence
        self.x = float(det.x)
        self.y = float(det.y)
        self.w = float(det.w)
        self.h = float(det.h)
        self.appear_count = 1
        self.disappear_count = 0
        self.visible = False
        self.opacity = 0.0
        self.last_seen = time.perf_counter()

    def update(self, det):
        """Snap to new detection position."""
        new_x = float(det.x)
        new_y = float(det.y)
        new_w = float(det.w)
        new_h = float(det.h)

        if abs(new_x - self.x) >= JITTER_DEADZONE or abs(new_y - self.y) >= JITTER_DEADZONE:
            self.x = new_x
            self.y = new_y
        if abs(new_w - self.w) >= JITTER_DEADZONE or abs(new_h - self.h) >= JITTER_DEADZONE:
            self.w = new_w
            self.h = new_h

        self.confidence = det.confidence
        self.peak_confidence = max(self.peak_confidence, det.confidence)
        self.class_name = det.class_name
        self.appear_count += 1
        self.disappear_count = 0
        self.last_seen = time.perf_counter()

    def get_box(self) -> tuple[int, int, int, int]:
        return (max(0, int(self.x)), max(0, int(self.y)),
                max(1, int(self.w)), max(1, int(self.h)))


def _iou(a, b) -> float:
    ax1, ay1 = a.x, a.y
    ax2, ay2 = a.x + a.w, a.y + a.h
    bx1, by1 = b.x, b.y
    bx2, by2 = b.x + b.w, b.y + b.h
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
    a_area = a.w * a.h
    b_area = b.w * b.h
    union_area = a_area + b_area - inter_area
    return inter_area / union_area if union_area > 0 else 0.0


class TrackerThread(QThread):
    """Long-lived tracker thread. Simple, reliable tracking at 60Hz."""

    smoothed_ready = Signal(list)  # list of (track_id, x, y, w, h, opacity, class_name)

    # Appearance: lower threshold for high-confidence dets so they pop faster
    APPEAR_THRESHOLD_HIGH = 2
    APPEAR_THRESHOLD_LOW = 4
    APPEAR_HIGH_CONFIDENCE = 0.5

    DISAPPEAR_THRESHOLD_LOW = 5
    DISAPPEAR_THRESHOLD_HIGH = 8
    HIGH_CONFIDENCE = 0.4
    GAP_BRIDGE_FRAMES = 3
    FADE_DURATION = 0.15
    IOU_MATCH_THRESHOLD = 0.3

    # Duplicate-track post-cull: same-class visible tracks overlapping this
    # much are considered the same object; drop the weaker one.
    DUPLICATE_IOU_THRESHOLD = 0.6

    # Cross-class sub-detection suppression: tighter than before to avoid
    # swallowing legitimate post-scene-cut detections.
    SUPPRESS_AREA_RATIO = 0.25
    SUPPRESS_CENTER_DIST_RATIO = 0.3

    def __init__(self, config, detection_store=None):
        super().__init__()
        self.config = config
        self._detection_store = detection_store
        self._active = False
        self._alive = True
        self._tracked: list[TrackedDetection] = []
        self._had_results_last_tick = False

    def set_active(self, active: bool):
        self._active = active
        if not active:
            self._tracked.clear()
            self._had_results_last_tick = False

    def shutdown(self):
        self._active = False
        self._alive = False

    def run(self):
        logger.info("Tracker thread started (idle)")
        tick_interval = 1.0 / 60.0
        last_det_seq = 0

        while self._alive:
            if not self._active:
                time.sleep(0.05)
                continue

            t0 = time.perf_counter()
            try:
                if self._detection_store:
                    dets, ts, last_det_seq = self._detection_store.get_if_new(
                        last_det_seq, timeout=0.0
                    )
                    if dets is not None:
                        self._update_tracked(dets)

                self._emit_results()
            except Exception as e:
                logger.error("Tracker error: %s", e, exc_info=True)

            elapsed = time.perf_counter() - t0
            if elapsed < tick_interval:
                time.sleep(tick_interval - elapsed)

        logger.info("Tracker thread stopped")

    def _update_tracked(self, detections):
        detections = sorted(detections, key=lambda d: d.x)

        matched_tracked = set()
        matched_det = set()
        _diag_matches = []
        _diag_suppress = []

        for i, det in enumerate(detections):
            det_cx = det.x + det.w / 2
            det_cy = det.y + det.h / 2

            # --- Pass 1: IoU matching ---
            best_iou = 0.0
            best_j = -1
            for j, tracked in enumerate(self._tracked):
                if j in matched_tracked:
                    continue
                if tracked.class_name != det.class_name:
                    continue
                iou = _iou(tracked, det)
                if iou > best_iou:
                    best_iou = iou
                    best_j = j

            if best_iou >= self.IOU_MATCH_THRESHOLD and best_j >= 0:
                self._tracked[best_j].update(det)
                matched_tracked.add(best_j)
                matched_det.add(i)
                _diag_matches.append({"det_idx": i, "track_id": self._tracked[best_j].track_id, "class": det.class_name, "method": "iou", "detail": round(best_iou, 3)})
                continue

            # --- Pass 2: Center-distance matching (fast movement) ---
            best_dist = float('inf')
            best_k = -1
            for k, tracked in enumerate(self._tracked):
                if k in matched_tracked:
                    continue
                if tracked.class_name != det.class_name:
                    continue
                tcx = tracked.x + tracked.w / 2
                tcy = tracked.y + tracked.h / 2
                dist = ((det_cx - tcx) ** 2 + (det_cy - tcy) ** 2) ** 0.5
                max_dist = max(tracked.w, tracked.h) * 0.75
                if dist < max_dist and dist < best_dist:
                    best_dist = dist
                    best_k = k

            if best_k >= 0:
                self._tracked[best_k].update(det)
                matched_tracked.add(best_k)
                matched_det.add(i)
                _diag_matches.append({"det_idx": i, "track_id": self._tracked[best_k].track_id, "class": det.class_name, "method": "distance", "detail": round(best_dist, 1)})
                continue

            # --- Pass 3: Cross-class sub-detection suppression ---
            # Tightened from the earlier 50%-area + inside-box rule that was
            # swallowing legitimate post-scene-cut detections of the same class.
            det_area = det.w * det.h
            contained = False
            for tracked in self._tracked:
                if not tracked.visible:
                    continue
                if tracked.class_name == det.class_name:
                    continue  # don't suppress same-class — likely a real new object
                track_area = tracked.w * tracked.h
                if det_area >= track_area * self.SUPPRESS_AREA_RATIO:
                    continue
                tcx = tracked.x + tracked.w / 2
                tcy = tracked.y + tracked.h / 2
                if (abs(det_cx - tcx) <= tracked.w * self.SUPPRESS_CENTER_DIST_RATIO
                        and abs(det_cy - tcy) <= tracked.h * self.SUPPRESS_CENTER_DIST_RATIO):
                    contained = True
                    _diag_suppress.append({"det_idx": i, "reason": "sub_detection", "container_id": tracked.track_id})
                    break
            if contained:
                continue

            # --- New track ---
            new_track = TrackedDetection(det)
            self._tracked.append(new_track)
            matched_tracked.add(len(self._tracked) - 1)
            matched_det.add(i)
            _diag_matches.append({"det_idx": i, "track_id": new_track.track_id, "class": det.class_name, "method": "new", "detail": 0})

        # Diagnostic hook
        from ..diagnostics import DIAG_ENABLED, log_tracker_state
        if DIAG_ENABLED:
            log_tracker_state(self._tracked, _diag_matches, _diag_suppress)

        for j, tracked in enumerate(self._tracked):
            if j not in matched_tracked:
                tracked.disappear_count += 1

        for tracked in self._tracked:
            if tracked.disappear_count == 0:
                threshold = (
                    self.APPEAR_THRESHOLD_HIGH
                    if tracked.peak_confidence >= self.APPEAR_HIGH_CONFIDENCE
                    else self.APPEAR_THRESHOLD_LOW
                )
                if tracked.appear_count >= threshold:
                    tracked.visible = True
                    tracked.opacity = 1.0

        # Duplicate-track post-cull (cheap; ≤ ~10 tracks typically)
        self._cull_duplicates()

        self._tracked = [
            t for t in self._tracked
            if t.disappear_count < (
                self.DISAPPEAR_THRESHOLD_HIGH
                if t.peak_confidence >= self.HIGH_CONFIDENCE
                else self.DISAPPEAR_THRESHOLD_LOW
            )
        ]

    def _cull_duplicates(self):
        """Drop same-class visible tracks that overlap heavily with another.

        Keep the one with higher peak_confidence (tie-break: more recently seen).
        """
        n = len(self._tracked)
        if n < 2:
            return
        to_drop = set()
        for i in range(n):
            if i in to_drop:
                continue
            a = self._tracked[i]
            if not a.visible:
                continue
            for k in range(i + 1, n):
                if k in to_drop:
                    continue
                b = self._tracked[k]
                if not b.visible:
                    continue
                if a.class_name != b.class_name:
                    continue
                if _iou(a, b) < self.DUPLICATE_IOU_THRESHOLD:
                    continue
                if (a.peak_confidence, a.last_seen) < (b.peak_confidence, b.last_seen):
                    to_drop.add(i)
                    break
                else:
                    to_drop.add(k)
        if to_drop:
            self._tracked = [t for idx, t in enumerate(self._tracked) if idx not in to_drop]

    def _emit_results(self):
        now = time.perf_counter()
        results = []
        for tracked in self._tracked:
            if not tracked.visible:
                continue
            if tracked.disappear_count > 0:
                if tracked.disappear_count <= self.GAP_BRIDGE_FRAMES:
                    tracked.opacity = 1.0
                else:
                    elapsed = now - tracked.last_seen
                    fade_start = self.GAP_BRIDGE_FRAMES / 30.0
                    tracked.opacity = max(0.0, 1.0 - (elapsed - fade_start) / self.FADE_DURATION)
                    if tracked.opacity <= 0:
                        tracked.visible = False
                        continue
            x, y, w, h = tracked.get_box()
            results.append((tracked.track_id, x, y, w, h, tracked.opacity, tracked.class_name))

        if results or self._had_results_last_tick:
            self.smoothed_ready.emit(results)
        self._had_results_last_tick = bool(results)
