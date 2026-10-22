# Flood extent (step 1)

`src/lambat/flood.py` reads a Sentinel-1 scene two ways, for comparison with the UP NOAH hazard map.

**Threshold.** `threshold_extent(before_db, after_db, drop_db=3.0, water_db=-18.0)` marks a pixel as water if VV backscatter after the event is below -18 dB and at least 3 dB darker than before. The drop test keeps permanently dark surfaces out. `otsu_threshold(after_db)` is a single-image alternative that needs no "before" scene.

**U-Net.** `build_unet()` is a segmentation_models_pytorch U-Net (resnet34 encoder, 2 input bands VV and VH, 1 output). Inputs are dB values clipped to [-30, 0] and scaled to [-1, 1]. `unet_extent(vv_vh_array, checkpoint_path, tile=512)` runs tiled inference. Torch is imported only inside functions, so the rest of the package works without the `cv` extra.

**Comparing.** `iou(pred, truth, ignore=-1)` and `agreement(a, b)` work on any two masks on the same grid, including a rasterised NOAH layer.

## Data: Sen1Floods11 (Bonafilia et al., 2020)

Hand-labelled split, v1.1, public on Google Cloud Storage (`gs://sen1floods11`), served over HTTPS:

- Split lists: `https://storage.googleapis.com/sen1floods11/v1.1/splits/flood_handlabeled/flood_{train,valid,test}_data.csv` (252 / 89 / 90 chips)
- Sentinel-1 chips: `.../v1.1/data/flood_events/HandLabeled/S1Hand/<name>_S1Hand.tif` (VV, VH in dB)
- Labels: `.../v1.1/data/flood_events/HandLabeled/LabelHand/<name>_LabelHand.tif` (-1 no data, 0 dry, 1 water)

`download_sen1floods11(dest, split, limit=None)` fetches a split (a seeded random subset when `limit` is set) into `dest/S1Hand` and `dest/LabelHand`. Default location is `data/raw/sen1floods11/`, which is git-ignored. Full split is a few hundred MB.

## Train and compare

```bash
uv sync --extra cv
uv run python scripts/train_unet.py --epochs 8 --limit 40 --test-limit 15   # quick CPU run
uv run python scripts/train_unet.py --epochs 30                              # all chips
```

Loss is BCE plus Dice with no-data pixels masked out. The checkpoint goes to `checkpoints/` (git-ignored). The script prints test IoU, pooled over chips, for the U-Net and for a per-chip Otsu threshold on VV.

Caveat: Sen1Floods11 chips are from other countries and events. A U-Net trained here has not been checked on Dagupan, and tidal flooding there is a known weak point for any radar reading.
