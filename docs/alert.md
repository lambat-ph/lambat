# The two-week rain alert: method and how well it does

Short version: **rain helps in Dagupan, but less than the first table in the README suggests, and not clearly elsewhere.** In Dagupan, a model with rain beats every method without rain on correlation, false alerts and outbreak weeks caught, across eight test years. Across all cities pooled, it does not beat last week's count. Nothing here is a forecast you could act on alone. It is an alert that is right more often than chance.

Numbers come from `scripts/run_alert_eval.py`, which writes `results/alert_eval.json`. The original run is `scripts/run_alert.py`; its published numbers are unchanged.

## Method

At week t we predict leptospirosis cases in week t + 2 using only data known at week t. All learned methods are Poisson regressions fitted on training years.

| Method | What it uses |
|---|---|
| seasonal | Average count for that week of the year in training years |
| last_week | The count two weeks before the target week, carried forward |
| rain_model | Season (two sine/cosine pairs) plus city rainfall 2 to 5 weeks before the target week |
| season_ar | Season plus the log of the newest case count known at forecast time (no rain) |
| season_ar_rain | Season, that case count, and the rain lags |

`season_ar` is the fair rival to the rain model: how far do you get from the season and recent cases alone? `season_ar_rain` asks whether rain adds anything on top of recent cases.

An outbreak week is a week whose count is above the 90th percentile of training weeks. For Dagupan at the published split that means 2 or more cases. Every method raises the same number of alerts (the training outbreak rate times the test weeks) on its highest-scoring weeks, so the comparison is fair.

Scores:
- **Correlation** and **mean error** compare predicted and actual weekly counts.
- **Caught** (sensitivity): share of outbreak weeks that got an alert.
- **Precision**: share of alerts that were outbreak weeks.
- **Ceiling**: best possible sensitivity, alerts divided by outbreak weeks, capped at 100%. With a fixed budget no method can beat it.
- **False alerts**: share of non-outbreak weeks that got an alert.

## Published split, Dagupan (train 2008-2016, test 2017-2019)

16 alerts, 39 outbreak weeks, so the ceiling is 41% (16 of 39). No method can catch more.

| Method | Correlation | Mean error | Caught | Precision | False alerts |
|---|---|---|---|---|---|
| seasonal | 0.50 | 1.24 | 8 of 39 (21%) | 50% | 6.8% |
| last_week | 0.48 | 1.53 | 10 of 39 (26%) | 62% | 5.1% |
| rain_model | 0.65 | 1.14 | 14 of 39 (36%) | 88% | 1.7% |
| season_ar | 0.55 | 1.20 | 11 of 39 (28%) | 69% | 4.2% |
| season_ar_rain | 0.68 | 1.12 | 14 of 39 (36%) | 88% | 1.7% |

The rain model hit 14 of its 16 alerts. Against the 41% ceiling, 36% is close to the most this budget allows. The fair reading of the original table: the rain model nearly maxes out a small alert budget. It does not catch a third of outbreaks in any way that scales.

## More than one split: Dagupan rolling origin

For each test year 2012 to 2019, train on 2008 up to the year before and test on that year. In total 32 alerts and 67 outbreak weeks, so the ceiling is 48%.

| Method | Correlation | Mean error | Caught | Precision | False alerts |
|---|---|---|---|---|---|
| seasonal | 0.45 | 0.89 | 13 of 67 (19%) | 41% | 5.4% |
| last_week | 0.43 | 1.11 | 15 of 67 (22%) | 47% | 4.8% |
| rain_model | 0.64 | 0.77 | 25 of 67 (37%) | 78% | 2.0% |
| season_ar | 0.45 | 0.90 | 11 of 67 (16%) | 34% | 6.0% |
| season_ar_rain | 0.65 | 0.77 | 25 of 67 (37%) | 78% | 2.0% |

Year by year, the rain model has a higher correlation than last week in 8 of 8 years and than season_ar in 7 of 8. It catches more outbreak weeks than last week in only 5 of 8 years, and more than season_ar in 7 of 8. Single years have 4 to 13 outbreak weeks, so read the pooled row, not single years. The Dagupan result is not an artifact of 2017 to 2019.

In Dagupan, `season_ar` alone is no better than the seasonal average. Recent cases carry little extra information there. Rain is what separates the methods. Adding the case count to the rain model changes little (correlation 0.65 against 0.64, same 25 hits).

The rolling-origin years 2017 to 2019 reuse the published test years with more training data, so the two Dagupan tables are not independent.

## Every city at the published split (train 2008-2016, test 2017-2019)

Nine cities have at least 100 cases and are scored. Palayan (62), Legazpi (60) and Mandaue (39) are skipped for too few cases. Outbreak weeks per city run from 5 to 39, so per-city sensitivity rests on very few events.

Winner by correlation: season_ar_rain in 5 cities (Dagupan, Iloilo, Cagayan de Oro, Mandaluyong, Navotas), rain_model in 3 (Davao, Tacloban, Zamboanga), season_ar in 1 (Muntinlupa). A method with rain wins correlation in 8 of 9 cities.

Winner by sensitivity: rain_model and season_ar_rain tie in Dagupan, Tacloban and Cagayan de Oro; rain_model alone in Davao and Zamboanga; season_ar_rain in Iloilo; last_week in Mandaluyong; season_ar in Navotas; last_week and season_ar tie in Muntinlupa. A rain method wins or ties in 6 of 9 cities. Last week or season_ar wins in 3.

Rain model against last week, city by city: higher correlation in 7 of 9 (it loses in Iloilo and Muntinlupa). More outbreak weeks caught in 5, a tie in 1 (Navotas), fewer in 3 (Iloilo, Mandaluyong, Muntinlupa). In Mandaluyong last week catches 12 of 38 outbreak weeks and the rain model 8.

Does rain add on top of recent cases (season_ar_rain against season_ar)? Correlation is higher in 8 of 9 cities. Outbreak weeks caught: more in 4, equal in 3, fewer in 2 (Navotas 9 against 11, Muntinlupa 1 against 2).

| City | Correlation: rain_model / season_ar_rain / last_week | Caught: same order | Ceiling |
|---|---|---|---|
| Dagupan | 0.65 / 0.68 / 0.48 | 14 / 14 / 10 of 39 | 41% |
| Iloilo | 0.61 / 0.73 / 0.65 | 7 / 9 / 8 of 10 | 100% |
| Tacloban | 0.28 / 0.27 / 0.03 | 8 / 8 / 4 of 28 | 54% |
| Zamboanga | 0.20 / 0.19 / 0.06 | 2 / 0 / 0 of 5 | 100% |
| Cagayan de Oro | 0.17 / 0.17 / 0.12 | 3 / 3 / 2 of 11 | 73% |
| Davao | 0.15 / 0.11 / 0.05 | 1 / 0 / 0 of 6 | 100% |
| Mandaluyong | 0.48 / 0.51 / 0.41 | 8 / 10 / 12 of 38 | 34% |
| Navotas | 0.39 / 0.47 / 0.33 | 6 / 9 / 6 of 24 | 58% |
| Muntinlupa | 0.31 / 0.32 / 0.34 | 1 / 1 / 2 of 11 | 64% |

All five methods, with precision and false alerts, are in `results/alert_eval.json`. Outside Dagupan, correlations are low (mostly 0.1 to 0.5) and four cities catch 0 to 3 outbreak weeks with any method. Where a rain-aware method catches a meaningful share (Dagupan, Iloilo, Tacloban, Mandaluyong, Navotas), the sample is 10 to 39 outbreak weeks.

## One model for all cities (published pooled run)

From `results/pooled_alert_scores.json`: one Poisson model with a city effect, same split.

| Method | Correlation | Mean error | Caught (124 alerts, 214 outbreak weeks) | False alerts |
|---|---|---|---|---|
| seasonal | 0.46 | 0.98 | 17.8% | 5.1% |
| last_week | 0.54 | 0.82 | 21.0% | 4.7% |
| rain_model | 0.53 | 0.94 | 23.8% | 4.4% |

Pooled, the rain model loses to last week on correlation (0.53 against 0.54) and mean error (0.94 against 0.82) and wins slightly on sensitivity and false alerts. The pooled run does not include season_ar or season_ar_rain. **Across cities the rain model is not clearly better than carrying last week's count forward.** Dagupan is the best case for rain, not a typical one.

## Out of time: 2020 to 2022 (COVID-era)

Trained 2008 to 2019, tested 2020 to 2022. **Reporting and care-seeking changed in these years, so this is a stress test, not a clean score.** Outbreak weeks are defined from the pre-2020 training distribution, so the Dagupan threshold becomes 3 cases.

- **Dagupan has no outbreak weeks at all in 2020 to 2022** by that definition. Sensitivity cannot be computed, and all 14 alerts of every method were false alerts. Correlations are weak for every method: seasonal 0.16, last_week 0.13, rain_model 0.11, season_ar 0.16, season_ar_rain 0.14. The rain model has the lowest correlation of the five. It showed no advantage here.
- Mean error in Dagupan is lowest for last_week (0.19) because cases were so few. rain_model is 0.62.
- Across the 9 scored cities, a rain method has the best correlation in 7 (Iloilo, Zamboanga, Cagayan de Oro, Davao, Mandaluyong, Navotas, Muntinlupa) and a non-rain method in 2 (Dagupan, Tacloban). But values are mostly under 0.4, Cagayan de Oro's best is negative (-0.01), and the best methods in Navotas (0.61) and Iloilo (0.67) rest on 4 and 1 outbreak weeks.
- Hits are 0 to 4 per city. Last week catches 3 of 10 in Mandaluyong against 1 for the rain model; season_ar_rain catches 4 of 4 in Navotas.

Conclusion for this period: no method is reliable, and the rain model's Dagupan advantage did not carry into 2020 to 2022.

## What we claim and what we do not

- In Dagupan, 2008 to 2019, rain gives a real gain. Rolling-origin correlation is 0.64 to 0.65 against 0.43 to 0.45 for the methods without rain, and the rain model catches 37% of outbreak weeks against 22% for last week. It holds across eight test years, not one split.
- Recent case counts alone (season_ar) do not help in Dagupan. Rain is the useful signal there.
- Rain on top of recent cases adds a little correlation in 8 of 9 cities and little or nothing on sensitivity.
- Across all cities, last week's count is as good as the rain model on correlation and better on mean error. Do not present the Dagupan table as a general result.
- The ceiling matters. At 16 alerts, even a perfect method catches 41% of Dagupan outbreak weeks. The alert budget caps sensitivity, not the model.
- 2020 to 2022 shows no skill in Dagupan. The alert is evidence for a pilot, not a validated warning system.
