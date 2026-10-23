import pandas as pd
import pytest

from lambat import data, exposure

RAW_HAZARD = data.RAW / "project_noah_hazards.csv"


@pytest.fixture
def synthetic(monkeypatch):
    idx = pd.Index(["A", "B", "C"], name="adm4_pcode")
    brgy = pd.DataFrame({"adm4_pcode": ["A", "B", "C"], "adm4_en": ["Alpha", "Beta", "Gamma"]})
    pop = pd.Series([1000, 2000, 500], index=idx, name="population")
    hazard = pd.DataFrame(
        {
            "25yr_low": [10.0, 0.0, 60.0],
            "25yr_med": [10.0, 0.0, 30.0],
            "25yr_high": [5.0, 0.0, 30.0],
            "5yr_low": [0.0, 0.0, 0.0],
            "5yr_med": [0.0, 0.0, 0.0],
            "5yr_high": [0.0, 0.0, 0.0],
        },
        index=idx,
    )
    monkeypatch.setattr(data, "barangays", lambda city=data.DAGUPAN: brgy)
    monkeypatch.setattr(data, "population", lambda city=data.DAGUPAN, year=None: pop)
    monkeypatch.setattr(data, "flood_hazard", lambda city=data.DAGUPAN: hazard)


def test_exposed_is_population_times_flooded_share(synthetic):
    df = exposure.exposed_by_barangay("25yr")
    assert df.loc["A", "flooded_share"] == pytest.approx(0.25)
    assert df.loc["A", "exposed"] == pytest.approx(250)
    assert df.loc["B", "exposed"] == 0
    assert df.loc["A", "adm4_en"] == "Alpha"


def test_share_is_capped_at_one(synthetic):
    df = exposure.exposed_by_barangay("25yr")
    assert df.loc["C", "flooded_share"] == 1
    assert df.loc["C", "exposed"] == 500


def test_levels_filter_and_per_level_columns(synthetic):
    df = exposure.exposed_by_barangay("25yr", levels=("high",))
    assert df.loc["A", "exposed"] == pytest.approx(50)
    assert df.loc["A", "exposed_low"] == pytest.approx(100)
    assert df.loc["A", "exposed_med"] == pytest.approx(100)
    assert df.loc["A", "exposed_high"] == pytest.approx(50)


def test_weekly_capsules(synthetic):
    df = exposure.exposed_by_barangay("25yr")
    assert df.loc["A", "weekly_capsules"] == pytest.approx(500)


def test_pregnant_lactating_excluded_when_given(synthetic):
    base = exposure.exposed_by_barangay("25yr")
    df = exposure.exposed_by_barangay("25yr", excluded_share=0.1)
    assert "refer_pregnant_lactating" not in base
    assert df.loc["A", "refer_pregnant_lactating"] == pytest.approx(25)
    assert df.loc["A", "exposed"] == pytest.approx(225)
    assert df.loc["A", "weekly_capsules"] == pytest.approx(450)


def test_capsule_need_scalar_and_series():
    assert exposure.capsule_need(100, 3) == 600
    out = exposure.capsule_need(pd.Series([1, 2]), 2)
    assert list(out) == [4, 8]


@pytest.mark.skipif(not RAW_HAZARD.exists(), reason="raw CCHAIN data not downloaded")
def test_real_data_smoke():
    df = exposure.exposed_by_barangay("25yr")
    assert len(df) == 31
    assert df.flooded_share.between(0, 1).all()
    assert (df.exposed <= df.population + 1e-9).all()
    assert df.exposed.sum() > 0


def test_hazard_table_can_be_passed_in(synthetic):
    idx = pd.Index(["A", "B", "C"], name="adm4_pcode")
    radar = pd.DataFrame({"egay_low": 0.0, "egay_med": [0.0, 50.0, 0.0], "egay_high": 0.0}, index=idx)
    df = exposure.exposed_by_barangay("egay", hazard=radar)
    assert df.loc["B", "exposed"] == pytest.approx(1000)
    assert df.loc["A", "exposed"] == 0
