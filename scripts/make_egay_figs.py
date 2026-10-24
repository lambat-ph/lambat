"""Web pictures for the Typhoon Egay section of the radar page.

Reads the cached scenes from scripts/run_s1_flood.py (data/processed/s1_<date>.tif) and writes three
JPEGs to web/assets/radar/: the dry scene, the flood scene, and the flood scene with new water marked.
Same thresholds as run_s1_flood.py.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

from lambat import data, flood
from lambat import sentinel1 as s1

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "assets" / "radar"
GOLD, NEW_WATER, PERM_WATER = (239, 190, 1), (64, 156, 255), (0, 38, 127)


def grey(db: np.ndarray) -> np.ndarray:
    g = (np.clip((np.nan_to_num(db, nan=-30) + 25) / 25, 0, 1) * 255).astype(np.uint8)  # -25..0 dB
    return np.stack([g] * 3, -1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache-dir", default=str(s1.PROCESSED))
    ap.add_argument("--drop-db", type=float, default=3.0)
    ap.add_argument("--water-db", type=float, default=-18.0)
    ap.add_argument("--step", type=int, default=1, help="keep every n-th pixel (10 m grid)")
    args = ap.parse_args()

    cache = Path(args.cache_dir)
    dry, tr, crs = s1.read_geotiff(cache / "s1_20230411.tif")
    wet, _, _ = s1.read_geotiff(cache / "s1_20230728.tif")
    vv_d, vv_f = dry[0], wet[0]
    labels = s1.rasterize_labels(data.barangays().to_crs(crs).geometry, tr, vv_f.shape)
    both = np.isfinite(vv_f) & np.isfinite(vv_d)
    perm = np.isfinite(vv_d) & (vv_d < args.water_db)
    new = flood.threshold_extent(vv_d, vv_f, drop_db=args.drop_db, water_db=args.water_db) & both & ~perm

    sl = (slice(None, None, args.step), slice(None, None, args.step))
    lab = labels[sl]
    edge = np.zeros(lab.shape, bool)
    edge[:-1] |= lab[:-1] != lab[1:]
    edge[:, :-1] |= lab[:, :-1] != lab[:, 1:]
    edge &= lab > 0

    before, after = grey(vv_d[sl]), grey(vv_f[sl])
    water = after.copy()
    water[perm[sl]] = PERM_WATER
    water[new[sl]] = NEW_WATER
    OUT.mkdir(parents=True, exist_ok=True)
    for name, img in (("egay_before", before), ("egay_after", after), ("egay_water", water)):
        img = img.copy()
        img[edge] = GOLD
        Image.fromarray(img).save(OUT / f"{name}.jpg", quality=82, optimize=True)
        print("wrote", OUT / f"{name}.jpg", img.shape[1], "x", img.shape[0])


if __name__ == "__main__":
    main()
