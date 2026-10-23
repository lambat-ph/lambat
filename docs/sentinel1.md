# Sentinel-1 flood map: Typhoon Egay, Dagupan

A real flood, mapped from radar and compared with the UP NOAH hazard map and with news reports. Code: `src/lambat/sentinel1.py`, `scripts/run_s1_flood.py`. Tests: `tests/test_sentinel1.py`.

```bash
uv run python scripts/run_s1_flood.py          # needs the two scenes in data/raw/s1/
```

## Scenes

| Role | Scene (Sentinel-1A, IW GRDH, VV+VH) | Date |
|---|---|---|
| Flood | `S1A_IW_GRDH_1SDV_20230728T214651_..._049629_05F7C6_F885_COG` | 28 Jul 2023, about 2 days after Egay's landfall |
| Dry reference | `S1A_IW_GRDH_1SDV_20230411T214646_..._COG` | 11 Apr 2023 |

Both are relative orbit (track) 32, descending, so the viewing angle is the same and the two dates can be compared pixel by pixel. The zips are untrusted downloads: nothing in them is executed, and only the small calibration XML files are read from the archive. The big measurement TIFFs are read in a small window.

## Method

1. **Calibrate.** The calibration XML holds a gain table (sigma-nought) on a coarse line/pixel grid. It is interpolated bilinearly to every pixel in the window. Backscatter is `sigma0 = DN^2 / A^2`, then dB. DN 0 is no-data.
2. **Crop and reproject.** The TIFF is in radar geometry with ground control points. A quadratic map from lon/lat to line/pixel is fitted to the 9 GCPs nearest Dagupan (an affine fit was about 13 px off in a leave-one-out check, the quadratic about 1 px; the fit error is saved in the summary), the window is cut with 100 pixels of padding, and the result is resampled (bilinear on linear power) onto one fixed 10 m EPSG:32651 grid. The grid covers all barangays plus 1 km, so both dates land on identical pixels.
3. **Speckle.** A 5x5 median filter in dB, the same for both dates. Use `--speckle 1` to switch it off.
4. **Flood mask (VV).**
   - Change detection, `flood.threshold_extent`: flooded if after < -18 dB and at least 3 dB darker than the dry scene. This is the main result.
   - Otsu on the flood image alone, `flood.otsu_threshold`, computed over the city's pixels. No dry scene needed, so it also marks anything that is always dark.
   - U-Net trained on Sen1Floods11 (`checkpoints/unet_sen1floods11.pt`), run on the flood image only, if the checkpoint and torch exist.
5. **Permanent water.** Anything below -18 dB in the dry scene (rivers, fishponds, the coast) is removed from every mask and from the denominator.
6. **Per barangay.** Flooded share = flooded pixels / pixels that are valid on both dates and not permanent water. Pixels outside the city boundary are ignored.

## Comparisons

- **NOAH.** Spearman correlation (bootstrap 95% CI, resampling barangays) between the S1 flooded share and the NOAH flooded share for the 5, 25 and 100 year return periods (low + medium + high classes), as in `lambat.validation`.
- **News reports.** `data/validation/dagupan_flood_reports.csv`, event "Typhoon Egay / habagat 2023", 26 named barangays, all of which match the LAMBAT barangay list (the source also names "Barangay 3", which has no match). The AUC is the chance that a reported barangay has a higher S1 flooded share than an unreported one (0.5 = no signal). The CI resamples barangays; the p-value shuffles which barangays count as reported. Spearman of the share against the 0/1 report flag is also given. The article says all barangays flooded at varying levels, so the "unreported" group is only five barangays. Read the AUC as weak evidence either way.

## Outputs (`results/`)

- `s1_egay_barangays.csv`: per barangay, S1 shares for each method, NOAH shares, land and flooded km2, report flag.
- `s1_egay_flood.geojson`: the same on barangay polygons.
- `s1_egay_quicklook.png`: VV after, change (after minus before), mask. Yellow lines are barangay boundaries.
- `s1_egay_summary.json`: scene info, grid, thresholds, totals, all correlations and AUCs.
- Cached crops: `data/processed/s1_<yyyymmdd>.tif` (VV, VH in dB).

## Results

Pending the run on the real scenes. So far the code has been tested on synthetic scenes only: a synthetic SAFE folder with GCPs goes through the whole script, and the calibration, GCP window and grid logic are unit tested. After `scripts/run_s1_flood.py` runs, the numbers here come from `results/s1_egay_summary.json`.

## Caveats

- **One snapshot.** The image was taken about 2 days after landfall. Water may already have drained from fast-draining areas, or may not yet have peaked in slow ones (Dagupan sits at the end of the Agno and Pantal river systems, and floodwater there lingers). A single date cannot say which.
- **Cities hide floods from radar.** In streets and buildings, water next to walls bounces the signal back to the sensor (double bounce), which makes flooded urban pixels brighter, not darker. A change-detection rule that looks for dark water misses these. Downtown Dagupan is exactly this case, so the S1 shares are probably too low in the dense barangays.
- **Radar cannot see under roofs**, so flooding inside buildings is invisible.
- **Fishponds and rice paddies.** Dagupan has many fishponds. They are dark all year, so they are excluded as permanent water. Rice fields in July can be wet or newly planted and can darken for reasons unrelated to the flood.
- **Wind and rain.** Rough water looks bright to radar and can hide flooded areas; heavy rain can also darken land.
- **Thresholds.** -18 dB and 3 dB are the repo defaults, not tuned on this event. Results are reported as they come out.
- **Accuracy of the crop.** The GCP fit puts the image on the ground to within a few pixels, which is fine for barangay totals but not for single streets.
- **The news list is not ground truth.** It names barangays, not depths, and almost the whole city is on it.
