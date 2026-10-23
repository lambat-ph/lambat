# Development notes

How the code fits together, how to run it, and what is still open. Keep this current; it is what a new contributor reads first.

## Run

```bash
uv sync                                   # core deps; Python 3.13 via uv
uv run pytest -q                          # 62 pass with the cv extra; U-Net tests skip without torch
uv run python scripts/run_alert.py        # Dagupan alert evaluation -> results/PH015518000/alert_*
uv run python scripts/run_alert.py --city all --pooled   # all 12 cities plus the pooled model
uv run python scripts/run_pipeline.py --scenario 25yr   # Dagupan: exposure, access, siting -> results/PH015518000/ (and flat results/)
uv run python scripts/run_pipeline.py --city all          # the 12 CCHAIN cities in sequence (hours: Overpass is slow)
uv run python scripts/run_pipeline.py --city PH112402000 --scope flooded   # one city, walk graph limited to flooded barangays + 2 km
uv sync --extra cv                        # torch + segmentation-models-pytorch
uv run --extra cv python scripts/train_unet.py --epochs 15 --pretrained
uv run python scripts/run_validation.py   # ranking vs news reports -> results/validation_*
uv run python scripts/run_s1_flood.py     # Sentinel-1 Egay flood map (scenes in data/raw/s1/)
uv run python scripts/build_web.py        # publish results into web/data/ (cities.json, national.json, <code>/...)
```

Raw data is not committed. `data/raw/cchain/` needs these six Project CCHAIN tables (download commands in `data/README.md`): `disease_pidsr_totals`, `climate_atmosphere`, `location`, `brgy_geography`, `project_noah_hazards`, `worldpop_population`. OSM and elevation tiles cache themselves in `data/raw/osm_cache` and `data/raw/dem_cache` on first run (Overpass can take ~65 s per query and sometimes returns 502; the code retries and falls back to mirrors).

## Modules (`src/lambat/`)

| Module | Does | Key functions |
|---|---|---|
| `data.py` | Loads CCHAIN tables for a city (Dagupan = `PH015518000`) | `barangays`, `population`, `flood_hazard`, `weekly_cases`, `weekly_rainfall` (cached to `data/processed/`) |
| `alert.py` | Poisson model of weekly cases from season + rain 2-5 weeks earlier; compared with seasonal and last-week baselines at the same alert budget | `design`, `evaluate` |
| `exposure.py` | Exposed residents = WorldPop x NOAH flooded area share, per barangay and depth class; capsules = exposed x 2 x weeks | `exposed_by_barangay`, `capsule_need` |
| `elevation.py` | AWS Terrarium elevation tiles (zoom 14), cached | |
| `access.py` | OSM walk graph (4.5 km/h); node elevations; NOAH-calibrated flood classes (lowest nodes per barangay get high/med/low to match NOAH shares); flooded edges slowed x0.6 / x0.25 or closed; candidate sites (school, townhall, community centre); health facilities (clinic, hospital, doctors: `HEALTH_KINDS`); ~200 m demand cells; Dijkstra reach sets; access gap | `road_graph`, `flood_classes`, `apply_flood`, `candidate_sites`, `health_facilities`, `demand_points`, `reach_sets`, `access_gap` |
| `siting.py` | Maximal covering location: greedy and exact (PuLP/CBC, pinned `<3`) | `greedy_mclp`, `exact_mclp` |
| `validation.py` | Spearman with bootstrap CI, permutation p, Holm, partial Spearman, event AUC, pre-registered candidate family and model-selection rule | `candidate_table`, `select_model` |
| `sentinel1.py` | Reads a Sentinel-1 GRD SAFE (zip or folder) without extracting, sigma0 calibration, window from GCPs, resample to a 10 m UTM grid over Dagupan, zonal flooded share | `load_sigma0_db`, `write_geotiff` |
| `flood.py` | Sentinel-1 change threshold, Otsu, U-Net (resnet34, 2 bands) on Sen1Floods11, IoU | `threshold_extent`, `otsu_threshold`, `build_unet`, `unet_extent`, `download_sen1floods11`, `iou` |

`scripts/run_pipeline.py` ties steps 2-4 together and compares the barangay ranking with `data/validation/dagupan_flood_reports.csv`.

### Plan detail fields (for the web map)

Written by `scripts/run_pipeline.py`, passed through by `scripts/build_web.py`. All use the same ~200 m demand points, exposed weights and reach sets as the siting step, aggregated to barangay. Existing fields are unchanged.

- `barangays_<scenario>.csv/.geojson`, for k in 3, 5, 8: `reach_after_k` = exposed residents within the walking limit of a clinic or a dose point of the k-point plan; `cut_off_after_k` = exposed residents still without reach. They sum to the barangay's `exposed_network`. Null for barangays outside the walk-graph scope.
- `dose_points_<scenario>.geojson`, per site: `serves` = `{"3": [{"pcode", "residents"}, ...], "5": ..., "8": ...}` (only plans that include the site), the barangays whose cut-off residents the site newly reaches; `newly_reached` = `{"3": n, ...}` (rounded residents). Each newly covered demand point is credited to the first site in plan order (`rank_in_plan`) that reaches it, so per-site numbers add up to the plan's `exposed_newly_covered` (within rounding). Plans are solved independently, so a site can serve different barangays in different plans.
- Logic lives in `siting.attribute_new_coverage` and `siting.reach_by_barangay`.

## Current results (25-year NOAH scenario, Dagupan)

- 71,868 of 208,322 residents exposed; 143,737 capsules per flood week.
- 36 OSM health facilities. Exposed within 30 min walk: 62,625 dry, 60,140 flood; access gap 2,485.
- About 11,500 exposed residents on the network cannot reach a facility in the flood, most of them not even on dry days. 3 / 5 / 8 dose points cover +6,030 / +7,819 / +9,409, i.e. 92 / 95 / 97% within reach.
- Alert, 2017-2019, two weeks ahead: rain model correlation 0.654 vs 0.502 seasonal; catches 36% of outbreak weeks vs 21%; false alerts 1.7% vs 6.8%.
- Validation vs 13 news-reported flood events: Spearman(events, 25yr flooded share) = -0.10 (95% CI -0.48 to 0.30), (events, exposed) = 0.26. 18 pre-registered candidates were tested; none beats the 25yr model by the stated rule, and reports track population density (0.64). See `docs/validation.md`; run `scripts/run_validation.py`.

## Known weaknesses and next steps

1. **Ranking cannot be confirmed by reports.** No detectable agreement; news reports track population density. Coastal distance and elevation did not help (see `docs/validation.md`). Next: the Sentinel-1 Egay extent (`scripts/run_s1_flood.py`, `docs/sentinel1.md`) as an independent check.
2. **OSM gaps.** Five barangays (PH015518010, 011, 016, 027, 028) have no walk-graph nodes; their residents snap to the nearest node (median 933 m). Access figures there are weak.
3. **Coarse elevation.** Terrarium is ~30 m SRTM-class; Dagupan spans a few metres.
4. **U-Net is only tested globally.** Full run done (pooled test IoU 0.64 vs 0.21 for Otsu, median per-chip 0.33 vs 0.05, 90 Sen1Floods11 test chips, CPU, 12 min; see `docs/flood.md`). Not yet checked on Dagupan; single seed. The mean/82-chip rows in `docs/flood.md` come from a one-off script.
5. **Dashboard.** `web/index.html` is a static MapLibre page: barangay map, priority table, dose points and alert chart. It reads `web/data/`, which `scripts/build_web.py` fills from `results/`. The Pages workflow deploys `web/` once the repo is public and Pages is set to build from GitHub Actions.
6. **Sentinel-1 Egay run.** Code is tested on synthetic scenes; the real run needs the two scenes in `data/raw/s1/` (see `docs/sentinel1.md`).

## Conventions

- The project, slides and video must not name the school or team members (organizer rule).
- `uvx ruff check src tests scripts` must pass; CI blocks on it.
- Report residents within reach of care, never lives saved. Treat the access gap as a hypothesis the tool tests.
