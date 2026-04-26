"""Micro-benchmark: cost of each layer vs the baseline fastpath.

Runs N iterations of the render pipeline on a fixed synthetic region and
reports per-iteration ms. Use to verify that a feature flag being OFF
results in identical throughput to before the feature landed.

Run from backend/:
    venv/Scripts/python.exe bench_layers.py
"""

import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from src.overlay.asset_store import AssetStore
from src.overlay.censor_effects import (
    apply_mosaic, composite_bgra_onto_bgr, draw_stroke, get_shape_mask,
)
from src.overlay.text_cache import render_text_bgra


ITER = 1000
REGION_W, REGION_H = 200, 200


def make_region() -> np.ndarray:
    # Synthetic frame region, contiguous writable.
    rng = np.random.default_rng(42)
    return rng.integers(0, 255, (REGION_H, REGION_W, 3), dtype=np.uint8).copy()


def bench(name: str, fn, warmup=50):
    for _ in range(warmup):
        fn()
    t0 = time.perf_counter()
    for _ in range(ITER):
        fn()
    dt = time.perf_counter() - t0
    per = dt * 1000 / ITER
    print(f"  {name:48s} {per:7.3f} ms/iter  ({ITER / dt:7.0f} iter/s)")
    return per


def main():
    print(f"Region: {REGION_W}x{REGION_H}, {ITER} iterations")
    region = make_region()

    # Pre-build an asset for image tests
    with tempfile.TemporaryDirectory() as td:
        store = AssetStore(Path(td))
        fake = np.zeros((300, 300, 4), dtype=np.uint8)
        cv2.rectangle(fake, (50, 50), (250, 250), (0, 128, 255, 255), -1)
        ok, enc = cv2.imencode('.png', fake)
        rec = store.save_upload('bench.png', enc.tobytes())

        print("\n[ Baseline + per-layer cost ]")

        # Baseline: effect only (today's fastpath behaviour with rectangle shape)
        def _baseline():
            censored = apply_mosaic(region, 75)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            argb[:, :, 3] = 255
            _ = np.ascontiguousarray(argb)
        base = bench("baseline (mosaic, rectangle, no layers)", _baseline)

        # +shape mask (ellipse)
        def _ellipse():
            censored = apply_mosaic(region, 75)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            mask = get_shape_mask('ellipse', REGION_W, REGION_H)
            argb[:, :, 3] = mask if mask is not None else 255
            _ = np.ascontiguousarray(argb)
        bench("+ ellipse shape mask", _ellipse)

        # +stroke
        def _stroke():
            censored = apply_mosaic(region, 75).copy()
            draw_stroke(censored, 'ellipse', '#ff0066', 3)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            argb[:, :, 3] = 255
            _ = np.ascontiguousarray(argb)
        bench("+ stroke (ellipse, 3px)", _stroke)

        # +overlay image (preload cache warm)
        ov = store.get_resized(rec.id, 160, 160, 'contain')
        assert ov is not None

        def _overlay():
            censored = apply_mosaic(region, 75).copy()
            composite_bgra_onto_bgr(censored, ov, REGION_W // 2, REGION_H // 2, 1.0)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            argb[:, :, 3] = 255
            _ = np.ascontiguousarray(argb)
        bench("+ overlay image (160x160, contain, opacity=1)", _overlay)

        # +text (preload cache warm)
        txt = render_text_bgra("CENSORED", "impact", "#ffffff", 60,
                               stroke_enabled=True, stroke_color="#000000", stroke_px=2)
        assert txt is not None

        def _text():
            censored = apply_mosaic(region, 75).copy()
            composite_bgra_onto_bgr(censored, txt, REGION_W // 2, REGION_H // 2, 1.0)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            argb[:, :, 3] = 255
            _ = np.ascontiguousarray(argb)
        bench("+ text (CENSORED, 60px, Impact, with outline)", _text)

        # All-on (stroke + overlay + text + ellipse mask)
        def _all():
            censored = apply_mosaic(region, 75).copy()
            draw_stroke(censored, 'ellipse', '#ff0066', 3)
            composite_bgra_onto_bgr(censored, ov, REGION_W // 2, REGION_H // 2, 1.0)
            composite_bgra_onto_bgr(censored, txt, REGION_W // 2, REGION_H // 2, 1.0)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            mask = get_shape_mask('ellipse', REGION_W, REGION_H)
            argb[:, :, 3] = mask if mask is not None else 255
            _ = np.ascontiguousarray(argb)
        full = bench("ALL LAYERS ON (stroke+overlay+text+ellipse)", _all)

        # Feather regression checks
        def _feather_rect():
            censored = apply_mosaic(region, 75)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            mask = get_shape_mask('rectangle', REGION_W, REGION_H, feather_px=12)
            argb[:, :, 3] = mask if mask is not None else 255
            _ = np.ascontiguousarray(argb)
        bench("+ feather=12 rectangle mask (cached)", _feather_rect)

        def _feather_ellipse():
            censored = apply_mosaic(region, 75)
            argb = np.empty((REGION_H, REGION_W, 4), dtype=np.uint8)
            argb[:, :, :3] = censored
            mask = get_shape_mask('ellipse', REGION_W, REGION_H, feather_px=12)
            argb[:, :, 3] = mask if mask is not None else 255
            _ = np.ascontiguousarray(argb)
        bench("+ feather=12 ellipse mask (cached)", _feather_ellipse)

        print()
        print(f"  delta (all-layers vs baseline): {(full - base) * 1000:.0f} us/iter")
        print(f"  throughput baseline: {1000 / base:.0f} censors/sec @ 200x200")
        print(f"  throughput all-on  : {1000 / full:.0f} censors/sec @ 200x200")


if __name__ == '__main__':
    main()
