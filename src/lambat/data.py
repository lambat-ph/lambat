"""Load and clean inputs: Project CCHAIN cases and rainfall, barangay boundaries,
population grid, facility list. Writes tidy tables to data/processed/."""


def load_weekly_cases(path, disease="LEPTOSPIROSIS"):
    """Weekly case counts per city from disease_pidsr_totals.csv."""
    raise NotImplementedError


def load_weekly_rainfall(path):
    """Weekly total rainfall per barangay from climate_atmosphere.csv."""
    raise NotImplementedError
