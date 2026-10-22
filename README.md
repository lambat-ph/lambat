# LAMBAT

**Leptospirosis Alert, Mapping and Barangay Allocation Tool.** A decision tool for a city health office after a flood. Pilot city: Dagupan, Pangasinan.

After a flood, a health officer has to decide which barangays get temporary doxycycline dose points and how many capsules each needs for every week the water stays. LAMBAT puts exposure and reachability on one map:

1. **Where is the water?** Flood extent from the UP NOAH hazard map, then from Sentinel-1 radar when a pass arrives (simple threshold vs a U-Net trained on Sen1Floods11).
2. **Who was in it?** Flood extent over a population grid gives exposed residents per barangay, and capsule need by guideline tier.
3. **Who can still reach care?** Walking time over OpenStreetMap roads, with flooded segments slowed or closed.
4. **Where should dose points go?** A maximal covering location model picks 3, 5 or 8 sites that put the most exposed residents within 30 minutes on foot.
5. **Should hospitals get ready?** A separate rainfall-based alert, one to two weeks ahead, for case surges.

The claim that floods cut residents off from prevention is a **hypothesis this tool tests**, not an assumption it relies on. If the access gap turns out to be small, the exposure and capsule estimates are still useful. The outcome we report is residents within reach of care, never lives saved.

## Status

| Part | State |
|---|---|
| Signal tests on Project CCHAIN (`analysis/`) | Done. Leptospirosis follows rain 2 to 4 weeks earlier (pooled r = 0.29, Dagupan r = 0.45) |
| Dose-point siting (`src/lambat/siting.py`) | Greedy and exact MCLP solvers, tested |
| Data download and cleaning | Not started |
| Flood extent, exposure, access | Not started |
| Outbreak alert | Not started |
| Dashboard (`web/`) | Not started |

## Setup

Requires [uv](https://docs.astral.sh/uv/). uv installs the right Python version for you.

```bash
uv sync
uv run pytest
```

The computer-vision part (U-Net) has heavier dependencies and is optional:

```bash
uv sync --extra cv
```

## Layout

```
analysis/        signal tests used to choose the disease (Node.js, no packages)
data/            raw and processed data, not committed (see data/README.md)
docs/            method notes and figures
notebooks/       exploration
src/lambat/      the pipeline, one module per step above
tests/           pytest
web/             dashboard (MapLibre GL, reads GeoJSON written by the pipeline)
```

## Data

All inputs are public and hold no personal data. Sources and licences are listed in [data/README.md](data/README.md).

## Limits

- Case data is weekly, city-level and ends in 2022, so barangay figures are shares of exposure, not case forecasts.
- The rainfall alert cannot see tidal flooding; the flood map can.
- Access is modelled from maps and has not been checked on the ground.
- Each dose point assumes a prescriber is present.
- The tool counts places, not patients. Pregnant and lactating women are flagged for referral, not counted.
