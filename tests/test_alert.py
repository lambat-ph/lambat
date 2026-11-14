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


FIVE = alert.ALL_METHODS


def _preds(cases, rain):
    return alert.evaluate(cases, rain, horizon=2, train_years=(2008, 2014), test_years=(2015, 2017), methods=FIVE)[
        "predictions"
    ]


def test_ar_feature_is_last_available_count():
    cases, rain = _synthetic()
    df = alert.design(cases, rain, horizon=2)
    week = df.index[20]
    assert df.loc[week, "ar_log"] == np.log1p(cases.loc[week - pd.Timedelta(weeks=2)])


def test_new_methods_use_only_past_data():
    cases, rain = _synthetic()
    base = _preds(cases, rain)
    target = base.index[60]
    # change every case count from one week before the target onward (all inside the test years):
    # a forecast made two weeks before `target` must not move
    future = cases.index >= target - pd.Timedelta(weeks=1)
    cases2 = cases.copy()
    cases2[future] = cases2[future] + 7
    shifted = _preds(cases2, rain)
    upto = base.index <= target
    for m in ("season_ar", "season_ar_rain"):
        np.testing.assert_allclose(base.loc[upto, m], shifted.loc[upto, m])
    # and the same for rain: changing rain after the forecast date must not move it
    rain2 = rain.copy()
    rain2[rain.index > target - pd.Timedelta(weeks=2)] *= 5
    shifted_rain = _preds(cases, rain2)
    for m in ("season_ar", "season_ar_rain"):
        np.testing.assert_allclose(base.loc[upto, m], shifted_rain.loc[upto, m])


def test_season_ar_has_no_rain_terms():
    cases, rain = _synthetic()
    df = alert.design(cases, rain, horizon=2)
    assert not any(c.startswith("rain_") for c in alert.feature_columns(df, "season_ar"))
    assert "ar_log" in alert.feature_columns(df, "season_ar_rain")


def test_precision_and_ceiling_maths():
    idx = pd.date_range("2018-01-01", periods=10, freq="W-MON")
    actual = pd.Series([0, 0, 3, 3, 3, 3, 3, 0, 0, 0], index=idx)  # 5 outbreak weeks (> 1)
    pred = pd.Series([0, 1, 9, 8, 7, 0, 0, 6, 0, 0], index=idx, dtype=float)  # top 4: weeks 2,3,4,7
    s = alert.score("x", pred, actual, threshold=1.0, alert_rate=0.4)
    assert s.alerts == 4 and s.outbreak_weeks == 5
    assert s.hits == 3 and s.false_alerts == 1
    assert s.precision == 3 / 4
    assert s.sensitivity == 3 / 5
    assert s.sensitivity_ceiling == 4 / 5
    # more alerts than outbreak weeks: ceiling is capped at 1
    s2 = alert.score("x", pred, actual, threshold=1.0, alert_rate=0.9)
    assert s2.sensitivity_ceiling == 1.0


def test_existing_methods_unchanged_by_extra_methods():
    cases, rain = _synthetic()
    kw = {"horizon": 2, "train_years": (2008, 2014), "test_years": (2015, 2017)}
    old = alert.evaluate(cases, rain, **kw)
    new = alert.evaluate(cases, rain, methods=FIVE, **kw)
    assert [s["method"] for s in old["scores"]] == list(alert.METHODS)
    for s_old in old["scores"]:
        s_new = next(s for s in new["scores"] if s["method"] == s_old["method"])
        assert s_old == s_new
    assert old["rain_coefficients"] == new["rain_coefficients"]
