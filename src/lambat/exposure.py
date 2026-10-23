"""Step 2: who was in the water?

Combine the UP NOAH flood hazard map with WorldPop residents to estimate exposed
residents per barangay, then convert to capsule need by guideline tier
(PhilHealth, 2012): residents of flooded areas get 200 mg (two 100 mg capsules)
weekly for each flood week. Pregnant and lactating women are flagged for
referral, not counted.
"""

from __future__ import annotations

import pandas as pd

from lambat import data

CAPSULES_PER_WEEKLY_DOSE = 2
LEVELS = ("low", "med", "high")


def exposed_by_barangay(
    scenario: str = "25yr",
    levels: tuple[str, ...] = LEVELS,
    year: int | None = None,
    city: str = data.DAGUPAN,
    excluded_share: float | None = None,
    hazard: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Exposed residents per barangay for one flood scenario.

    scenario is a UP NOAH return period such as "5yr", "25yr" or "100yr".
    levels picks hazard classes to count: low (<0.5 m), med (0.5 to 1.5 m),
    high (>1.5 m).

    Assumption: residents are spread evenly over each barangay's area, so the
    exposed share of residents equals the flooded share of area. This is a known
    limit; people often live on higher ground than the flooded land.

    Columns: adm4_en, population, flooded_share (0 to 1, capped at 1), exposed,
    exposed_low, exposed_med, exposed_high, and weekly_capsules (one flood week).
    The per-level counts always cover all three levels, whatever levels is.

    excluded_share is the fraction of residents who are pregnant or lactating.
    We have no local data for it, so the default None leaves it out. When set,
    those women are removed from exposed and weekly_capsules and reported in
    refer_pregnant_lactating for referral.

    hazard defaults to the NOAH table for the city. Pass another table in the
    same shape (e.g. flood.radar_hazard) to use an observed flood instead.
    """
    if hazard is None:
        hazard = data.flood_hazard(city)
    brgy = data.barangays(city).set_index("adm4_pcode")
    pop = data.population(city, year)

    df = pd.DataFrame({"adm4_en": brgy.adm4_en, "population": pop}).dropna(subset=["adm4_en"])
    df["population"] = df.population.fillna(0)
    for level in LEVELS:
        pct = hazard[f"{scenario}_{level}"].reindex(df.index).fillna(0)
        df[f"exposed_{level}"] = df.population * (pct / 100)
    chosen = sum(hazard[f"{scenario}_{level}"] for level in levels).reindex(df.index).fillna(0)
    df["flooded_share"] = (chosen / 100).clip(upper=1)
    df["exposed"] = df.population * df.flooded_share

    if excluded_share is not None:
        df["refer_pregnant_lactating"] = df.exposed * excluded_share
        df["exposed"] = df.exposed - df.refer_pregnant_lactating
    df["weekly_capsules"] = capsule_need(df.exposed, 1)

    cols = ["adm4_en", "population", "flooded_share", "exposed", "exposed_low", "exposed_med", "exposed_high"]
    extra = [c for c in ("refer_pregnant_lactating", "weekly_capsules") if c in df]
    return df[cols + extra]


def capsule_need(eligible_residents, flood_weeks):
    """Capsules needed: residents x 2 x weeks. Accepts scalars or Series."""
    return eligible_residents * CAPSULES_PER_WEEKLY_DOSE * flood_weeks
