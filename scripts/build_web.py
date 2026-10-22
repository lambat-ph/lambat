"""Copy the results files the dashboard reads into web/data/ (GitHub Pages serves web/ only).

    uv run python scripts/build_web.py

The Sentinel-1 flood layer is copied only if results/s1_egay_flood.geojson exists; the page
shows its toggle only when that file is present in web/data/.
"""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
DATA = ROOT / "web" / "data"

REQUIRED = [
    "barangays_25yr.geojson",
    "dose_points_25yr.geojson",
    "summary_25yr.json",
    "alert_scores_dagupan.json",
    "alert_predictions_dagupan.csv",
]
OPTIONAL = ["s1_egay_flood.geojson"]


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED:
        shutil.copyfile(RESULTS / name, DATA / name)
        print(f"copied {name}")
    for name in OPTIONAL:
        src, dst = RESULTS / name, DATA / name
        if src.exists():
            shutil.copyfile(src, dst)
            print(f"copied {name}")
        else:
            dst.unlink(missing_ok=True)
            print(f"skipped {name} (not in results/)")
    manifest = {"files": sorted(p.name for p in DATA.iterdir() if p.name != "manifest.json")}
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
