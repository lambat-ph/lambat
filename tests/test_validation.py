import numpy as np
import pandas as pd
import pytest
from scipy.stats import spearmanr

from lambat import validation as V

RNG = np.random.default_rng(0)


def test_spearman_matches_scipy_with_ties():
    x = [1, 2, 2, 4, 5, 7, 7, 9]
    y = [3, 1, 4, 1, 5, 9, 2, 6]
    assert V.spearman(x, y) == pytest.approx(spearmanr(x, y)[0])


def test_spearman_constant_is_nan():
    assert np.isnan(V.spearman([1, 1, 1, 1], [1, 2, 3, 4]))


def test_bootstrap_ci_brackets_estimate_and_is_reproducible():
    x = RNG.normal(size=40)
    y = x + RNG.normal(size=40)
    lo, hi = V.bootstrap_ci(x, y, n_boot=1000)
    assert lo < V.spearman(x, y) < hi
    assert (lo, hi) == V.bootstrap_ci(x, y, n_boot=1000)


def test_bootstrap_ci_narrows_with_more_data():
    def width(n):
        x = np.random.default_rng(1).normal(size=n)
        y = x + np.random.default_rng(2).normal(size=n)
        lo, hi = V.bootstrap_ci(x, y, n_boot=1000)
        return hi - lo

    assert width(400) < width(30)


def test_permutation_p_small_for_signal_large_for_noise():
    x = RNG.normal(size=40)
    assert V.permutation_p(x, x + 0.1 * RNG.normal(size=40), n_perm=2000) < 0.01
    assert V.permutation_p(x, RNG.normal(size=40), n_perm=2000) > 0.05


def test_permutation_p_roughly_uniform_under_null():
    ps = [V.permutation_p(RNG.normal(size=25), RNG.normal(size=25), n_perm=300, seed=i) for i in range(150)]
    assert 0.01 < np.mean(np.array(ps) < 0.05) < 0.12


def test_partial_spearman_removes_confounder():
    z = RNG.normal(size=300)
    x = z + 0.3 * RNG.normal(size=300)
    y = z + 0.3 * RNG.normal(size=300)
    assert V.spearman(x, y) > 0.7
    assert abs(V.partial_spearman(x, y, z)) < 0.15
    assert V.permutation_p(x, y, z, n_perm=1000) > 0.01


def test_partial_spearman_keeps_real_signal():
    z = RNG.normal(size=300)
    x = RNG.normal(size=300)
    y = x + z + 0.3 * RNG.normal(size=300)
    assert V.partial_spearman(x, y, z) > 0.6


def test_holm_known_values():
    adj = V.holm([0.01, 0.04, 0.03, np.nan])
    assert adj[0] == pytest.approx(0.03)
    assert adj[2] == pytest.approx(0.06)
    assert adj[1] == pytest.approx(0.06)
    assert np.isnan(adj[3])


def test_auc_basic():
    assert V.auc([1, 2, 3, 4], [0, 0, 1, 1]) == 1.0
    assert V.auc([4, 3, 2, 1], [0, 0, 1, 1]) == 0.0
    assert V.auc([1, 1, 1, 1], [0, 1, 0, 1]) == 0.5
    assert np.isnan(V.auc([1, 2], [1, 1]))


def test_event_auc_detects_signal_and_skips_small_events():
    n = 30
    score = np.arange(n, dtype=float)
    mem = np.zeros((3, n), bool)
    mem[0, 20:] = True  # top scores reported
    mem[1, 22:] = True
    mem[2, :2] = True  # only 2 reported: skipped
    m = pd.DataFrame(mem, index=list("abc"), columns=range(n))
    r = V.event_auc(score, m, n_boot=500, n_perm=500)
    assert r["n_events"] == 2
    assert r["auc_mean"] > 0.95
    assert r["auc_p"] < 0.05


def test_event_auc_null_is_near_half():
    n = 31
    mem = RNG.random((8, n)) < 0.3
    r = V.event_auc(RNG.normal(size=n), pd.DataFrame(mem), n_boot=500, n_perm=500)
    assert 0.3 < r["auc_mean"] < 0.7
    assert r["auc_lo"] <= r["auc_mean"] <= r["auc_hi"]


def test_paired_diff_ci_excludes_zero_for_clearly_better_predictor():
    y = RNG.normal(size=80)
    good = y + 0.2 * RNG.normal(size=80)
    bad = RNG.normal(size=80)
    lo, _hi = V.paired_diff_ci(good, bad, y, n_boot=1000)
    assert lo > 0


def _synthetic():
    n = 40
    idx = pd.Index([f"B{i}" for i in range(n)])
    truth = RNG.normal(size=n)
    c = pd.DataFrame({V.BASELINE: RNG.normal(size=n), "good": truth + 0.1 * RNG.normal(size=n),
                      "noise": RNG.normal(size=n), "log_population": RNG.normal(size=n)}, index=idx)
    y = pd.Series(np.round(2 * truth + 3), index=idx)
    return c, y


def test_candidate_table_columns_and_holm():
    c, y = _synthetic()
    t = V.candidate_table(c, y, control=c.log_population, family=[V.BASELINE, "good", "noise"],
                          n_boot=300, n_perm=500)
    for col in ("rho", "ci_lo", "ci_hi", "p", "p_holm", "partial_rho", "diff_lo"):
        assert col in t.columns
    assert t.loc["good", "rho"] > 0.8
    assert t.loc["good", "p_holm"] >= t.loc["good", "p"]
    assert pd.isna(t.loc["log_population", "p_holm"])


def test_select_model_keeps_baseline_unless_clearly_better():
    c, y = _synthetic()
    fam = [V.BASELINE, "good", "noise"]
    t = V.candidate_table(c, y, family=fam, n_boot=500, n_perm=1000)
    sel = V.select_model(t)
    assert sel["chosen"] == "good" and sel["switched"]
    t2 = V.candidate_table(c[[V.BASELINE, "noise"]], y, family=[V.BASELINE, "noise"], n_boot=500, n_perm=1000)
    assert V.select_model(t2) == {"chosen": V.BASELINE, "switched": False, "qualified": []}


def test_outcomes_and_membership_from_reports():
    rep = pd.DataFrame({"event_name": ["Storm A", "Storm A", "High tide B", "Storm surge C", "Storm A"],
                        "barangay": ["X", "Y", "X", "X", "X"]})
    names = pd.Index(["X", "Y", "Z"])
    o = V.outcomes_from_reports(rep, names)
    assert o.loc["X", "events_all"] == 3 and o.loc["X", "events_tidal"] == 2
    assert o.loc["Y", "events_nontidal"] == 1 and o.loc["Z", "events_all"] == 0
    m = V.event_membership(rep, names)
    assert m.shape == (3, 3) and bool(m.loc["Storm A", "Y"]) and not m.loc["High tide B", "Z"]


def test_build_candidates_has_all_preregistered_columns():
    idx = pd.Index(["A", "B", "C", "D"])
    hz = pd.DataFrame({f"{s}_{lv}": [10.0, 0, 50, 5] for s in ("5yr", "25yr", "100yr") for lv in ("low", "med", "high")},
                      index=idx)
    pop = pd.Series([100.0, 200, 300, 400], index=idx)
    c = V.build_candidates(hz, pop, pd.Series([1.0, 2, 3, 4], index=idx), pd.Series([500.0, 100, 900, 0], index=idx),
                           pd.Series([3.0, 1, 5, 2], index=idx))
    assert list(c.columns) == [k.name for k in V.PREREGISTERED]
    assert c.loc["A", "noah_25yr_all"] == pytest.approx(0.3)
    assert c.loc["C", "exposed_25yr"] == pytest.approx(300 * 1.0)  # share capped at 1
    assert c.loc["D", "coast_proximity"] == 0
    assert c.coast_proximity.idxmax() == "D"
