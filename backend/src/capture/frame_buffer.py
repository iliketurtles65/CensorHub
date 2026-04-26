"""Frame storage for passing captured frames between threads."""

import threading
import time

import numpy as np


class SharedFrameStore:
    """Latest captured frames, readable from any thread.

    ScreenCapture writes after each grab. OverlayWindow and InferenceThread read.
    Uses a sequence counter + event for efficient change detection and blocking.
    """

    def __init__(self):
        self._data = None  # (screenshots, vd_left, vd_top, seq)
        self._seq = 0
        self._event = threading.Event()

    def update(self, screenshots, vd_left, vd_top):
        """Store latest capture. Called by ScreenCapture thread."""
        self._seq += 1
        self._data = (screenshots, vd_left, vd_top, self._seq)
        self._event.set()

    def get(self):
        """Get latest frames. Returns (screenshots, vd_left, vd_top) or None."""
        d = self._data
        return (d[0], d[1], d[2]) if d else None

    def get_if_new(self, known_seq: int, timeout: float = 1.0):
        """Block until a new frame is available or timeout.

        Returns ((screenshots, vd_left, vd_top), new_seq) or (None, known_seq).
        """
        if self._seq == known_seq:
            self._event.wait(timeout=timeout)
            self._event.clear()
        d = self._data
        if d is None or d[3] == known_seq:
            return None, known_seq
        return (d[0], d[1], d[2]), d[3]

    def wake(self):
        """Wake any thread blocked in get_if_new() without providing new data."""
        self._event.set()


class SharedDetectionStore:
    """Latest detections from inference, readable from any thread.

    InferenceThread writes after each inference pass.
    TrackerThread polls for new detections.
    """

    def __init__(self):
        self._data = None  # list of Detection objects
        self._timestamp = 0.0
        self._seq = 0
        self._event = threading.Event()

    def update(self, detections, timestamp: float):
        """Store latest detections. Called by InferenceThread."""
        self._data = detections
        self._timestamp = timestamp
        self._seq += 1
        self._event.set()

    def get_if_new(self, known_seq: int, timeout: float = 0.008):
        """Return new detections if available, else (None, 0.0, known_seq).

        Non-blocking when timeout=0. Blocking when timeout > 0.
        """
        if self._seq == known_seq:
            if timeout > 0:
                self._event.wait(timeout=timeout)
            self._event.clear()
        if self._data is None or self._seq == known_seq:
            return None, 0.0, known_seq
        return self._data, self._timestamp, self._seq


class FrameRingBuffer:
    """Thread-safe ring buffer for screen capture frames.

    Writer (capture thread) overwrites the oldest frame if buffer is full.
    Reader (inference thread) always gets the latest frame.
    """

    def __init__(self, capacity: int = 3):
        self._capacity = capacity
        self._buffer: list[tuple[np.ndarray, float] | None] = [None] * capacity
        self._write_idx = 0
        self._latest_idx = -1
        self._lock = threading.Lock()
        self._event = threading.Event()

    def put(self, frame: np.ndarray):
        """Store a frame (overwrites oldest if full)."""
        timestamp = time.perf_counter()
        with self._lock:
            self._buffer[self._write_idx] = (frame, timestamp)
            self._latest_idx = self._write_idx
            self._write_idx = (self._write_idx + 1) % self._capacity
        self._event.set()

    def get_latest(self, timeout: float = 1.0) -> tuple[np.ndarray, float] | None:
        """Get the most recent frame. Blocks until available or timeout."""
        if not self._event.wait(timeout=timeout):
            return None
        with self._lock:
            self._event.clear()
            if self._latest_idx < 0:
                return None
            return self._buffer[self._latest_idx]

    def clear(self):
        with self._lock:
            self._buffer = [None] * self._capacity
            self._write_idx = 0
            self._latest_idx = -1
            self._event.clear()
