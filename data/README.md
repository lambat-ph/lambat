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

Each table can be fetched without logging in (large files arrive zipped):

```bash
curl -L -o data/raw/cchain/disease_pidsr_totals.csv \
  https://www.kaggle.com/api/v1/datasets/download/thinkdatasci/project-cchain/disease_pidsr_totals.csv
```
