"""Evaluate the two-week-ahead outbreak alert for Dagupan and save the results.

    uv run python scripts/run_alert.py
"""

import json
from pathlib import Path

import pandas as pd

from lambat import alert, data

OUT = Path(__file__).resolve().parents[1] / "results"


def main() -> None:
    cases = data.weekly_cases()
    rain = data.weekly_rainfall()["city"]
    res = alert.evaluate(cases, rain, horizon=2)

    OUT.mkdir(exist_ok=True)
    res.pop("predictions").to_csv(OUT / "alert_predictions_dagupan.csv", index_label="week")
    (OUT / "alert_scores_dagupan.json").write_text(json.dumps(res, indent=2))

    print(f"Outbreak week: more than {res['outbreak_threshold']:.0f} case(s); "
          f"test years {res['test_years'][0]}-{res['test_years'][1]}, horizon {res['horizon_weeks']} weeks")
    print(pd.DataFrame(res["scores"]).round(3).to_string(index=False))


if __name__ == "__main__":
    main()
