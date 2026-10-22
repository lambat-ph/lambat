"""Elevation lookup from AWS Terrarium tiles (public, no key).

Source: https://registry.opendata.aws/terrain-tiles/ . Terrarium encodes metres as
(R*256 + G + B/256) - 32768. In the Philippines the underlying data is roughly
30 m SRTM-class, which is coarse in a delta city like Dagupan where the whole
city sits within a few metres of sea level. Treat elevation as a RANK signal
(which nodes are lowest), not as a surveyed height.
"""

from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEM_CACHE = ROOT / "data" / "raw" / "dem_cache"
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 14


def tile_xy(lon: np.ndarray, lat: np.ndarray, z: int = ZOOM) -> tuple[np.ndarray, np.ndarray]:
    """Fractional web-mercator tile coordinates."""
    n = 2.0**z
    lon = np.asarray(lon, dtype=float)
    lat = np.radians(np.asarray(lat, dtype=float))
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - np.arcsinh(np.tan(lat)) / math.pi) / 2.0 * n
    return x, y


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(float)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


def load_tile(z: int, x: int, y: int, cache: Path = DEM_CACHE) -> np.ndarray:
    """256x256 elevation array in metres for one tile, downloaded once and cached."""
    path = cache / str(z) / str(x) / f"{y}.png"
    if not path.exists():
        r = None
        for attempt in range(4):
            try:
                r = requests.get(URL.format(z=z, x=x, y=y), timeout=30)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    img = Image.open(path).convert("RGB")
    return decode_terrarium(np.asarray(img))


def sample(lon, lat, z: int = ZOOM, cache: Path = DEM_CACHE) -> np.ndarray:
    """Elevation (m) at each lon/lat, nearest pixel."""
    fx, fy = tile_xy(lon, lat, z)
    tx, ty = np.floor(fx).astype(int), np.floor(fy).astype(int)
    px = np.clip(((fx - tx) * 256).astype(int), 0, 255)
    py = np.clip(((fy - ty) * 256).astype(int), 0, 255)
    out = np.empty(len(tx), dtype=float)
    for key in set(zip(tx.tolist(), ty.tolist())):
        m = (tx == key[0]) & (ty == key[1])
        tile = load_tile(z, key[0], key[1], cache)
        out[m] = tile[py[m], px[m]]
    return out
