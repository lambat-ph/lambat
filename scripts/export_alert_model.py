"""Export the Dagupan rain model for the "Try it" box on the city dashboard.

    uv run python scripts/export_alert_model.py

Refits the published rain model (alert.design + fit_rain_model, trained 2008-2016, two
weeks ahead), checks it reproduces web/data/PH015518000/alert_predictions.csv, and writes
web/data/PH015518000/alert_model.json: the coefficients, a warning cut-off fixed from the
training years only, how that cut-off would have done on 2017-2019, rainfall reference
values and a few real weeks to try.

The published evaluation ranks test weeks in hindsight (16 alerts each). A live warning
cannot do that, so the box uses a cut-off fixed in advance: the model score above which
it would have raised as many alerts in 2008-2016 as there were outbreak weeks.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

from lambat import alert, data

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data" / data.DAGUPAN
H = 2


def main() -> None:
    cases = data.weekly_cases(data.DAGUPAN)
    rain = data.weekly_rainfall(data.DAGUPAN)["city"]
    df = alert.design(cases, rain, H)
    yr = df.index.year
    train, test = df[(yr >= 2008) & (yr <= 2016)], df[(yr >= 2017) & (yr <= 2019)]
    model, cols = alert.fit_rain_model(train)

    pred_test = pd.Series(model.predict(sm.add_constant(test[cols], has_constant="add")), index=test.index)
    pub = pd.read_csv(WEB / "alert_predictions.csv", index_col=0, parse_dates=True)
    diff = float((pred_test.round(4) - pub.rain_model.reindex(pred_test.index)).abs().max())
    assert diff < 1e-3, f"refit does not match the published predictions (max diff {diff})"
    print(f"CHECK refit matches published 2017-2019 predictions (max diff {diff:.5f})")

    threshold = float(np.quantile(train.cases, 0.9))          # outbreak week: more than this many cases
    alert_rate = float((train.cases > threshold).mean())
    pred_train = model.predict(sm.add_constant(train[cols], has_constant="add"))
    cutoff = float(np.quantile(pred_train, 1 - alert_rate))  # fixed from training years only

    out_test = test.cases > threshold
    fired = pred_test > cutoff
    back = {"alerts": int(fired.sum()), "hits": int((fired & out_test).sum()),
            "outbreak_weeks": int(out_test.sum()), "false_alerts": int((fired & ~out_test).sum()),
            "test_weeks": int(len(test))}
    print(f"cutoff {cutoff:.3f} expected cases; 2017-2019 with this fixed cut-off: {back}")

    wk = rain.dropna()
    woy = wk.index.isocalendar().week
    wet = wk[(woy >= 23) & (woy <= 44)]  # June to October
    ref = {"median": round(float(wk.median()), 1), "p90": round(float(wk.quantile(0.9)), 1),
           "wet_median": round(float(wet.median()), 1), "max": round(float(wk.max()), 1)}

    def example(target: str, label: str) -> dict:
        t = pd.Timestamp(target)
        i = df.index.get_loc(t)
        forecast_week = df.index[i] - pd.Timedelta(weeks=H)
        r = [round(float(rain.get(forecast_week - pd.Timedelta(weeks=j), np.nan)), 1) for j in range(4)]
        p = float(model.predict(sm.add_constant(df.loc[[t], cols], has_constant="add")).iloc[0])
        return {"label": label, "forecast_week": str(forecast_week.date()), "target_week": str(t.date()),
                "rain_newest_first": r, "predicted": round(p, 2), "actual": int(df.cases.iloc[i])}

    peak = test.cases.idxmax()
    dry = test[(test.index.year == 2018) & (test.woy.between(6, 10))].index[0]
    exs = [example(str(peak.date()), "Two weeks before the August 2018 peak"),
           example(str(dry.date()), "A dry-season week, February 2018")]

    # Guard against extrapolation: the most rain any single week got within 3 calendar weeks
    # of each week of the year, 2008-2016. Far above this, the log-linear model is guessing.
    tr = rain[(rain.index.year >= 2008) & (rain.index.year <= 2016)].dropna()
    tw = tr.index.isocalendar().week.to_numpy()
    rain_max = []
    for w in range(1, 54):
        d = np.minimum(np.abs(tw - w), 53 - np.abs(tw - w))
        rain_max.append(round(float(tr[d <= 3].max()), 1))

    out = {
        "rain_max_by_week": rain_max, "guard_factor": 1.25,
        "city": data.DAGUPAN, "trained_years": [2008, 2016], "horizon_weeks": H,
        "period_weeks": 52.18,
        "coef": {c: float(model.params[c]) for c in ["const", *cols]},
        "rain_lags_weeks": [2, 3, 4, 5],
        "outbreak_threshold": threshold, "alert_rate": round(alert_rate, 4),
        "cutoff": round(cutoff, 4), "backtest_fixed_cutoff": back,
        "rain_ref_mm_week": ref, "examples": exs,
        "note": "Prototype. Poisson model trained on Dagupan 2008-2016 (Project CCHAIN). Not a live warning.",
    }
    (WEB / "alert_model.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: out[k] for k in ("coef", "cutoff", "rain_ref_mm_week", "examples")}, indent=2))


if __name__ == "__main__":
    main()
