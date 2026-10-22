# Validation: does the flood ranking match what was reported?

Code: `src/lambat/validation.py`. Run: `uv run python scripts/run_validation.py` (about 45 s). Outputs: `results/validation_table.csv` (every candidate and outcome) and `results/validation_summary.json`. Tests: `tests/test_validation.py`.

## Question

LAMBAT ranks Dagupan's 31 barangays by how much of each is flooded in a UP NOAH scenario. News and city reports name barangays flooded in 13 events (2023 to 2026; 26 of 31 barangays appear at least once; see `data/validation/README.md`). Do barangays that the model calls flood-prone show up more often in the reports?

## Method, fixed before looking at the new numbers

The candidate list, outcomes and selection rule were written into `validation.py` first. All candidates are reported, none dropped.

**Outcome (primary).** Number of distinct reported events that name the barangay. Secondary outcomes: tidal events only (event name contains "tide" or "surge": 7 events) and all other events (6 events).

**Candidate predictors (18 in the family).** Higher value means "expected to flood more often", so distance to coast and elevation are negated.

| Group | Candidates |
|---|---|
| NOAH flooded share, all depths | `noah_{5,25,100}yr_all` |
| NOAH area share by depth class | `noah_{5,25,100}yr_{low,med,high}` (9) |
| Exposed residents | `exposed_25yr` (population x 25yr share) |
| Physical, non-NOAH | `coast_proximity` (minus CCHAIN `brgy_distance_to_coast`), `low_elevation` (minus mean Terrarium elevation on a 100 m grid inside the barangay) |
| Combinations decided in advance | rank average of 25yr share and coast proximity; of 25yr share and low elevation; of coast proximity and low elevation |

**Reference rows, not in the family:** population, log population, population density. They measure how much the reports follow where people live (news bias).

**Statistics for each candidate.** Spearman rho. 95% bootstrap CI (5,000 resamples of barangays). Two-sided permutation p-value (10,000 shuffles). Holm-adjusted p across the 18 candidates. Partial Spearman controlling for log population (own bootstrap CI and permutation p; these partial p-values are not multiplicity-adjusted). Event-level AUC: for each event naming at least 3 barangays, the chance that a reported barangay scores higher than an unreported one, averaged over events (5 events qualify; CI resamples events; p shuffles reported labels inside each event). Seed 20261023.

**Already known before pre-registration (flagged `seen_before` in the CSV):** `noah_25yr_all` (-0.10), `exposed_25yr` (0.26), `noah_5yr_med` (0.33). The other 15 candidates were computed after the code was written.

**Model selection rule.** Keep the baseline, `noah_25yr_all`, unless an alternative has both (1) a paired-bootstrap 95% CI of rho(alternative) minus rho(baseline) that excludes 0, and (2) a Holm-adjusted p below 0.05. Highest rho wins among those that qualify. If none qualify the baseline stays. This is deliberately not "highest correlation".

## Results: primary outcome (events per barangay, n = 31)

| Candidate | rho | 95% CI | p | Holm p | Partial rho (pop. controlled) | Partial 95% CI | Event AUC |
|---|---|---|---|---|---|---|---|
| noah_5yr_all | 0.108 | -0.271, 0.484 | 0.558 | 1.00 | 0.173 | -0.183, 0.521 | 0.590 |
| **noah_25yr_all (baseline)** | **-0.105** | **-0.484, 0.304** | 0.572 | 1.00 | -0.157 | -0.495, 0.238 | 0.437 |
| noah_100yr_all | -0.467 | -0.753, -0.113 | 0.009 | 0.16 | -0.510 | -0.746, -0.213 | 0.289 |
| noah_5yr_low | 0.021 | -0.375, 0.441 | 0.910 | 1.00 | 0.054 | -0.335, 0.456 | 0.557 |
| noah_5yr_med | 0.327 | -0.052, 0.628 | 0.074 | 1.00 | 0.461 | 0.138, 0.726 | 0.691 |
| noah_5yr_high | 0.085 | -0.211, 0.376 | 0.649 | 1.00 | 0.057 | -0.265, 0.363 | 0.537 |
| noah_25yr_low | -0.164 | -0.500, 0.189 | 0.375 | 1.00 | -0.334 | -0.616, 0.000 | 0.406 |
| noah_25yr_med | 0.111 | -0.283, 0.498 | 0.551 | 1.00 | 0.161 | -0.230, 0.534 | 0.548 |
| noah_25yr_high | 0.111 | -0.256, 0.475 | 0.547 | 1.00 | 0.200 | -0.162, 0.529 | 0.593 |
| noah_100yr_low | -0.040 | -0.444, 0.363 | 0.837 | 1.00 | -0.137 | -0.513, 0.266 | 0.466 |
| noah_100yr_med | -0.137 | -0.521, 0.287 | 0.461 | 1.00 | -0.162 | -0.529, 0.255 | 0.439 |
| noah_100yr_high | -0.084 | -0.466, 0.329 | 0.649 | 1.00 | 0.054 | -0.347, 0.439 | 0.510 |
| exposed_25yr | 0.261 | -0.016, 0.485 | 0.159 | 1.00 | -0.229 | -0.534, 0.208 | 0.563 |
| coast_proximity | 0.095 | -0.273, 0.442 | 0.616 | 1.00 | -0.034 | -0.417, 0.330 | 0.494 |
| low_elevation | -0.529 | -0.753, -0.216 | 0.002 | 0.04 | -0.632 | -0.797, -0.387 | 0.253 |
| combo_haz25_coast | 0.015 | -0.316, 0.362 | 0.938 | 1.00 | -0.157 | -0.511, 0.232 | 0.457 |
| combo_haz25_elev | -0.442 | -0.730, -0.073 | 0.016 | 0.25 | -0.589 | -0.794, -0.268 | 0.290 |
| combo_coast_elev | -0.328 | -0.549, -0.015 | 0.070 | 1.00 | -0.509 | -0.718, -0.209 | 0.307 |
| *population (ref.)* | 0.347 | 0.048, 0.571 | 0.058 | n/a | n/a | n/a | 0.599 |
| *pop. density (ref.)* | 0.638 | 0.346, 0.828 | <0.001 | n/a | 0.610 (vs log pop.) | 0.355, 0.813 | 0.758 |

Event AUC 0.5 means no skill; below 0.5 means reported barangays scored lower than unreported ones. The AUC uses 5 events, so its CI is wide in spirit even where it looks narrow (it resamples only 5 events).

The tidal and non-tidal tables are in the CSV. They tell the same story: 25yr flooded share rho is -0.032 (tidal, 7 events) and -0.110 (non-tidal, 6 events); coast proximity does not help for tidal events either (-0.083); `noah_5yr_med` is 0.285 and 0.389 (the latter has CI 0.040 to 0.661, Holm p 0.53).

## What we conclude

1. **The current model (25yr flooded share) has no detectable agreement with reports.** rho = -0.105, 95% CI -0.484 to 0.304, p = 0.57. The data cannot rule out moderate agreement either way. It does not show agreement.
2. **No alternative beats it by the pre-registered rule.** `noah_5yr_med` has the best positive rho (0.327), but its raw p is 0.074 (Holm 1.00) and the CI of its difference from the baseline (-0.031 to 0.851) includes 0. The only candidates with significant Holm p are the wrong sign (below). The dashboard keeps the 25yr model. The headline number is rho = -0.105 (CI -0.484 to 0.304), reported with its interval.
3. **The reports follow people.** Population density correlates 0.638 with report counts (CI 0.346 to 0.828); population alone 0.347 (CI 0.048 to 0.571). News is biased toward dense downtown barangays. This does not make the model right or wrong, but it means report counts are a poor ruler.
4. **Controlling for population does not rescue the model.** Partial rho for the baseline is -0.157 (CI -0.495 to 0.238). The one positive partial that stands out, `noah_5yr_med` at 0.461 (CI 0.138 to 0.726, raw p = 0.010), is one of 18 candidates and is not multiplicity-adjusted: 0.010 x 18 = 0.18. It is also one we had already seen. Treat it as a lead for more data, not as a finding.
5. **Some candidates are significantly the wrong way round.** `low_elevation` (rho -0.529, Holm p 0.04), `noah_100yr_all` (-0.467, Holm 0.16) and the elevation combinations mean that reported barangays sit on average higher in the Terrarium DEM and have less 100yr flooded area. Likely reason, not tested: the DEM is ~30 m SRTM-class and reads building and canopy heights in the dense downtown, and downtown is where reporters are. A reading in which downtown barangays are both more reported and higher in the DEM would produce this without the DEM being useful for flood risk. It is not evidence that high ground floods more.
6. **Tidal flooding is not captured by distance to coast.** For the 7 tidal events, coast proximity has rho -0.083. The CCHAIN coast distance may not describe the Pantal-Sinocalan river and tide-affected barangays, which are inland.

## Caveats

- 31 barangays and 13 events. A CI of about 0.8 wide is what this sample allows. Failing to find agreement is not the same as showing disagreement.
- 18 candidates and 3 outcomes were tested. Holm adjusts the raw p across the 18 candidates for each outcome. Partial p-values and the event AUC p-values are not adjusted.
- The reports are not a census. Most articles give counts ("nearly 30 barangays") without names, so many true floods are recorded as "not reported". The outcome is a noisy, biased proxy.
- The Aug 2026 rows partly come from evacuation lists, not flood reports.
- NOAH maps rainfall and river hazard, not tide. Reports mix both. The tidal split is by event name only.
- Event AUC uses only the 5 events naming at least 3 barangays (2 tidal, 3 non-tidal).
- Terrarium elevation is coarse and was used as a rank signal only. One new Terrarium tile was cached while building the elevation column.
- Pre-registration here is by code and docs written before the new correlations were read. It is not a public time-stamped registration, and three candidates had already been seen.

## Next steps

- More event data with named barangays (DROMIC, city Facebook posts) to shrink the CI.
- Replace the DEM with a better source, or use a measured flood extent (Sentinel-1) from a real event date.
- Report agreement for downtown versus other barangays separately, or weight by population, once more reports exist.
