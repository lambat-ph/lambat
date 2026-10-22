"""Step 1: where is the water?

Three readings of flood extent, compared against each other:
- the UP NOAH hazard map for the matching return period (available on day one)
- a before/after Sentinel-1 backscatter threshold (`threshold_extent`), or a
  single-image Otsu split (`otsu_threshold`)
- a U-Net trained on Sen1Floods11 (`unet_extent`; optional extra: uv sync --extra cv)

All SAR arrays are VV (and VH) backscatter in dB. Open water is smooth, so it
reflects little energy back to the sensor and looks dark (roughly -18 dB or lower).

NOAH hazard is used through `data.flood_hazard()` barangay shares for now;
there is no raster reader here yet. Rasterise the NOAH layer to the SAR grid and
pass it to `iou` or `agreement` to compare it with these masks.
"""

from __future__ import annotations

import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

# Public Sen1Floods11 v1.1 paths (Bonafilia et al., 2020).
# https://github.com/cloudtostreet/Sen1Floods11
SEN1FLOODS11_BASE = "https://storage.googleapis.com/sen1floods11/v1.1"
SPLIT_URL = SEN1FLOODS11_BASE + "/splits/flood_handlabeled/flood_{split}_data.csv"
S1_URL = SEN1FLOODS11_BASE + "/data/flood_events/HandLabeled/S1Hand/{name}"
LABEL_URL = SEN1FLOODS11_BASE + "/data/flood_events/HandLabeled/LabelHand/{name}"

DB_MIN, DB_MAX = -30.0, 0.0  # clip range for dB inputs to the network


# --------------------------------------------------------------------------
# Classical readings
# --------------------------------------------------------------------------

def threshold_extent(before_db, after_db, drop_db=3.0, water_db=-18.0):
    """Change detection on VV backscatter (dB). Returns a boolean water mask.

    A pixel is flooded if it is dark after the event (after < water_db) AND it
    got at least `drop_db` darker than before. The second test keeps permanent
    dark surfaces (tarmac, shadow, rivers) out of the flood extent.
    NaN in either input is treated as not flooded.
    """
    before = np.asarray(before_db, dtype=float)
    after = np.asarray(after_db, dtype=float)
    if before.shape != after.shape:
        raise ValueError("before and after must have the same shape")
    with np.errstate(invalid="ignore"):
        return (after < water_db) & ((before - after) >= drop_db)


def otsu_threshold(after_db, bins=256):
    """Otsu's threshold (dB) separating dark water from brighter land.

    Single-image alternative: water = after_db < otsu_threshold(after_db).
    Maximises between-class variance of the histogram. NaN/inf are ignored.
    """
    x = np.asarray(after_db, dtype=float).ravel()
    x = x[np.isfinite(x)]
    if x.size == 0:
        raise ValueError("no finite values")
    lo, hi = x.min(), x.max()
    if lo == hi:
        return float(lo)
    hist, edges = np.histogram(x, bins=bins, range=(lo, hi))
    centers = (edges[:-1] + edges[1:]) / 2
    w = hist.astype(float)
    w0 = np.cumsum(w)
    w1 = w0[-1] - w0
    m = np.cumsum(w * centers)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu0 = m / w0
        mu1 = (m[-1] - m) / w1
        between = w0 * w1 * (mu0 - mu1) ** 2
    between = np.nan_to_num(between, nan=-1.0)
    k = int(np.argmax(between))
    # threshold sits between bin k and k+1
    return float(edges[k + 1])


# --------------------------------------------------------------------------
# Comparison helpers
# --------------------------------------------------------------------------

def iou(pred, truth, ignore=-1):
    """Intersection over union of water (1) in `pred` vs `truth`.

    `truth` may contain `ignore` (default -1, Sen1Floods11 no-data); those
    pixels are excluded. Returns nan if neither mask has any water.
    """
    pred = np.asarray(pred).astype(bool)
    truth = np.asarray(truth)
    valid = truth != ignore
    t = (truth == 1) & valid
    p = pred & valid
    union = (p | t).sum()
    if union == 0:
        return float("nan")
    return float((p & t).sum() / union)


def agreement(mask_a, mask_b):
    """Share of pixels on which two boolean masks agree (0 to 1)."""
    a = np.asarray(mask_a).astype(bool)
    b = np.asarray(mask_b).astype(bool)
    if a.shape != b.shape:
        raise ValueError("masks must have the same shape")
    return float((a == b).mean())


# --------------------------------------------------------------------------
# U-Net (torch imported lazily)
# --------------------------------------------------------------------------

def build_unet(encoder_weights=None):
    """U-Net, resnet34 encoder, 2 input channels (VV, VH), 1 output logit.

    encoder_weights=None trains from scratch (no download). Pass "imagenet"
    to start from pretrained encoder weights.
    """
    import segmentation_models_pytorch as smp

    return smp.Unet(
        encoder_name="resnet34",
        encoder_weights=encoder_weights,
        in_channels=2,
        classes=1,
    )


def normalise_db(vv_vh):
    """(2,H,W) dB array -> float32 in about [-1, 1]. NaN becomes 0 (mid-range)."""
    x = np.asarray(vv_vh, dtype=np.float32)
    x = np.clip(x, DB_MIN, DB_MAX)
    x = (x - DB_MIN) / (DB_MAX - DB_MIN) * 2.0 - 1.0
    return np.nan_to_num(x, nan=0.0)


def unet_extent(vv_vh_array, checkpoint_path, tile=512, threshold=0.5):
    """Tiled U-Net inference. `vv_vh_array` is (2,H,W) dB. Returns bool (H,W).

    Tiles are padded (reflect) up to a multiple of 32, as the encoder needs.
    """
    import torch

    x = np.asarray(vv_vh_array, dtype=np.float32)
    if x.ndim != 3 or x.shape[0] != 2:
        raise ValueError("expected an array of shape (2, H, W): VV then VH")
    nan_mask = ~np.isfinite(x).all(axis=0)
    xn = normalise_db(x)
    _, H, W = xn.shape

    model = build_unet()
    state = torch.load(checkpoint_path, map_location="cpu")
    if isinstance(state, dict) and "model" in state:
        state = state["model"]
    model.load_state_dict(state)
    model.eval()

    out = np.zeros((H, W), dtype=bool)
    with torch.no_grad():
        for r in range(0, H, tile):
            for c in range(0, W, tile):
                patch = xn[:, r:r + tile, c:c + tile]
                ph, pw = patch.shape[1:]
                pad_h = (-ph) % 32
                pad_w = (-pw) % 32
                if pad_h or pad_w:
                    patch = np.pad(patch, ((0, 0), (0, pad_h), (0, pad_w)), mode="reflect")
                logits = model(torch.from_numpy(patch[None]))
                prob = torch.sigmoid(logits)[0, 0].numpy()[:ph, :pw]
                out[r:r + ph, c:c + pw] = prob > threshold
    out[nan_mask] = False
    return out


# --------------------------------------------------------------------------
# Sen1Floods11 data
# --------------------------------------------------------------------------

def _fetch(url, path: Path):
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(path)


def download_sen1floods11(dest, split="train", limit=None, seed=0):
    """Download hand-labelled S1 chips and labels for one split.

    split: "train", "valid" or "test". `limit` takes a seeded random subset
    (the CSVs are ordered by region, so the head alone would be all Ghana).
    Files go to dest/S1Hand and dest/LabelHand; existing files are skipped.
    Returns a list of (s1_path, label_path).
    """
    if split not in ("train", "valid", "test"):
        raise ValueError("split must be train, valid or test")
    dest = Path(dest)
    csv_path = dest / "splits" / f"flood_{split}_data.csv"
    _fetch(SPLIT_URL.format(split=split), csv_path)
    rows = [ln.strip().split(",") for ln in csv_path.read_text().splitlines() if ln.strip()]
    if limit is not None and limit < len(rows):
        rng = np.random.default_rng(seed)
        idx = sorted(rng.choice(len(rows), size=limit, replace=False))
        rows = [rows[i] for i in idx]
    pairs = [(dest / "S1Hand" / a, dest / "LabelHand" / b) for a, b in rows]
    jobs = []
    for (s1_name, lab_name), (s1, lab) in zip(rows, pairs):
        jobs.append((S1_URL.format(name=s1_name), s1))
        jobs.append((LABEL_URL.format(name=lab_name), lab))
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(lambda j: _fetch(*j), jobs))
    return pairs


def read_chip(s1_path, label_path):
    """Read one chip. Returns (2,H,W) dB float32 (raw, NaN kept) and (H,W) int8 label."""
    import rasterio

    with rasterio.open(s1_path) as f:
        x = f.read().astype(np.float32)
    with rasterio.open(label_path) as f:
        y = f.read(1).astype(np.int8)
    return x, y


def make_dataset(pairs, crop=None):
    """PyTorch Dataset over (s1_path, label_path) pairs.

    Item: x float32 (2,H,W) normalised, y float32 (H,W) with -1 = ignore.
    crop: optional int; a random crop of that size (use for faster CPU training).
    """
    import torch
    from torch.utils.data import Dataset

    class Sen1Floods11Dataset(Dataset):
        def __init__(self, pairs, crop):
            self.pairs = list(pairs)
            self.crop = crop

        def __len__(self):
            return len(self.pairs)

        def __getitem__(self, i):
            x, y = read_chip(*self.pairs[i])
            # no-data pixels in the image must not be scored as water either
            y = np.where(np.isfinite(x).all(axis=0), y, -1).astype(np.float32)
            x = normalise_db(x)
            if self.crop:
                H, W = y.shape
                r = np.random.randint(0, max(H - self.crop, 0) + 1)
                c = np.random.randint(0, max(W - self.crop, 0) + 1)
                x = x[:, r:r + self.crop, c:c + self.crop]
                y = y[r:r + self.crop, c:c + self.crop]
            return torch.from_numpy(np.ascontiguousarray(x)), torch.from_numpy(np.ascontiguousarray(y))

    return Sen1Floods11Dataset(pairs, crop)
