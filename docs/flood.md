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
uv run --extra cv python scripts/train_unet.py --epochs 15 --pretrained   # full run, all chips
uv run --extra cv python scripts/train_unet.py --epochs 8 --limit 40 --test-limit 15   # quick check
```

Loss is BCE plus Dice with no-data pixels masked out. Training uses random 256 px crops, batch size 4, Adam at 1e-3, seed 0, and an ImageNet-pretrained resnet34 encoder. The checkpoint goes to `checkpoints/` (git-ignored). Each epoch is scored on the valid split and the best epoch's weights are kept. Then the script scores the test split for the U-Net and for a per-chip Otsu threshold on VV.

## Results (full run, Oct 23 2026)

What was compared: a U-Net (VV and VH in, water mask out) against the simplest single-image baseline, an Otsu threshold on VV computed separately for each chip. Both are scored against the hand-labelled water masks with IoU (overlap divided by union), ignoring no-data pixels.

Data: 252 train, 89 valid, 90 test chips (Sen1Floods11 hand-labelled split). Valid chips only pick the best epoch. Test chips are never used for training or selection.

Run: 15 epochs, best epoch 14 (valid pooled IoU 0.611), 723 s total (about 12 minutes), CPU only (PyTorch 2.14.1 CPU build, 16 logical cores). A GPU was present but not used.

| Test IoU | U-Net | Otsu (VV) |
|---|---|---|
| Per-chip median | 0.333 | 0.046 |
| Per-chip IQR | 0.105 to 0.592 | 0.013 to 0.333 |
| Pooled over all pixels | 0.639 | 0.208 |
| Chips scored (n) | 87 | 89 |
| Per-chip mean, 82 chips that contain water | 0.395 | 0.228 |
| Per-chip median, same 82 chips | 0.372 | 0.062 |

How to read the n column: a chip's IoU is undefined when neither the label nor the prediction has any water. The U-Net predicts no water on 2 more dry chips than Otsu does, so those 2 drop out of its per-chip numbers. The last two rows use only the 82 test chips whose label contains water, which puts both methods on the same chips. On those 82 chips the U-Net scores higher than Otsu on 67. The mean and the 82-chip rows come from a one-off check script, not from `train_unet.py`.

## Caveats

- Test chips are from other countries and flood events, not Dagupan. This says nothing yet about performance on Dagupan or on tidal flooding.
- Scores are on the hand-labelled split only (roughly 512 x 512 px chips). The weakly-labelled Sen1Floods11 data is not used.
- The per-chip scores are spread wide (IQR 0.105 to 0.592). Many chips have very little water, and IoU is harsh on those. The pooled IoU of 0.639 is the more stable figure, and the per-chip median of 0.333 is the more conservative one.
- One training run, one seed. The valid IoU moved between 0.51 and 0.61 from epoch to epoch, so a different seed could shift the test numbers by a few points.
- Otsu is a weak baseline here: one threshold per chip, VV only, no before image. A before/after change threshold (`threshold_extent`) is not part of this comparison.
- Bug fixed in `scripts/train_unet.py`: a test chip with all-NaN VV crashed the Otsu step. Such chips now get an empty mask.
