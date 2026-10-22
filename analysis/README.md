# Signal tests on Project CCHAIN

Quick checks run on 12 Oct 2026 to choose the target illness. Plain Node.js, no packages.

## Data

Download these tables from the Project CCHAIN dataset on Kaggle (CC BY 4.0) into this folder:
https://www.kaggle.com/datasets/thinkdatasci/project-cchain

- `disease_pidsr_totals.csv` (weekly cases per city, DOH surveillance, 2008 to 2022)
- `disease_psa_totals.csv` (weekly deaths per city, PSA, 2006 to 2021)
- `climate_atmosphere.csv` (daily weather per barangay, 570 MB unzipped)
- `climate_air_quality.csv` (daily modelled air quality per barangay, 457 MB unzipped)

The data files are not committed. They are large and belong to their owners.

## Scripts

Run in order. The first run of script 01 builds `clim_week.json`, which script 03 reuses.

| Script | Question | Result |
|---|---|---|
| `01_signal_test_heat_vs_rain.mjs` | Do heart-disease deaths follow heat? Do leptospirosis cases follow rain? | Heat: pooled correlation 0.004. Leptospirosis vs rain 2 to 4 weeks before: pooled 0.29, above 0.4 in Dagupan, Navotas, Muntinlupa |
| `02_signal_test_air_quality.mjs` | Do asthma or heart-disease deaths follow air pollution? | No. All correlations within 0.02 of zero |
| `03_holdout_forecast_test.mjs` | Does a simple rain model beat a seasonal baseline 2 weeks ahead? Train 2008 to 2016, test 2017 to 2019 | Only slightly. Weekly error improves 0 to 5%. Correlation improves in Dagupan (0.51 to 0.66) and Navotas (0.42 to 0.51) |

## Caveats

- Correlations are on deseasonalised weekly series and ignore week-to-week carry-over, so treat exact values as rough.
- Script 03 is a deliberately simple linear model. It is a floor, not the planned forecast.
- Weekly counts per city are small (often 0 to 3), which limits what any weekly model can show.
