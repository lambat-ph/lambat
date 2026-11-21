"""Export each city's rain model for the "Try it" box on the city dashboard.

    uv run python scripts/export_alert_model.py               # every city with a tested rain warning
    uv run python scripts/export_alert_model.py --city PH015518000

For each city whose rain warning was evaluated (results/<city>/alert_scores.json), refits
the published rain model (alert.design + fit_rain_model, trained 2008-2016, two weeks
ahead), checks it reproduces web/data/<city>/alert_predictions.csv, and writes
web/data/<city>/alert_model.json: coefficients, a warning cut-off fixed from the training
years only, how that cut-off would have done on 2017-2019, the city's rainy months, four
rain choices built from its own records, a record-rain guard and two real weeks.

The published evaluation ranks test weeks in hindsight. A live warning cannot do that, so
the box uses a cut-off fixed in advance: the model score above which it would have raised
as many alerts in 2008-2016 as there were outbreak weeks.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

from lambat import alert, cities, data

ROOT = Path(__file__).resolve().parents[1]
H = 2
GUARD = 1.25
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
        "October", "November", "December"]


def iso_week(ts: pd.Timestamp) -> int:
    return int(ts.isocalendar().week)


def rain_max_by_week(tr: pd.Series) -> list[float]:
    """Most rain any single week got within 3 calendar weeks of each week of the year."""
    tw = tr.index.isocalendar().week.to_numpy()
    out = []
    for w in range(1, 54):
        d = np.minimum(np.abs(tw - w), 53 - np.abs(tw - w))
        out.append(round(float(tr[d <= 3].max()), 1))
    return out


def above_record(rmax: list[float], month: int, mm: list[float]) -> bool:
    """Same rule as city.js: forecast week = the 15th of the month, lags 0..3 weeks back."""
    w0 = iso_week(pd.Timestamp(2026, month, 15))
    return any(v > rmax[((w0 - 1 - j + 53) % 53)] * GUARD for j, v in enumerate(mm))


def loyo_predictions(train: pd.DataFrame, cols: list[str]) -> pd.Series:
    """Leave-one-year-out predictions inside the training years."""
    out = []
    for yr in sorted(set(train.index.year)):
        held, rest = train[train.index.year == yr], train[train.index.year != yr]
        m = sm.GLM(rest.cases, sm.add_constant(rest[cols], has_constant="add"), family=sm.families.Poisson()).fit()
        out.append(pd.Series(np.asarray(m.predict(sm.add_constant(held[cols], has_constant="add"))), index=held.index))
    return pd.concat(out)


def f1_cutoff(pred: pd.Series, actual: pd.Series, thr: float) -> float | None:
    """Warning level with the best F1 on training-years predictions (at least 2 warnings)."""
    best, cut = -1.0, None
    for c in np.unique(np.round(pred.to_numpy(), 4)):
        fired = pred >= c
        if fired.sum() < 2:
            continue
        hits = int((fired & (actual > thr)).sum())
        if hits == 0:
            continue
        prec, rec = hits / fired.sum(), hits / max(1, int((actual > thr).sum()))
        f1 = 2 * prec * rec / (prec + rec)
        if f1 > best:
            best, cut = f1, float(c)
    return cut


def passes_strict(b: dict) -> bool:
    return bool(b["outbreak_weeks"] and b["alerts"] and b["hits"] / b["outbreak_weeks"] >= 0.25 and b["hits"] / b["alerts"] >= 0.5)


def export_city(code: str) -> dict | None:
    web = ROOT / "web" / "data" / code
    scores = ROOT / "results" / code / "alert_scores.json"
    if not scores.exists() or json.loads(scores.read_text()).get("status") != "evaluated":
        print(f"[{code}] skipped: rain warning not evaluated (too few cases)")
        return None
    cases = data.weekly_cases(code)
    rain = data.weekly_rainfall(code)["city"]
    df = alert.design(cases, rain, H)
    yr = df.index.year
    train, test = df[(yr >= 2008) & (yr <= 2016)], df[(yr >= 2017) & (yr <= 2019)]
    model, cols = alert.fit_rain_model(train)

    pred_test = pd.Series(model.predict(sm.add_constant(test[cols], has_constant="add")), index=test.index)
    pub = pd.read_csv(web / "alert_predictions.csv", index_col=0, parse_dates=True)
    diff = float((pred_test.round(4) - pub.rain_model.reindex(pred_test.index)).abs().max())
    assert diff < 1e-3, f"[{code}] refit does not match the published predictions (max diff {diff})"

    threshold = float(np.quantile(train.cases, 0.9))
    alert_rate = float((train.cases > threshold).mean())
    pred_train = model.predict(sm.add_constant(train[cols], has_constant="add"))
    cutoff = float(np.quantile(pred_train, 1 - alert_rate))
    out_test = test.cases > threshold
    fired = pred_test > cutoff
    back = {"alerts": int(fired.sum()), "hits": int((fired & out_test).sum()),
            "outbreak_weeks": int(out_test.sum()), "false_alerts": int((fired & ~out_test).sum()),
            "test_weeks": len(test)}

    # Equal-budget comparison with the two simple guesses on 2017-2019 (the deck's claim).
    sc = {m: alert.score(m, p, test.cases, threshold, alert_rate) for m, p in (
        ("rain", pred_test), ("seasonal", alert.seasonal_baseline(train, test)), ("last_week", test.last_week.astype(float)))}
    evidence = {"alerts": sc["rain"].alerts, "outbreak_weeks": sc["rain"].outbreak_weeks, "rain": sc["rain"].hits,
                "seasonal": sc["seasonal"].hits, "last_week": sc["last_week"].hits}
    beats_guesses = evidence["rain"] > evidence["seasonal"] and evidence["rain"] > evidence["last_week"]
    model_kind, tier, why_not = "rain", None, None
    if passes_strict(back):
        tier = "strong"
    else:
        # Rain plus this week's case count, warning level chosen on the training years only.
        cols2 = [c for c in train.columns if c.startswith(("sin", "cos"))] + ["ar_log"] + [c for c in train.columns if c.startswith("rain_")]
        cut2 = f1_cutoff(loyo_predictions(train, cols2), train.cases, threshold)
        if cut2 is not None:
            m2 = sm.GLM(train.cases, sm.add_constant(train[cols2], has_constant="add"), family=sm.families.Poisson()).fit()
            p2 = pd.Series(np.asarray(m2.predict(sm.add_constant(test[cols2], has_constant="add"))), index=test.index)
            f2 = p2 >= cut2
            back2 = {"alerts": int(f2.sum()), "hits": int((f2 & out_test).sum()), "outbreak_weeks": int(out_test.sum()),
                     "false_alerts": int((f2 & ~out_test).sum()), "test_weeks": len(test)}
            if passes_strict(back2):
                model, cols, cutoff, back, tier, model_kind = m2, cols2, cut2, back2, "strong", "rain_cases"
        if tier is None and beats_guesses:
            tier = "weak"
        if tier is None:
            why_not = "last_week" if evidence["last_week"] >= evidence["rain"] else "no_signal"

    tr = rain[(rain.index.year >= 2008) & (rain.index.year <= 2016)].dropna()
    rmax = rain_max_by_week(tr)

    # Rainy months: the wettest run of 6 consecutive months by mean weekly rain, in calendar
    # order from its first month (a season that crosses the new year still reads in order).
    mean = tr.groupby(tr.index.month).mean().reindex(range(1, 13)).fillna(0)
    first = max(range(1, 13), key=lambda st: sum(mean[((st - 1 + i) % 12) + 1] for i in range(6)))
    months = [((first - 1 + i) % 12) + 1 for i in range(6)]
    wet = tr[tr.index.month.isin(months)]

    def r5(x: float) -> int:
        return int(5 * round(float(x) / 5))

    dry_v = 5  # a dry week anywhere: under 10 mm
    norm_v, heavy_v, peak_v = r5(wet.median()), r5(wet.quantile(0.85)), r5(wet.quantile(0.99))
    presets = [
        {"id": "dry", "label": "Mostly dry", "mm": [dry_v] * 4},
        {"id": "normal", "label": "Normal rainy season", "mm": [norm_v] * 4},
        {"id": "heavy", "label": "Heavy rain most weeks", "mm": [heavy_v, r5(heavy_v * 0.8), heavy_v, r5(heavy_v * 0.7)]},
        {"id": "typhoon", "label": "A typhoon passed", "mm": [heavy_v, max(peak_v, heavy_v), r5(heavy_v * 0.8), r5(heavy_v * 0.7)]},
    ]
    # No preset may trip the record-rain guard in an offered month: scale the wettest ones down if needed.
    for p in presets[2:]:
        while any(above_record(rmax, m, p["mm"]) for m in months) and max(p["mm"]) > 5:
            p["mm"] = [max(5, min(v - 5, r5(v * 0.9))) for v in p["mm"]]  # always at least 5 mm lower
    # The typhoon choice keeps the heavy pattern and only lowers its peak week to fit the record.
    heavy, ty = presets[2]["mm"], presets[3]
    ty["mm"] = [heavy[0], max(heavy[0], ty["mm"][1]), heavy[2], heavy[3]]
    while any(above_record(rmax, m, ty["mm"]) for m in months) and ty["mm"][1] > heavy[0]:
        ty["mm"][1] = max(heavy[0], min(ty["mm"][1] - 5, r5(ty["mm"][1] * 0.95)))
    for p in presets:
        hi = max(p["mm"])
        p["sub"] = ("Under 10 mm a week" if p["id"] == "dry" else
                    f"One week near {hi} mm" if p["id"] == "typhoon" else
                    f"About {r5(np.mean(p['mm']))} mm a week")

    def example(t: pd.Timestamp) -> dict:
        i = df.index.get_loc(t)
        fw = df.index[i] - pd.Timedelta(weeks=H)
        r = [round(float(rain.get(fw - pd.Timedelta(weeks=j), np.nan)), 1) for j in range(4)]
        p = float(model.predict(sm.add_constant(df.loc[[t], cols], has_constant="add")).iloc[0])
        return {"forecast_week": str(fw.date()), "target_week": str(t.date()), "month_year": f"{FULL[t.month - 1]} {t.year}",
                "rain_newest_first": r, "predicted": round(p, 2), "actual": int(df.cases.iloc[i]),
                "warned": bool(p >= cutoff)}

    out = {
        "city": code, "city_name": cities.CITIES[code], "trained_years": [2008, 2016], "horizon_weeks": H,
        "period_weeks": 52.18, "coef": {c: float(model.params[c]) for c in ["const", *cols]},
        "rain_lags_weeks": [2, 3, 4, 5], "outbreak_threshold": threshold, "alert_rate": round(alert_rate, 4),
        "cutoff": round(cutoff, 4), "backtest_fixed_cutoff": back,
        # The "Try it" box is offered where the warning worked on 2017-2019, years it never saw:
        # "strong" = a warning level fixed in advance caught at least a quarter of outbreak weeks with at least
        # half its warnings right; "weak" = at the same number of warnings it caught more outbreak weeks than
        # both simple guesses (seasonal average, last week's count). Otherwise why_not says which failed.
        "try_it": tier is not None, "tier": tier, "model": model_kind, "why_not": why_not, "evidence": evidence,
        "cases_default": int(round(float(train.cases.median()))),
        "months": [MONTHS[m - 1] for m in months], "month_full": dict(zip(MONTHS, FULL, strict=True)),
        "default_month": MONTHS[int(mean[months].idxmax()) - 1], "presets": presets,
        "rain_max_by_week": rmax, "guard_factor": GUARD,
        "examples": [example(test.cases.idxmax())],
        "note": f"Prototype. Poisson model trained on {cities.CITIES[code]} 2008-2016 (Project CCHAIN). Not a live warning.",
    }
    (web / "alert_model.json").write_text(json.dumps(out, indent=2))
    ex = out["examples"][0]
    print(f"[{code}] {cities.CITIES[code]}: refit diff {diff:.5f}; cutoff {cutoff:.2f}; fixed cut-off on 2017-2019 "
          f"{back['hits']}/{back['alerts']} right, caught {back['hits']}/{back['outbreak_weeks']}; months "
          f"{','.join(out['months'])}; tier {tier} model {model_kind} why_not {why_not} evidence {evidence}; presets {[p['mm'] for p in presets]}; peak {ex['month_year']} "
          f"actual {ex['actual']} predicted {ex['predicted']} warned {ex['warned']}")
    assert math.isfinite(cutoff)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="all", help="adm3 pcode or 'all'")
    args = ap.parse_args()
    for c in cities.resolve(args.city):
        export_city(c)


if __name__ == "__main__":
    main()
