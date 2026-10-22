"""Step 2: who was in the water?

Overlay flood extent on the population grid, sum exposed residents per barangay,
and convert to capsule need by guideline tier (PhilHealth, 2012): residents of
flooded areas get 200 mg (two 100 mg capsules) weekly for each flood week.
Pregnant and lactating women are flagged for referral, not counted.
"""

CAPSULES_PER_WEEKLY_DOSE = 2


def exposed_by_barangay(flood_extent, population_grid, barangays):
    raise NotImplementedError


def capsule_need(eligible_residents, flood_weeks):
    return eligible_residents * CAPSULES_PER_WEEKLY_DOSE * flood_weeks
