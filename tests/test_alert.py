import numpy as np
import pandas as pd

from lambat import alert


def _synthetic(weeks=520, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2008-01-07", periods=weeks, freq="W-MON")
    rain = pd.Series(rng.gamma(0.6, 60, weeks), index=idx)
    # cases respond to rain three weeks earlier
    lam = 0.3 + 0.02 * rain.shift(3).fillna(0)
    cases = pd.Series(rng.poisson(lam), index=idx)
    return cases, rain


def test_design_uses_only_past_rain():
    cases, rain = _synthetic()
    df = alert.design(cases, rain, horizon=2)
    week = df.index[10]
    assert df.loc[week, "rain_l2"] == np.log1p(rain.shift(2).loc[week])
    assert df.loc[week, "last_week"] == cases.shift(2).loc[week]


def test_rain_model_finds_planted_signal():
    cases, rain = _synthetic()
    res = alert.evaluate(cases, rain, horizon=2, train_years=(2008, 2014), test_years=(2015, 2017))
    scores = {s["method"]: s for s in res["scores"]}
    assert scores["rain_model"]["correlation"] > scores["seasonal"]["correlation"]
    assert res["rain_coefficients"]["rain_l3"] > 0
