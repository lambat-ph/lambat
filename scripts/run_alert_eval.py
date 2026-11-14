"""Stronger evaluation of the two-week-ahead alert. Writes results/alert_eval.json.

    uv run python scripts/run_alert_eval.py

a. Rolling origin, Dagupan: test years 2012..2019, each trained on 2008..(year - 1).
b. Out-of-time 2020-2022 (COVID-era, reporting changed), trained 2008-2019.
c. Every evaluable city at the published split (train 2008-2016, test 2017-2019).

Five methods: seasonal, last_week, rain_model, season_ar, season_ar_rain. Each gets the same
alert budget (training outbreak rate x test weeks). Nothing here is random.
"""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from lambat import alert, cities, data

OUT = Path(__file__).resolve().parents[1] / "results"
METHODS = alert.ALL_METHODS
COLS = ["method", "correlation", "mae", "sensitivity", "precision", "sensitivity_ceiling", "false_alert_rate",
        "hits", "alerts", "outbreak_weeks"]


def clean(o):
    if isinstance(o, float) and math.isnan(o):
        return None
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    return o


def run(cases, rain, train_years, test_years):
    res = alert.evaluate(cases, rain, horizon=2, train_years=train_years, test_years=test_years, methods=METHODS)
    return res


def rolling_origin(cases, rain):
    per_year, pooled_pred, tot = {}, [], {m: {"hits": 0, "fa": 0, "pos": 0, "neg": 0, "alerts": 0} for m in METHODS}
    for y in range(2012, 2020):
        r = run(cases, rain, (2008, y - 1), (y, y))
        per_year[y] = r["scores"]
        pooled_pred.append(r["predictions"])
        for s in r["scores"]:
            t = tot[s["method"]]
            t["hits"] += s["hits"]
            t["fa"] += s["false_alerts"]
            t["pos"] += s["outbreak_weeks"]
            t["neg"] += s["non_outbreak_weeks"]
            t["alerts"] += s["alerts"]
    pred = pd.concat(pooled_pred)
    pooled = []
    for m in METHODS:
        t = tot[m]
        pooled.append({
            "method": m,
            "correlation": float(np.corrcoef(pred[m], pred.actual)[0, 1]),
            "mae": float(np.abs(pred[m] - pred.actual).mean()),
            "sensitivity": t["hits"] / t["pos"] if t["pos"] else float("nan"),
            "precision": t["hits"] / t["alerts"],
            "sensitivity_ceiling": min(1.0, t["alerts"] / t["pos"]) if t["pos"] else float("nan"),
            "false_alert_rate": t["fa"] / t["neg"] if t["neg"] else float("nan"),
            "hits": t["hits"], "alerts": t["alerts"], "outbreak_weeks": t["pos"],
        })
    # how often does each method beat last_week / season_ar on yearly correlation and sensitivity
    wins = {}
    for m in ("rain_model", "season_ar_rain"):
        for base in ("last_week", "season_ar"):
            c = se = 0
            for y, sc in per_year.items():
                d = {s["method"]: s for s in sc}
                c += int(d[m]["correlation"] > d[base]["correlation"])
                se += int(d[m]["sensitivity"] > d[base]["sensitivity"])
            wins[f"{m}_vs_{base}"] = {"years_better_correlation": c, "years_better_sensitivity": se, "years": len(per_year)}
    return {"per_year": {str(y): sc for y, sc in per_year.items()}, "pooled": pooled, "year_wins": wins}


def evaluable(code):
    cases = data.weekly_cases(code)
    return cases, int(cases.sum()) >= cities.MIN_CASES_FOR_ALERT


def table(rows):
    return pd.DataFrame(rows)[COLS].round(3).to_string(index=False)


def main() -> None:
    codes = list(cities.CITIES)
    data.prewarm_rainfall(codes)
    out = {"horizon_weeks": 2, "methods": list(METHODS), "outbreak_definition": "count above the 90th percentile of training weeks (Dagupan: 2 or more cases)"}

    cases = data.weekly_cases(data.DAGUPAN)
    rain = data.weekly_rainfall(data.DAGUPAN)["city"]
    ro = rolling_origin(cases, rain)
    out["rolling_origin_dagupan"] = ro
    print("A. Dagupan rolling origin, test 2012-2019 pooled over years")
    print(table(ro["pooled"]))
    print(json.dumps(ro["year_wins"]))

    # b. out-of-time
    oot = {}
    for code in codes:
        cs, ok = evaluable(code)
        if not ok:
            oot[code] = {"status": "too_few_cases", "total_cases": int(cs.sum())}
            continue
        r = run(cs, data.weekly_rainfall(code)["city"], (2008, 2019), (2020, 2022))
        r.pop("predictions")
        oot[code] = {"status": "evaluated", "name": cities.CITIES[code], **r}
    out["out_of_time_2020_2022"] = {"note": "COVID-era: reporting and health-seeking changed, read with care. Trained 2008-2019.", "cities": oot}
    print("\nB. Out-of-time 2020-2022 (COVID-era), Dagupan")
    print(table(oot[data.DAGUPAN]["scores"]))

    # c. per city at the published split
    per_city = {}
    for code in codes:
        cs, ok = evaluable(code)
        if not ok:
            per_city[code] = {"status": "too_few_cases", "total_cases": int(cs.sum())}
            continue
        r = run(cs, data.weekly_rainfall(code)["city"], (2008, 2016), (2017, 2019))
        r.pop("predictions")
        per_city[code] = {"status": "evaluated", "name": cities.CITIES[code], "total_cases": int(cs.sum()), **r}
    out["per_city_2017_2019"] = per_city
    print("\nC. Per city, train 2008-2016, test 2017-2019")
    rows = []
    for code, r in per_city.items():
        if r["status"] != "evaluated":
            print(f"{cities.CITIES[code]}: too few cases ({r['total_cases']})")
            continue
        for s in r["scores"]:
            rows.append({"city": cities.CITIES[code], **s})
    df = pd.DataFrame(rows)
    print(df[["city"] + COLS].round(3).to_string(index=False))
    win = {}
    for col in ("correlation", "sensitivity"):
        win[col] = {}
        for name, g in df.groupby("city"):
            g = g.dropna(subset=[col])
            best = g[col].max()
            win[col][name] = {"winners": g[g[col] == best].method.tolist(), "value": float(best)}
    out["per_city_winners"] = win
    print("\nWinners by correlation:", {k: v["winners"] for k, v in win["correlation"].items()})
    print("Winners by sensitivity:", {k: v["winners"] for k, v in win["sensitivity"].items()})

    (OUT / "alert_eval.json").write_text(json.dumps(clean(out), indent=2))


if __name__ == "__main__":
    main()
