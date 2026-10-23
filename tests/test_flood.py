
import numpy as np
import pytest

from lambat import flood


def test_threshold_extent_needs_both_conditions():
    before = np.array([[-10.0, -10.0, -22.0, -10.0]])
    after = np.array([[-20.0, -12.0, -23.0, np.nan]])
    # col0: dark and dropped 10 -> water; col1: not dark enough; col2: dark but
    # permanently (drop 1); col3: NaN -> dry
    assert flood.threshold_extent(before, after).tolist() == [[True, False, False, False]]


def test_threshold_extent_boundaries_and_shape():
    assert flood.threshold_extent(np.array([-15.0]), np.array([-18.5]))[0]  # drop 3.5
    assert not flood.threshold_extent(np.array([-16.0]), np.array([-18.5]))[0]  # drop 2.5
    with pytest.raises(ValueError):
        flood.threshold_extent(np.zeros((2, 2)), np.zeros((3, 3)))


def test_otsu_separates_two_modes():
    rng = np.random.default_rng(0)
    water = rng.normal(-24, 1.5, 4000)
    land = rng.normal(-10, 2.0, 6000)
    t = flood.otsu_threshold(np.concatenate([water, land]))
    assert -21 < t < -13
    assert (water < t).mean() > 0.95 and (land < t).mean() < 0.05


def test_otsu_ignores_nan_and_constant():
    x = np.array([-25.0, -25.0, -9.0, -9.0, np.nan])
    assert -25 < flood.otsu_threshold(x) < -9
    assert flood.otsu_threshold(np.full(5, -12.0)) == -12.0


def test_iou_and_ignore():
    truth = np.array([[1, 1, 0, -1], [0, 0, 0, -1]])
    pred = np.array([[1, 0, 0, 1], [1, 0, 0, 1]], dtype=bool)
    # valid: 6 px. truth water 2, pred water (valid) 2, overlap 1 -> 1/3
    assert flood.iou(pred, truth) == pytest.approx(1 / 3)
    assert flood.iou(truth == 1, truth) == 1.0
    assert np.isnan(flood.iou(np.zeros((2, 2), bool), np.zeros((2, 2))))


def test_agreement():
    a = np.array([True, True, False, False])
    b = np.array([True, False, False, True])
    assert flood.agreement(a, b) == 0.5


def test_normalise_db_range_and_nan():
    x = np.array([[[-50.0, 10.0, np.nan]], [[-15.0, -30.0, 0.0]]], dtype=np.float32)
    n = flood.normalise_db(x)
    assert n.min() >= -1 and n.max() <= 1
    assert n[0, 0, 2] == 0.0


def test_radar_hazard_puts_share_in_one_level():
    import pandas as pd

    table = pd.DataFrame({"adm4_pcode": ["A", "B", "C"], "s1_threshold_share": [0.25, float("nan"), 1.4],
                          "s1_otsu_share": [0.5, 0.0, 0.1]})
    hz = flood.radar_hazard(table, scenario="egay")
    assert list(hz.columns) == ["egay_low", "egay_med", "egay_high"]
    assert hz.loc["A"].tolist() == [0.0, 25.0, 0.0]
    assert hz.loc["B", "egay_med"] == 0.0  # not seen by the radar counts as dry
    assert hz.loc["C", "egay_med"] == 100.0  # capped
    assert flood.radar_hazard(table, method="otsu", level="high").loc["A", "egay_high"] == 50.0
    with pytest.raises(ValueError):
        flood.radar_hazard(table, method="unet")
    with pytest.raises(ValueError):
        flood.radar_hazard(table, level="deep")
