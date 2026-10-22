"""Validation: how well does the barangay flood ranking agree with news reports?

Honest characterisation, not tuning. The rules are fixed here, in code, BEFORE the
new candidates' correlations were looked at:

* PREREGISTERED lists every candidate predictor. All are reported, none dropped.
  Sign convention: higher value = expected to be flooded more often (distance to
  coast and elevation are negated).
* Every Spearman gets a bootstrap 95% CI (resample barangays), a two-sided
  permutation p-value, and a Holm-adjusted p across the family of candidates.
* News bias is measured, not assumed: population rows are reported as references,
  and every candidate also gets a partial Spearman controlling for log population.
* Event-level check: for each event with enough named barangays, the AUC of the
  predictor for reported vs not-reported barangays, averaged over events.
* SELECTION_RULE picks the dashboard model. It is not "max correlation".

What was already seen before pre-registration: the pipeline's headline numbers
(25yr flooded share -0.10, 25yr exposed 0.26) and the 5yr medium class (0.33).
Those candidates carry seen_before=True. Every other number was computed after
this file was written.

Everything here is pure numpy/pandas/scipy so it can be tested on synthetic data.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.stats import rankdata

N_BOOT = 5000
N_PERM = 10000
SEED = 20261023
BASELINE = "noah_25yr_all"
CONTROL = "log_population"
MIN_REPORTED_PER_EVENT = 3

SELECTION_RULE = (
    "Keep the baseline (25yr flooded share, all depth classes) unless an alternative meets BOTH: "
    "(1) the paired-bootstrap 95% CI of rho(alternative) - rho(baseline) excludes 0, and "
    "(2) its Holm-adjusted permutation p-value is below 0.05, computed over the whole pre-registered family. "
    "If several qualify, take the one with the larger Spearman. If none qualify, the baseline stays."
)


@dataclass(frozen=True)
class Candidate:
    name: str
    description: str
    seen_before: bool = False  # correlation was already known when the family was fixed
    in_family: bool = True  # False for reference rows (population measures)


PREREGISTERED: tuple[Candidate, ...] = (
    Candidate("noah_5yr_all", "NOAH 5yr flooded share, low+med+high"),
    Candidate(BASELINE, "NOAH 25yr flooded share, low+med+high (current pipeline model)", seen_before=True),
    Candidate("noah_100yr_all", "NOAH 100yr flooded share, low+med+high"),
    Candidate("noah_5yr_low", "NOAH 5yr area share, depth < 0.5 m"),
    Candidate("noah_5yr_med", "NOAH 5yr area share, depth 0.5 to 1.5 m", seen_before=True),
    Candidate("noah_5yr_high", "NOAH 5yr area share, depth > 1.5 m"),
    Candidate("noah_25yr_low", "NOAH 25yr area share, depth < 0.5 m"),
    Candidate("noah_25yr_med", "NOAH 25yr area share, depth 0.5 to 1.5 m"),
    Candidate("noah_25yr_high", "NOAH 25yr area share, depth > 1.5 m"),
    Candidate("noah_100yr_low", "NOAH 100yr area share, depth < 0.5 m"),
    Candidate("noah_100yr_med", "NOAH 100yr area share, depth 0.5 to 1.5 m"),
    Candidate("noah_100yr_high", "NOAH 100yr area share, depth > 1.5 m"),
    Candidate("exposed_25yr", "Exposed residents, 25yr (population x flooded share)", seen_before=True),
    Candidate("coast_proximity", "Negative distance from barangay to coast (CCHAIN brgy_distance_to_coast)"),
    Candidate("low_elevation", "Negative mean Terrarium elevation over a 100 m grid inside the barangay"),
    Candidate("combo_haz25_coast", "Rank average of noah_25yr_all and coast_proximity"),
    Candidate("combo_haz25_elev", "Rank average of noah_25yr_all and low_elevation"),
    Candidate("combo_coast_elev", "Rank average of coast_proximity and low_elevation (no NOAH)"),
    Candidate("population", "Residents (WorldPop). Reference row: measures news bias", in_family=False),
    Candidate("log_population", "log(1 + residents). Control variable and reference row", in_family=False),
    Candidate("pop_density", "Residents per km2. Reference row", in_family=False),
)

OUTCOMES = {
    "events_all": "distinct reported events naming the barangay (primary)",
    "events_tidal": "events whose name contains 'tide' or 'surge'",
    "events_nontidal": "all other events (rain, monsoon, typhoon, unspecified)",
}


# ---------------------------------------------------------------- statistics

def _rank_corr_rows(rx: np.ndarray, ry: np.ndarray) -> np.ndarray:
    """Pearson correlation along the last axis of already-ranked arrays."""
    rx = rx - rx.mean(axis=-1, keepdims=True)
    ry = ry - ry.mean(axis=-1, keepdims=True)
    den = np.sqrt((rx**2).sum(axis=-1) * (ry**2).sum(axis=-1))
    with np.errstate(invalid="ignore", divide="ignore"):
        return (rx * ry).sum(axis=-1) / den


def _partial_from_rho(rxy, rxz, ryz):
    with np.errstate(invalid="ignore", divide="ignore"):
        return (rxy - rxz * ryz) / np.sqrt((1 - rxz**2) * (1 - ryz**2))


def spearman(x, y) -> float:
    """Spearman rank correlation with average ranks for ties. NaN if either is constant."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    return float(_rank_corr_rows(rankdata(x), rankdata(y)))


def partial_spearman(x, y, z) -> float:
    """Spearman correlation of x and y after removing the rank-linear effect of z."""
    x, y, z = (np.asarray(v, float) for v in (x, y, z))
    return float(_partial_from_rho(spearman(x, y), spearman(x, z), spearman(y, z)))


def _boot_idx(n: int, n_boot: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, n, size=(n_boot, n))


def _stat_rows(x, y, z, idx):
    xs, ys = x[idx], y[idx]
    rx, ry = rankdata(xs, axis=1), rankdata(ys, axis=1)
    rxy = _rank_corr_rows(rx, ry)
    if z is None:
        return rxy
    rz = rankdata(z[idx], axis=1)
    return _partial_from_rho(rxy, _rank_corr_rows(rx, rz), _rank_corr_rows(ry, rz))


def _ci(values: np.ndarray, alpha: float) -> tuple[float, float]:
    v = values[np.isfinite(values)]
    if len(v) < 10:
        return (float("nan"), float("nan"))
    lo, hi = np.percentile(v, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    return float(lo), float(hi)


def bootstrap_ci(x, y, z=None, n_boot: int = N_BOOT, seed: int = SEED, alpha: float = 0.05) -> tuple[float, float]:
    """Percentile bootstrap CI for Spearman (or partial Spearman if z is given), resampling rows."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    z = None if z is None else np.asarray(z, float)
    return _ci(_stat_rows(x, y, z, _boot_idx(len(x), n_boot, seed)), alpha)


def paired_diff_ci(x_alt, x_base, y, n_boot: int = N_BOOT, seed: int = SEED, alpha: float = 0.05) -> tuple[float, float]:
    """CI for rho(alt, y) - rho(base, y) using the SAME resampled barangays for both."""
    x_alt, x_base, y = (np.asarray(v, float) for v in (x_alt, x_base, y))
    idx = _boot_idx(len(y), n_boot, seed)
    return _ci(_stat_rows(x_alt, y, None, idx) - _stat_rows(x_base, y, None, idx), alpha)


def permutation_p(x, y, z=None, n_perm: int = N_PERM, seed: int = SEED) -> float:
    """Two-sided permutation p-value: shuffle x against (y, z), recompute the statistic."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    rng = np.random.default_rng(seed)
    n = len(x)
    perm = np.argsort(rng.random((n_perm, n)), axis=1)
    rx, ry = rankdata(x), rankdata(y)
    rxp = rx[perm]
    rxy_p = _rank_corr_rows(rxp, np.broadcast_to(ry, rxp.shape))
    if z is None:
        obs, null = _rank_corr_rows(rx, ry), rxy_p
    else:
        rz = rankdata(np.asarray(z, float))
        ryz = _rank_corr_rows(ry, rz)
        obs = _partial_from_rho(_rank_corr_rows(rx, ry), _rank_corr_rows(rx, rz), ryz)
        null = _partial_from_rho(rxy_p, _rank_corr_rows(rxp, np.broadcast_to(rz, rxp.shape)), ryz)
    if not np.isfinite(obs):
        return float("nan")
    null = null[np.isfinite(null)]
    return float((1 + np.sum(np.abs(null) >= abs(obs) - 1e-12)) / (1 + len(null)))


def holm(p) -> np.ndarray:
    """Holm-Bonferroni adjusted p-values (NaN stay NaN)."""
    p = np.asarray(p, float)
    out = np.full_like(p, np.nan)
    ok = np.where(np.isfinite(p))[0]
    order = ok[np.argsort(p[ok])]
    m = len(order)
    running = 0.0
    for i, j in enumerate(order):
        running = max(running, min(1.0, (m - i) * p[j]))
        out[j] = running
    return out


def auc(score, labels) -> float:
    """P(score of a positive > score of a negative), ties count half. NaN if one class is empty."""
    score, labels = np.asarray(score, float), np.asarray(labels, bool)
    n1, n0 = int(labels.sum()), int((~labels).sum())
    if n1 == 0 or n0 == 0:
        return float("nan")
    r = rankdata(score)
    return float((r[labels].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def event_auc(score, membership: pd.DataFrame, min_reported: int = MIN_REPORTED_PER_EVENT,
              n_boot: int = N_BOOT, n_perm: int = N_PERM, seed: int = SEED) -> dict:
    """Mean per-event AUC of score for reported vs not-reported barangays.

    membership: rows = events, columns = barangays (same order as score), bool.
    Only events naming at least min_reported barangays are used. CI resamples events;
    the p-value shuffles which barangays count as reported inside each event (one-sided
    test of AUC > 0.5 is NOT used; the p is two-sided on |AUC - 0.5|).
    """
    score = np.asarray(score, float)
    mem = membership.to_numpy(bool)
    keep = (mem.sum(axis=1) >= min_reported) & (mem.sum(axis=1) < mem.shape[1])
    mem = mem[keep]
    out = {"n_events": int(len(mem)), "auc_mean": float("nan"), "auc_lo": float("nan"),
           "auc_hi": float("nan"), "auc_p": float("nan")}
    if len(mem) == 0:
        return out
    per = np.array([auc(score, row) for row in mem])
    out["auc_mean"] = float(per.mean())
    rng = np.random.default_rng(seed)
    boots = per[rng.integers(0, len(per), size=(n_boot, len(per)))].mean(axis=1)
    out["auc_lo"], out["auc_hi"] = _ci(boots, 0.05)
    r = rankdata(score)
    n = len(score)
    null = np.zeros((n_perm, len(mem)))
    for k, row in enumerate(mem):
        n1 = int(row.sum())
        perm = np.argsort(rng.random((n_perm, n)), axis=1)[:, :n1]
        null[:, k] = (r[perm].sum(axis=1) - n1 * (n1 + 1) / 2) / (n1 * (n - n1))
    null_mean = null.mean(axis=1)
    out["auc_p"] = float((1 + np.sum(np.abs(null_mean - 0.5) >= abs(out["auc_mean"] - 0.5) - 1e-12)) / (1 + n_perm))
    return out


# ------------------------------------------------------------------ the table

def rank_average(*cols) -> pd.Series:
    """Mean of the percentile ranks of each column (ties averaged)."""
    ranks = [pd.Series(c).rank() for c in cols]
    return sum(ranks) / len(ranks)


def candidate_table(
    cands: pd.DataFrame,
    outcome,
    control=None,
    membership: pd.DataFrame | None = None,
    baseline: str = BASELINE,
    family: list[str] | None = None,
    n_boot: int = N_BOOT,
    n_perm: int = N_PERM,
    seed: int = SEED,
) -> pd.DataFrame:
    """One row per candidate column of cands against outcome (aligned on index).

    Columns: rho, ci_lo, ci_hi, p, p_holm (family only), partial_rho (+ci, p) if control
    given, diff_vs_baseline with paired CI, and event-level AUC if membership is given.
    family lists which columns count toward the Holm correction (default: all).
    """
    y = np.asarray(outcome.reindex(cands.index) if isinstance(outcome, pd.Series) else outcome, float)
    z = None
    if control is not None:
        z = np.asarray(control.reindex(cands.index) if isinstance(control, pd.Series) else control, float)
    family = list(cands.columns) if family is None else family
    rows = []
    for name in cands.columns:
        x = cands[name].to_numpy(float)
        lo, hi = bootstrap_ci(x, y, n_boot=n_boot, seed=seed)
        row = {"candidate": name, "n": len(x), "rho": spearman(x, y), "ci_lo": lo, "ci_hi": hi,
               "p": permutation_p(x, y, n_perm=n_perm, seed=seed)}
        if z is not None:
            plo, phi = bootstrap_ci(x, y, z, n_boot=n_boot, seed=seed)
            row.update(partial_rho=partial_spearman(x, y, z), partial_lo=plo, partial_hi=phi,
                       partial_p=permutation_p(x, y, z, n_perm=n_perm, seed=seed))
        if baseline in cands.columns:
            if name == baseline:
                row.update(diff_vs_baseline=0.0, diff_lo=0.0, diff_hi=0.0)
            else:
                dlo, dhi = paired_diff_ci(x, cands[baseline].to_numpy(float), y, n_boot=n_boot, seed=seed)
                row.update(diff_vs_baseline=row["rho"] - spearman(cands[baseline], y), diff_lo=dlo, diff_hi=dhi)
        if membership is not None:
            row.update(event_auc(x, membership.reindex(columns=cands.index), n_boot=n_boot, n_perm=n_perm, seed=seed))
        rows.append(row)
    tab = pd.DataFrame(rows).set_index("candidate")
    tab["in_family"] = tab.index.isin(family)
    tab["p_holm"] = np.nan
    fam = tab[tab.in_family]
    tab.loc[fam.index, "p_holm"] = holm(fam.p.to_numpy())
    return tab


def select_model(tab: pd.DataFrame, baseline: str = BASELINE, alpha: float = 0.05) -> dict:
    """Apply SELECTION_RULE to a candidate_table of the primary outcome."""
    qualified = tab[
        tab.in_family
        & (tab.index != baseline)
        & ((tab.diff_lo > 0) | (tab.diff_hi < 0))
        & (tab.p_holm < alpha)
        & (tab.rho > tab.loc[baseline, "rho"])
    ]
    if qualified.empty:
        return {"chosen": baseline, "switched": False, "qualified": []}
    best = qualified.rho.idxmax()
    return {"chosen": best, "switched": True, "qualified": list(qualified.index)}


# ------------------------------------------------------- real-data inputs

def event_membership(reports: pd.DataFrame, names: pd.Index) -> pd.DataFrame:
    """events x barangay-names boolean matrix from the reports CSV."""
    m = pd.crosstab(reports.event_name, reports.barangay) > 0
    return m.reindex(columns=names, fill_value=False)


def is_tidal(event_name: str) -> bool:
    n = event_name.lower()
    return "tide" in n or "surge" in n


def outcomes_from_reports(reports: pd.DataFrame, names: pd.Index) -> pd.DataFrame:
    """Event counts per barangay name for each outcome in OUTCOMES."""
    tidal = reports.event_name.map(is_tidal)

    def count(df):
        return df.groupby("barangay").event_name.nunique().reindex(names).fillna(0)

    return pd.DataFrame({"events_all": count(reports), "events_tidal": count(reports[tidal]),
                         "events_nontidal": count(reports[~tidal])})


def mean_elevation(barangays, spacing_m: float = 100.0) -> pd.Series:
    """Mean Terrarium elevation (m) over a regular grid inside each barangay polygon.

    barangays: GeoDataFrame in WGS84 with adm4_pcode. Coarse (~30 m SRTM-class), so a rank signal only.
    """
    import geopandas as gpd

    from lambat import data, elevation

    g = barangays.set_index("adm4_pcode").to_crs(data.CRS_METRIC)
    out = {}
    for code, geom in g.geometry.items():
        x0, y0, x1, y1 = geom.bounds
        gx, gy = np.meshgrid(np.arange(x0, x1, spacing_m), np.arange(y0, y1, spacing_m))
        from shapely import contains_xy
        m = contains_xy(geom, gx.ravel(), gy.ravel())
        px, py = gx.ravel()[m], gy.ravel()[m]
        if len(px) == 0:
            p = geom.representative_point()
            px, py = np.array([p.x]), np.array([p.y])
        pts = gpd.GeoSeries(gpd.points_from_xy(px, py), crs=data.CRS_METRIC).to_crs("EPSG:4326")
        out[code] = float(np.mean(elevation.sample(pts.x.to_numpy(), pts.y.to_numpy())))
    return pd.Series(out, name="mean_elevation_m")


def build_candidates(scenario_hazard: pd.DataFrame, population: pd.Series, area_km2: pd.Series,
                     distance_to_coast: pd.Series, elevation_m: pd.Series) -> pd.DataFrame:
    """All PREREGISTERED columns, indexed like population. Inputs are indexed by adm4_pcode.

    scenario_hazard: percent of area per class, columns like '25yr_low' (data.flood_hazard()).
    """
    idx = population.index
    hz = scenario_hazard.reindex(idx).fillna(0.0)
    c = pd.DataFrame(index=idx)
    for s in ("5yr", "25yr", "100yr"):
        for lvl in ("low", "med", "high"):
            c[f"noah_{s}_{lvl}"] = hz[f"{s}_{lvl}"] / 100
        c[f"noah_{s}_all"] = (sum(hz[f"{s}_{lvl}"] for lvl in ("low", "med", "high")) / 100).clip(upper=1)
    c["exposed_25yr"] = population * c["noah_25yr_all"]
    c["coast_proximity"] = -distance_to_coast.reindex(idx)
    c["low_elevation"] = -elevation_m.reindex(idx)
    c["combo_haz25_coast"] = rank_average(c[BASELINE], c.coast_proximity)
    c["combo_haz25_elev"] = rank_average(c[BASELINE], c.low_elevation)
    c["combo_coast_elev"] = rank_average(c.coast_proximity, c.low_elevation)
    c["population"] = population
    c["log_population"] = np.log1p(population)
    c["pop_density"] = population / area_km2.reindex(idx)
    return c[[k.name for k in PREREGISTERED]]
