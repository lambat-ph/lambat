"""Step 5: a separate, slower clock. Warn hospitals one to two weeks ahead.

At week t we predict cases in week t + h (h = horizon, default 2) from
- season: two pairs of sine/cosine terms on the week of the year
- rain: weekly city rainfall in weeks t-3 .. t (log scale), i.e. 2 to 5 weeks
  before the target week, matching the 2 to 4 week lag seen in the data

The model is a Poisson regression. It is compared with two baselines that need
no rain at all:
- seasonal: the average count for that week of the year in training years
- last week: the count in week t, carried forward

An outbreak week is one whose count exceeds the 90th percentile of training
weeks. Each method raises an alert on its highest-scoring weeks, as many as the
training outbreak rate implies, so sensitivity is compared at the same alert
budget.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
import statsmodels.api as sm

RAIN_LAGS = (0, 1, 2, 3)  # weeks before the forecast date


def design(cases: pd.Series, rain: pd.Series, horizon: int = 2) -> pd.DataFrame:
    """One row per target week: the target count and the predictors known
    `horizon` weeks earlier."""
    df = pd.DataFrame({"cases": cases})
    rain = rain.reindex(df.index)
    woy = df.index.isocalendar().week.astype(float).to_numpy()
    for k in (1, 2):
        df[f"sin{k}"] = np.sin(2 * np.pi * k * woy / 52.18)
        df[f"cos{k}"] = np.cos(2 * np.pi * k * woy / 52.18)
    for lag in RAIN_LAGS:
        df[f"rain_l{lag + horizon}"] = np.log1p(rain.shift(lag + horizon))
    df["last_week"] = df.cases.shift(horizon)
    df["woy"] = woy
    return df.dropna()


def seasonal_baseline(train: pd.DataFrame, test: pd.DataFrame, smooth: int = 2) -> pd.Series:
    """Mean training count by week of year, smoothed over +/- `smooth` weeks."""
    by_week = train.groupby("woy").cases.mean().reindex(np.arange(1, 54), fill_value=np.nan)
    by_week = by_week.interpolate(limit_direction="both")
    padded = pd.concat([by_week.iloc[-smooth:], by_week, by_week.iloc[:smooth]])
    smoothed = padded.rolling(2 * smooth + 1, center=True).mean().iloc[smooth:-smooth]
    return pd.Series(smoothed.reindex(test.woy).to_numpy(), index=test.index)


def fit_rain_model(train: pd.DataFrame):
    cols = [c for c in train.columns if c.startswith(("sin", "cos", "rain_"))]
    X = sm.add_constant(train[cols])
    return sm.GLM(train.cases, X, family=sm.families.Poisson()).fit(), cols


@dataclass
class Score:
    method: str
    correlation: float
    mae: float
    sensitivity: float
    false_alert_rate: float
    alerts: int
    outbreak_weeks: int


def score(method: str, pred: pd.Series, actual: pd.Series, threshold: float, alert_rate: float) -> Score:
    outbreak = actual > threshold
    n_alerts = max(1, round(alert_rate * len(pred)))
    # rank with a tiny jitter so ties (common with small counts) break by order, not by luck
    ranks = pred.rank(method="first", ascending=False)
    alert = ranks <= n_alerts
    tp = int((alert & outbreak).sum())
    fp = int((alert & ~outbreak).sum())
    negatives = int((~outbreak).sum())
    return Score(
        method=method,
        correlation=float(np.corrcoef(pred, actual)[0, 1]),
        mae=float(np.abs(pred - actual).mean()),
        sensitivity=tp / outbreak.sum() if outbreak.sum() else float("nan"),
        false_alert_rate=fp / negatives if negatives else float("nan"),
        alerts=n_alerts,
        outbreak_weeks=int(outbreak.sum()),
    )


def evaluate(
    cases: pd.Series,
    rain: pd.Series,
    horizon: int = 2,
    train_years: tuple[int, int] = (2008, 2016),
    test_years: tuple[int, int] = (2017, 2019),
) -> dict:
    """Train on one block of years, test on a later block, return scores and
    the weekly predictions. 2020 onwards is left out: COVID-19 disrupted
    reporting."""
    df = design(cases, rain, horizon)
    yr = df.index.year
    train = df[(yr >= train_years[0]) & (yr <= train_years[1])]
    test = df[(yr >= test_years[0]) & (yr <= test_years[1])]

    threshold = float(np.quantile(train.cases, 0.9))
    alert_rate = float((train.cases > threshold).mean())

    model, cols = fit_rain_model(train)
    preds = {
        "seasonal": seasonal_baseline(train, test),
        "last_week": test.last_week.astype(float),
        "rain_model": pd.Series(model.predict(sm.add_constant(test[cols], has_constant="add")), index=test.index),
    }
    scores = [score(m, p, test.cases, threshold, alert_rate) for m, p in preds.items()]
    return {
        "horizon_weeks": horizon,
        "train_years": list(train_years),
        "test_years": list(test_years),
        "outbreak_threshold": threshold,
        "alert_rate": alert_rate,
        "scores": [asdict(s) for s in scores],
        "rain_coefficients": {c: float(model.params[c]) for c in cols if c.startswith("rain_")},
        "predictions": pd.DataFrame({"actual": test.cases, **preds}),
    }


def evaluate_pooled(
    cases_by_city: dict[str, pd.Series],
    rain_by_city: dict[str, pd.Series],
    horizon: int = 2,
    train_years: tuple[int, int] = (2008, 2016),
    test_years: tuple[int, int] = (2017, 2019),
) -> dict:
    """One Poisson model for all cities: same season and rain features as `evaluate`
    plus a city fixed effect (one dummy per city). Trained on train_years, tested on
    test_years.

    Outbreak threshold and alert budget are per city (90th percentile of that city's
    training weeks), as in `evaluate`; hits and false alerts are summed over cities.
    Correlation is reported two ways: raw over all city-weeks (inflated by differences
    in city size) and within city (each city's actual and predicted series minus its own
    test mean, then pooled).
    """
    frames, cities = [], sorted(cases_by_city)
    for c in cities:
        d = design(cases_by_city[c], rain_by_city[c], horizon)
        d["city"] = c
        frames.append(d)
    df = pd.concat(frames)
    yr = df.index.year
    train = df[(yr >= train_years[0]) & (yr <= train_years[1])]
    test = df[(yr >= test_years[0]) & (yr <= test_years[1])]

    feat = [c for c in train.columns if c.startswith(("sin", "cos", "rain_"))]

    def X(d):
        dummies = pd.get_dummies(d.city).reindex(columns=cities, fill_value=0).astype(float)
        return pd.concat([d[feat], dummies], axis=1)

    model = sm.GLM(train.cases, X(train), family=sm.families.Poisson()).fit()
    test = test.copy()
    test["rain_model"] = model.predict(X(test)).to_numpy()
    test["last_week"] = test.last_week.astype(float)
    parts = []
    for c in cities:
        tr, te = train[train.city == c], test[test.city == c]
        if te.empty or tr.empty:
            continue
        te = te.copy()
        te["seasonal"] = seasonal_baseline(tr, te).to_numpy()
        parts.append((c, tr, te))
    test = pd.concat([p[2] for p in parts])

    scores = []
    for method in ("seasonal", "last_week", "rain_model"):
        tp = fp = pos = neg = n_alerts = 0
        for _, tr, te in parts:
            thr = float(np.quantile(tr.cases, 0.9))
            rate = float((tr.cases > thr).mean())
            s = score(method, te[method], te.cases, thr, rate)
            out = te.cases > thr
            k = s.alerts
            top = te[method].rank(method="first", ascending=False) <= k
            tp += int((top & out).sum())
            fp += int((top & ~out).sum())
            pos += int(out.sum())
            neg += int((~out).sum())
            n_alerts += k
        within_p = test[method] - test.groupby("city")[method].transform("mean")
        within_a = test.cases - test.groupby("city").cases.transform("mean")
        scores.append({
            "method": method,
            "correlation": float(np.corrcoef(test[method], test.cases)[0, 1]),
            "correlation_within_city": float(np.corrcoef(within_p, within_a)[0, 1]),
            "mae": float(np.abs(test[method] - test.cases).mean()),
            "sensitivity": tp / pos if pos else float("nan"),
            "false_alert_rate": fp / neg if neg else float("nan"),
            "alerts": n_alerts,
            "outbreak_weeks": pos,
        })
    return {
        "horizon_weeks": horizon,
        "train_years": list(train_years),
        "test_years": list(test_years),
        "cities": [p[0] for p in parts],
        "scores": scores,
        "rain_coefficients": {c: float(model.params[c]) for c in feat if c.startswith("rain_")},
        "predictions": test[["city", "cases", "seasonal", "last_week", "rain_model"]].rename(columns={"cases": "actual"}),
    }
