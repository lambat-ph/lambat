# Data

Nothing in `raw/` or `processed/` is committed. The files are large and belong to their owners.

| Source | Used for | Licence | Where |
|---|---|---|---|
| Project CCHAIN (Thinking Machines) | Weekly leptospirosis cases per city 2008 to 2022, daily barangay rainfall | CC BY 4.0 | https://www.kaggle.com/datasets/thinkdatasci/project-cchain |
| UP NOAH hazard maps | Flood extent by return period | Check terms on site | https://noah.up.edu.ph |
| Sentinel-1 GRD (Copernicus) | Observed flood extent | Free and open | https://dataspace.copernicus.eu |
| Sen1Floods11 | Training labels for the U-Net | CC BY 4.0 | https://github.com/cloudtostreet/Sen1Floods11 |
| OpenStreetMap | Roads, barangay halls, evacuation centres | ODbL | via `osmnx` |
| Population grid (WorldPop or Meta HRSL) | Residents per cell | CC BY 4.0 | https://www.worldpop.org |
| DOH health facility registry | Clinic locations | Public | https://nhfr.doh.gov.ph |

## Project CCHAIN tables

Download into `data/raw/cchain/`:

- `disease_pidsr_totals.csv`: weekly cases per city
- `climate_atmosphere.csv`: daily weather per barangay (570 MB)
- `location.csv`: barangay and city codes
- `brgy_geography.csv`: barangay boundaries and coastal flag
- `worldpop_population.csv`: residents per barangay (WorldPop)
- `project_noah_hazards.csv`: UP NOAH flooded area share per barangay, by return period and depth class

Each table can be fetched without logging in (large files arrive zipped):

```bash
mkdir -p data/raw/cchain
for t in disease_pidsr_totals climate_atmosphere location brgy_geography worldpop_population project_noah_hazards; do
  curl -L -o data/raw/cchain/$t.csv     https://www.kaggle.com/api/v1/datasets/download/thinkdatasci/project-cchain/$t.csv
done
```

If a file arrives zipped, unzip it in place so that `data/raw/cchain/<table>.csv` exists.

## Downloaded or cached automatically

- OpenStreetMap roads and sites: `data/raw/osm_cache/` on the first pipeline run.
- Elevation tiles (AWS Terrarium): `data/raw/dem_cache/`.
- Sen1Floods11 chips for the U-Net: `data/raw/sen1floods11/`, fetched by `scripts/train_unet.py`.

## Sentinel-1 scenes (manual)

Download the two scenes listed in `docs/sentinel1.md` from the Copernicus Data Space into `data/raw/s1/` (zip files are fine; they are read without extracting).
