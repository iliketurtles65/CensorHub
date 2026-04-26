"""Post-processing for NudeNet ONNX model output."""

import numpy as np
import cv2

from ..config import ALL_LABELS


class Detection:
    """A single detection result mapped to screen coordinates."""

    __slots__ = ("class_name", "confidence", "x", "y", "w", "h")

    def __init__(self, class_name: str, confidence: float, x: int, y: int, w: int, h: int):
        self.class_name = class_name
        self.confidence = confidence
        self.x = x
        self.y = y
        self.w = w
        self.h = h

    def to_dict(self) -> dict:
        return {
            "class": self.class_name,
            "score": round(self.confidence, 3),
            "box": [self.x, self.y, self.w, self.h],
        }

    def __repr__(self):
        return f"Detection({self.class_name}, {self.confidence:.2f}, [{self.x},{self.y},{self.w},{self.h}])"


def postprocess_output(
    output: np.ndarray,
    crop_infos: list[dict],
    enabled_classes: set[str],
    confidence_threshold: float = 0.45,
    nms_threshold: float = 0.30,
    monitor_offset_x: int = 0,
    monitor_offset_y: int = 0,
    master_size: float = 1.0,
    per_category_size: dict[str, float] | None = None,
) -> list[Detection]:
    """Process raw ONNX output into global screen-coordinate detections.

    Args:
        output: Raw model output, shape varies by model version
        crop_infos: Crop metadata from preprocessor
        enabled_classes: Set of class names to keep
        confidence_threshold: Minimum confidence to keep
        nms_threshold: IoU threshold for NMS
        monitor_offset_x: Physical X offset of this monitor in virtual desktop
        monitor_offset_y: Physical Y offset of this monitor in virtual desktop
    """
    all_detections = []

    # NudeNet YOLOv8 output format: (batch, 4+num_classes, num_boxes)
    # Transpose to (batch, num_boxes, 4+num_classes)
    if len(output.shape) == 3:
        batch_size = output.shape[0]
        output = output.transpose(0, 2, 1)
    else:
        # Single image
        output = output.transpose(1, 0)[np.newaxis, ...]
        batch_size = 1

    for batch_idx in range(min(batch_size, len(crop_infos))):
        preds = output[batch_idx]  # (num_boxes, 4 + num_classes)
        crop_info = crop_infos[batch_idx]

        # Extract boxes (cx, cy, w, h) and class scores
        boxes_cxcywh = preds[:, :4]
        class_scores = preds[:, 4:]

        # Get best class per box
        class_ids = np.argmax(class_scores, axis=1)
        confidences = np.max(class_scores, axis=1)

        # Filter by confidence
        mask = confidences >= confidence_threshold
        boxes_cxcywh = boxes_cxcywh[mask]
        class_ids = class_ids[mask]
        confidences = confidences[mask]

        if len(boxes_cxcywh) == 0:
            continue

        # Convert cx,cy,w,h to x1,y1,x2,y2 for NMS
        boxes_xyxy = np.zeros_like(boxes_cxcywh)
        boxes_xyxy[:, 0] = boxes_cxcywh[:, 0] - boxes_cxcywh[:, 2] / 2
        boxes_xyxy[:, 1] = boxes_cxcywh[:, 1] - boxes_cxcywh[:, 3] / 2
        boxes_xyxy[:, 2] = boxes_cxcywh[:, 0] + boxes_cxcywh[:, 2] / 2
        boxes_xyxy[:, 3] = boxes_cxcywh[:, 1] + boxes_cxcywh[:, 3] / 2

        # Per-crop NMS: use higher threshold (0.50) to allow paired detections
        # like left+right breast to coexist. Cross-crop NMS handles true duplicates.
        indices = cv2.dnn.NMSBoxes(
            boxes_xyxy.tolist(),
            confidences.tolist(),
            confidence_threshold,
            0.50,
        )
        if len(indices) == 0:
            continue
        indices = indices.flatten()

        # Map back to screen coordinates
        pad_info = crop_info["pad_info"]
        scale = pad_info["scale"]
        pad_top = pad_info["pad_top"]
        pad_left = pad_info["pad_left"]
        x_offset = crop_info["x_offset"]
        y_offset = crop_info["y_offset"]

        for idx in indices:
            class_id = class_ids[idx]
            if class_id >= len(ALL_LABELS):
                continue

            class_name = ALL_LABELS[class_id]
            if class_name not in enabled_classes:
                continue

            # Unpad and unscale coordinates
            x1 = (boxes_xyxy[idx, 0] - pad_left) / scale + x_offset
            y1 = (boxes_xyxy[idx, 1] - pad_top) / scale + y_offset
            x2 = (boxes_xyxy[idx, 2] - pad_left) / scale + x_offset
            y2 = (boxes_xyxy[idx, 3] - pad_top) / scale + y_offset

            # Convert to x,y,w,h integers (monitor-local)
            sx = max(0, int(x1))
            sy = max(0, int(y1))
            sw = max(1, int(x2 - x1))
            sh = max(1, int(y2 - y1))

            # Light padding to cover model bbox imprecision.
            # Kept small (8%) — tracker dead-zone filter handles jitter.
            pad_x = int(sw * 0.08)
            pad_y = int(sh * 0.08)
            sx = max(0, sx - pad_x // 2)
            sy = max(0, sy - pad_y // 2)
            sw = sw + pad_x
            sh = sh + pad_y

            # User-controlled size multiplier — per-category override wins over master.
            # Scale around the box center so growth/shrink is symmetric.
            size_mul = (
                per_category_size.get(class_name, master_size)
                if per_category_size else master_size
            )
            if size_mul != 1.0:
                cx = sx + sw / 2
                cy = sy + sh / 2
                sw = max(1, int(sw * size_mul))
                sh = max(1, int(sh * size_mul))
                sx = max(0, int(cx - sw / 2))
                sy = max(0, int(cy - sh / 2))

            # Add monitor offset → global physical coordinates
            all_detections.append(Detection(
                class_name=class_name,
                confidence=float(confidences[idx]),
                x=sx + monitor_offset_x,
                y=sy + monitor_offset_y,
                w=sw, h=sh,
            ))

    # Cross-crop NMS: only suppress true duplicates (same object in different crops).
    # These have very high IoU (>0.7). Use 0.65 threshold so paired detections
    # like left+right breast (IoU ~0.1-0.4) are NOT suppressed.
    if len(all_detections) > 1 and len(crop_infos) > 1:
        all_detections = _cross_crop_nms(all_detections, 0.65)

    # Expand lone breast detections to cover the pair
    all_detections = _expand_paired_detections(all_detections)

    return all_detections


def _cross_crop_nms(detections: list[Detection], iou_threshold: float) -> list[Detection]:
    """Remove duplicate detections from overlapping crops."""
    if not detections:
        return detections

    boxes = np.array([[d.x, d.y, d.x + d.w, d.y + d.h] for d in detections])
    scores = np.array([d.confidence for d in detections])

    indices = cv2.dnn.NMSBoxes(
        boxes.tolist(), scores.tolist(), 0.0, iou_threshold
    )
    if len(indices) == 0:
        return []
    return [detections[i] for i in indices.flatten()]


_PAIRED_CLASSES = {"FEMALE_BREAST_EXPOSED", "FEMALE_BREAST_COVERED"}


def _expand_paired_detections(detections: list[Detection]) -> list[Detection]:
    """Expand lone breast detections to cover the pair.

    When the model only detects one breast (common at smaller scales),
    expand its box horizontally by 80% to cover both sides. If two
    breast detections are already nearby, leave them alone.
    """
    if not detections:
        return detections

    # Separate paired-class detections from others
    paired = [d for d in detections if d.class_name in _PAIRED_CLASSES]
    others = [d for d in detections if d.class_name not in _PAIRED_CLASSES]

    if not paired:
        return detections

    # For each paired detection, check if there's another nearby
    expanded = []
    for i, det in enumerate(paired):
        has_pair = False
        det_cx = det.x + det.w / 2
        det_cy = det.y + det.h / 2

        for j, other in enumerate(paired):
            if i == j:
                continue
            if other.class_name != det.class_name:
                continue
            # Check if another detection of the same class is within
            # 2x width distance horizontally and similar vertical position
            other_cx = other.x + other.w / 2
            other_cy = other.y + other.h / 2
            dx = abs(det_cx - other_cx)
            dy = abs(det_cy - other_cy)
            if dx < det.w * 2.0 and dy < det.h * 0.8:
                has_pair = True
                break

        if has_pair:
            # Pair exists — keep original box
            expanded.append(det)
        else:
            # Lone detection — expand width by 120% to cover both sides
            expand = int(det.w * 1.2)
            new_x = max(0, det.x - expand // 2)
            new_w = det.w + expand
            expanded.append(Detection(
                class_name=det.class_name,
                confidence=det.confidence,
                x=new_x, y=det.y,
                w=new_w, h=det.h,
            ))

    return others + expanded
