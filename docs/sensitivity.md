# Sensitivity and uncertainty (Dagupan, 25-year flood)

This page tests how much the published Dagupan result depends on choices the model had to make. Reproduce it with `uv run python scripts/run_sensitivity.py` (about 4 minutes; seed 20261114; 200 random placements). Raw numbers are in `results/sensitivity_dagupan_25yr.json`. The published outputs in `results/` are not changed by this script.

All shares below use the same denominator as the main pipeline: the 71,680 exposed residents who live on the road network. Before anything else, the script rebuilds the published run and checks that the access gap, the 3/5/8 coverage shares and the chosen sites all match `results/summary_25yr.json`.

## The published numbers, for reference

| | Share of exposed residents within a 30 minute walk |
|---|---|
| Existing clinics alone, during the flood | 83.9% |
| Clinics plus 3 dose points | 92.3% |
| Clinics plus 5 dose points | 94.8% |
| Clinics plus 8 dose points | 97.0% |

The access gap (residents who could reach a clinic on a dry day but cannot during the flood) is 2,485.

The clinics-only 83.9% is the baseline. The dose points add 8.4, 10.9 and 13.1 percentage points on top of it. Quote the plan numbers next to the 84% so that nobody reads 92% as if it started from zero.

## a. Where the flood falls inside each barangay

**Problem.** NOAH tells us what share of each barangay floods, not which streets. The model puts the flood on the lowest nodes by elevation. In flat Dagupan the 30 m elevation data cannot separate streets well, so that ordering is close to arbitrary. The published run is one draw from a set of possible placements.

**Check.** The script redraws the placement 200 times. In each draw the nodes of a barangay are shuffled at random, and the same number of nodes per barangay still go to high, medium and low. Everything else (roads, clinics, candidate sites, population, 30 minutes, 4.5 km/h) stays as published. Each draw gets a fresh optimal 3, 5 and 8 site plan.

| Result | Published | Median of 200 draws | 5th to 95th percentile |
|---|---|---|---|
| Access gap (residents) | 2,485 | 2,493 | 1,417 to 3,944 |
| Clinics alone | 83.9% | 86.0% | 83.9% to 87.5% |
| Clinics plus 3 dose points | 92.3% | 93.8% | 92.7% to 94.8% |
| Clinics plus 5 dose points | 94.8% | 96.1% | 95.1% to 97.0% |
| Clinics plus 8 dose points | 97.0% | 98.4% | 97.5% to 99.0% |

**What it shows.**

- The size of the gap depends strongly on placement: the 5 to 95 percent range runs from about 1,400 to about 3,900. The published 2,485 is a typical value (it sits at the 50th percentile of the draws).
- The published coverage figures are on the low side. The published clinics-only share is at about the 5th percentile, and the published 3 site share is below 98.5% of the random draws. So the published result is, if anything, conservative on coverage. The qualitative finding holds in every draw: clinics alone leave roughly 11 to 18 percent of exposed residents out of reach, and a handful of dose points moves the 3 point plan to 91.5 to 95.4 percent and the 8 point plan to 97.0 to 99.3 percent.
- Which sites get picked is not stable. For k=3 the most frequent site, Leon-Francisco Maramba Elementary School, is chosen in 72.5% of draws and is not in the published plan. The two published sites that are frequent are Bolosan Elementary School (51.0%) and Lucao Barangay Hall (33.0%). The third published site, Bonuan Boquig National High School, is chosen in 10.5% of draws. The exact published set of three comes up in 1% of draws.

**What it does not show.** It does not say which streets actually flood. It treats every within-barangay placement as equally likely, which is wrong: water follows terrain, and a real flood map would beat any of these draws. It also does not cover uncertainty in the NOAH area shares themselves, in population per node, or in OSM completeness.

**How to use it.** Treat the specific site names in the published plan as one good option, not the answer. Treat "which barangays or clusters of sites matter" as more reliable than "which exact building". Site choice should be confirmed on the ground and against a real flood map before use.

## b. The three uncited parameters, and the edge rule

**Problem.** The 30 minute limit, the 4.5 km/h walking speed, and the speed factors (low 0.6, medium 0.25, high closed) are not sourced. Also, an edge takes the less severe of its two end nodes, so a street with one dry end stays open. That understates blockage.

**Check.** All 24 combinations of: walk limit 15, 20, 30 minutes; speed 3.0 or 4.5 km/h; published factors or a harsher set (low 0.4, medium 0.1, high closed); edge rule min (published) or max (the more severe endpoint). The flood placement stays the elevation-based one. Full table in the JSON; selected rows:

| Limit (min) | Speed (km/h) | Factors | Edge rule | Clinics alone | Gap | 3 points | 5 points | 8 points |
|---|---|---|---|---|---|---|---|---|
| 30 | 4.5 | published | min | 83.9% | 2,485 | 92.3% | 94.8% | 97.0% |
| 30 | 4.5 | harsh | min | 78.6% | 6,291 | 87.4% | 91.2% | 94.3% |
| 30 | 4.5 | published | max | 71.4% | 11,450 | 79.5% | 83.2% | 87.1% |
| 30 | 4.5 | harsh | max | 58.6% | 20,656 | 65.8% | 69.7% | 74.6% |
| 30 | 3.0 | published | min | 63.5% | 2,815 | 73.9% | 79.0% | 84.4% |
| 20 | 4.5 | published | min | 63.5% | 2,815 | 73.9% | 79.0% | 84.4% |
| 15 | 4.5 | published | min | 50.1% | 3,515 | 59.8% | 65.0% | 71.8% |
| 15 | 3.0 | harsh | max | 23.9% | 12,377 | 29.2% | 32.3% | 35.6% |

(A 30 minute limit at 3.0 km/h is the same distance as 20 minutes at 4.5 km/h, so those rows match.)

**What it shows.**

- The result is sensitive to these choices, much more than to placement. Every step toward a shorter limit, a slower walker, a harsher flood or the max edge rule lowers coverage, and the published settings are the most generous corner of the grid.
- The edge rule matters most. Using the more severe endpoint takes clinics-only coverage from 83.9% to 71.4% and the access gap from 2,485 to 11,450, with the other settings as published.
- In every one of the 24 settings, adding dose points raises coverage. The gain from 3 points is between about 5 and 11 percentage points over clinics alone, and 8 points always adds more than 3. The ranking of plan sizes does not change, but the absolute shares do.

**What it does not show.** It does not tell us which setting is right. No setting here is calibrated to measured wading speeds, closure data or Dagupan flood depths. Read the 83.9% and 92.3% as "under the published, generous settings", not as the expected outcome.

## c. Coverage ceiling

**Check.** Open every usable candidate site (80 of 80; none is in the high class under the published placement) together with the clinics, and count who is within a 30 minute walk during the flood.

**Result.** 98.9% of exposed residents are within reach. 781 exposed residents are not reachable from any clinic or candidate site, even with all of them open. This is the cap that no siting plan can pass under these settings. Those residents need outreach (mobile teams, boats, delivery), not another fixed dose point. The 8 site plan (97.0%) already captures most of the ceiling.

**Does not show.** The ceiling is only as good as the candidate list from OpenStreetMap (townhalls, community centres, schools) and the road graph. A missing school or road in OSM lowers it.

## d. Dry-day plan versus flood plan

**Check.** Solve the 3 site plan again on the dry graph (no flood closures), covering the same exposed residents that clinics miss, and compare with the flood plan.

**Result.** All 3 of 3 sites match the flood plan (Lucao Barangay Hall, Bolosan Elementary School, Bonuan Boquig National High School). Used in the flood, the dry plan reaches the same 92.3%.

**What it shows and does not show.** With the published placement and the published speed factors, modelling the flood does not change which three sites are picked. So the flood model is not what drives the site choice here. That is a finding in its own right: the plan is chosen by geography and where the exposed residents are, and the flood closures mainly change the baseline coverage (who the clinics reach) and the total, not the sites. It does not show that this would hold with a different flood placement. Section a shows that site choice moves when the placement moves.

## Summary of what to claim

- Say: clinics alone reach about 84% of exposed residents who are on the road network under the published settings, and 3, 5 and 8 dose points raise that to 92%, 95% and 97%.
- Say: across 200 random flood placements the 3 point result ranges from 92.7% to 94.8%, so the placement of the flood inside each barangay does not drive the headline numbers, but it moves the access gap by a factor of about 2.8 (1,400 to 3,900) and it moves which individual sites get chosen.
- Say: the headline levels depend on the unsourced walking limit, speed, speed factors and edge rule, and the published settings are the generous end of the range tested.
- Do not say: the specific three sites are the optimal sites, or that 92.3% is the expected coverage in a real flood.
