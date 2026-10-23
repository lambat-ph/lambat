"""Evaluate the two-week-ahead outbreak alert and save the results.

    uv run python scripts/run_alert.py                    # Dagupan (default)
    uv run python scripts/run_alert.py --city all --pooled

Per city, written to results/<city_code>/: alert_scores.json, alert_predictions.csv.
A city with fewer than 100 leptospirosis cases in 2008-2022 gets status "too_few_cases"
and no score. Dagupan is also written to results/alert_*_dagupan.* (legacy paths).
--pooled fits one model across all 12 cities with a city fixed effect and writes
results/pooled_alert_scores.json and results/pooled_alert_predictions.csv.
"""

import argparse
import json
from pathlib import Path

import pandas as pd

from lambat import alert, cities, data

OUT = Path(__file__).resolve().parents[1] / "results"


def run_city(code: str) -> dict:
    cases = data.weekly_cases(code)
    total = int(cases.sum())
    d = OUT / code
    d.mkdir(parents=True, exist_ok=True)
    if total < cities.MIN_CASES_FOR_ALERT:
        res = {"status": "too_few_cases", "total_cases": total, "min_cases": cities.MIN_CASES_FOR_ALERT,
               "message": "too few cases to evaluate"}
        (d / "alert_scores.json").write_text(json.dumps(res, indent=2))
        print(f"{code} {cities.CITIES[code]}: {total} cases, too few cases to evaluate")
        return res
    rain = data.weekly_rainfall(code)["city"]
    res = alert.evaluate(cases, rain, horizon=2)
    pred = res.pop("predictions")
    res = {"status": "evaluated", "total_cases": total, **res}
    pred.to_csv(d / "alert_predictions.csv", index_label="week")
    (d / "alert_scores.json").write_text(json.dumps(res, indent=2))
    if code == data.DAGUPAN:  # legacy paths used by earlier docs
        pred.to_csv(OUT / "alert_predictions_dagupan.csv", index_label="week")
        legacy = {k: v for k, v in res.items() if k not in ("status", "total_cases")}
        (OUT / "alert_scores_dagupan.json").write_text(json.dumps(legacy, indent=2))
    print(f"{code} {cities.CITIES[code]}: {total} cases; outbreak week > {res['outbreak_threshold']:.0f} case(s); "
          f"test years {res['test_years'][0]}-{res['test_years'][1]}")
    print(pd.DataFrame(res["scores"]).round(3).to_string(index=False))
    return res


def run_pooled(codes: list[str]) -> dict:
    cases = {c: data.weekly_cases(c) for c in codes}
    rain = {c: data.weekly_rainfall(c)["city"] for c in codes}
    res = alert.evaluate_pooled(cases, rain, horizon=2)
    pred = res.pop("predictions")
    res["status"] = "evaluated"
    OUT.mkdir(exist_ok=True)
    pred.to_csv(OUT / "pooled_alert_predictions.csv", index_label="week")
    (OUT / "pooled_alert_scores.json").write_text(json.dumps(res, indent=2))
    print(f"Pooled model over {len(res['cities'])} cities, test {res['test_years']}")
    print(pd.DataFrame(res["scores"]).round(3).to_string(index=False))
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default=data.DAGUPAN, help="adm3 pcode or 'all'")
    ap.add_argument("--pooled", action="store_true", help="also fit the pooled model over all 12 cities")
    args = ap.parse_args()
    codes = cities.resolve(args.city)
    OUT.mkdir(exist_ok=True)
    data.prewarm_rainfall(list(cities.CITIES) if args.pooled else codes)
    for c in codes:
        run_city(c)
    if args.pooled:
        run_pooled(list(cities.CITIES))


if __name__ == "__main__":
    main()
