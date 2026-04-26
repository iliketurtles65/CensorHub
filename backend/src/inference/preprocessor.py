"""Frame preprocessing for NudeNet ONNX model inference."""

import numpy as np
import cv2


def preprocess_frame(
    frame: np.ndarray,
    target_size: int = 640,
) -> tuple[np.ndarray, list[dict]]:
    """Preprocess a screen capture frame into batched 640x640 crops.

    For wide/multi-monitor frames, splits into overlapping square crops
    to maintain detection accuracy. Each crop is resized to target_size.

    Returns:
        batch: numpy array of shape (N, 3, target_size, target_size), float32, [0,1]
        crop_infos: list of dicts with crop metadata for coordinate mapping
    """
    h, w = frame.shape[:2]

    # Determine crops: for wide aspect ratios, split into overlapping squares
    crops = []
    crop_infos = []

    if w <= h * 1.5:
        # Approximately square or portrait: single crop
        crops.append(frame)
        crop_infos.append({
            "x_offset": 0,
            "y_offset": 0,
            "crop_w": w,
            "crop_h": h,
            "orig_w": w,
            "orig_h": h,
        })
    else:
        # Wide frame: split into overlapping square crops
        crop_size = h  # Use full height as crop dimension
        stride = int(crop_size * 0.6)  # 40% overlap
        x = 0
        while x < w:
            x_end = min(x + crop_size, w)
            x_start = max(0, x_end - crop_size)

            crop = frame[:, x_start:x_end]
            crops.append(crop)
            crop_infos.append({
                "x_offset": x_start,
                "y_offset": 0,
                "crop_w": x_end - x_start,
                "crop_h": h,
                "orig_w": w,
                "orig_h": h,
            })

            if x_end >= w:
                break
            x += stride

    # Resize and normalize each crop
    batch = np.zeros((len(crops), 3, target_size, target_size), dtype=np.float32)

    for i, crop in enumerate(crops):
        # Letterbox resize maintaining aspect ratio
        resized, pad_info = _letterbox_resize(crop, target_size)
        crop_infos[i]["pad_info"] = pad_info

        # Normalize to [0,1] and convert HWC→CHW
        resized = resized.astype(np.float32) / 255.0
        batch[i] = resized.transpose(2, 0, 1)  # HWC → CHW

    return batch, crop_infos


def _letterbox_resize(
    img: np.ndarray, target_size: int
) -> tuple[np.ndarray, dict]:
    """Resize image with letterboxing to maintain aspect ratio."""
    h, w = img.shape[:2]
    scale = target_size / max(h, w)
    new_w = int(w * scale)
    new_h = int(h * scale)

    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    # Pad to target_size x target_size
    pad_top = (target_size - new_h) // 2
    pad_bottom = target_size - new_h - pad_top
    pad_left = (target_size - new_w) // 2
    pad_right = target_size - new_w - pad_left

    padded = cv2.copyMakeBorder(
        resized, pad_top, pad_bottom, pad_left, pad_right,
        cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )

    pad_info = {
        "scale": scale,
        "pad_top": pad_top,
        "pad_left": pad_left,
        "new_w": new_w,
        "new_h": new_h,
    }
    return padded, pad_info
