"""Compare candidate barangay flood predictors with news-reported flood events.

    uv run python scripts/run_validation.py [--n-boot 5000 --n-perm 10000]

The candidate family, the outcomes and the model-selection rule are fixed in
src/lambat/validation.py before any new correlation was inspected. All candidates
are reported. See docs/validation.md.

Outputs in results/: validation_table.csv (every candidate x outcome) and
validation_summary.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from lambat import data
from lambat import validation as V

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
REPORTS = ROOT / "data" / "validation" / "dagupan_flood_reports.csv"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-boot", type=int, default=V.N_BOOT)
    ap.add_argument("--n-perm", type=int, default=V.N_PERM)
    args = ap.parse_args()

    brgy = data.barangays()
    pop = data.population()
    geo = pd.read_csv(data.RAW / "brgy_geography.csv", usecols=["adm4_pcode", "brgy_distance_to_coast"])
    dist = geo.drop_duplicates("adm4_pcode").set_index("adm4_pcode").brgy_distance_to_coast
    area = brgy.set_index("adm4_pcode").brgy_total_area
    elev = V.mean_elevation(brgy)
    cands = V.build_candidates(data.flood_hazard(), pop.reindex(brgy.adm4_pcode), area, dist, elev)
    cands = cands.dropna()

    names = brgy.set_index("adm4_pcode").adm4_en.reindex(cands.index)
    reports = pd.read_csv(REPORTS)
    outcomes = V.outcomes_from_reports(reports, pd.Index(names.values))
    outcomes.index = cands.index
    membership = V.event_membership(reports, pd.Index(names.values))
    membership.columns = cands.index
    tidal = membership.index.map(V.is_tidal).to_numpy(bool)
    mem_for = {"events_all": membership, "events_tidal": membership[tidal],
               "events_nontidal": membership[~tidal]}

    family = [c.name for c in V.PREREGISTERED if c.in_family]
    tables = []
    for oc in V.OUTCOMES:
        t = V.candidate_table(cands, outcomes[oc], control=cands[V.CONTROL], membership=mem_for[oc],
                              family=family, n_boot=args.n_boot, n_perm=args.n_perm)
        t.insert(0, "outcome", oc)
        tables.append(t)
    table = pd.concat(tables)
    desc = {c.name: c for c in V.PREREGISTERED}
    table["description"] = [desc[i].description for i in table.index]
    table["seen_before"] = [desc[i].seen_before for i in table.index]
    OUT.mkdir(exist_ok=True)
    table.to_csv(OUT / "validation_table.csv", index_label="candidate")

    primary = table[table.outcome == "events_all"]
    choice = V.select_model(primary)
    head_cols = ["rho", "ci_lo", "ci_hi", "p", "p_holm", "partial_rho", "partial_lo", "partial_hi",
                 "partial_p", "auc_mean", "auc_lo", "auc_hi", "auc_p", "n_events"]
    summary = {
        "n_barangays": int(len(cands)),
        "n_events": int(reports.event_name.nunique()),
        "n_barangays_reported": int((outcomes.events_all > 0).sum()),
        "n_candidates_in_family": len(family),
        "n_boot": args.n_boot, "n_perm": args.n_perm, "seed": V.SEED,
        "selection_rule": V.SELECTION_RULE,
        "selection": choice,
        "headline_candidate": choice["chosen"],
        "headline": primary.loc[choice["chosen"], head_cols].astype(float).round(4).to_dict(),
        "news_bias_population_vs_events": primary.loc[["population", "log_population", "pop_density"],
                                                      ["rho", "ci_lo", "ci_hi", "p"]].round(4).to_dict("index"),
        "best_by_rho_for_information_only": primary[primary.in_family].rho.idxmax(),
        "n_candidates_p_holm_below_0.05": int((primary.p_holm < 0.05).sum()),
        "n_candidates_p_raw_below_0.05": int((primary[primary.in_family].p < 0.05).sum()),
        "caveat": "31 barangays, 13 events, news-biased sample. Agreement is a rough check, not a skill score.",
    }
    (OUT / "validation_summary.json").write_text(json.dumps(summary, indent=2))

    cols = ["rho", "ci_lo", "ci_hi", "p", "p_holm", "partial_rho", "partial_p", "auc_mean", "diff_vs_baseline"]
    pd.set_option("display.width", 200)
    print(f"Primary outcome: events_all ({summary['n_events']} events, "
          f"{summary['n_barangays_reported']}/{summary['n_barangays']} barangays reported)")
    print(primary[cols].round(3).to_string())
    print("Selection:", choice)


if __name__ == "__main__":
    main()
