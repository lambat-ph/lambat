"""Map the Typhoon Egay flood in Dagupan from Sentinel-1 and compare with NOAH and news reports.

    uv run python scripts/run_s1_flood.py [--speckle 5 --drop-db 3 --water-db -18 --rebuild]

Inputs in data/raw/s1/ (zip files): the flood scene (2023-07-28) and the dry reference
(2023-04-11), both track 32 descending. Both are cropped to the same 10 m EPSG:32651 grid.

Flood masks (VV): change-detection threshold (flood.threshold_extent), Otsu on the flood
image alone, and, if a checkpoint and torch are available, the U-Net. Permanent water
(dark in the dry scene) is excluded from every mask and from the denominator.

Outputs in results/: s1_egay_barangays.csv, s1_egay_flood.geojson, s1_egay_quicklook.png,
s1_egay_summary.json. Scenes are cached as data/processed/s1_<yyyymmdd>.tif.
See docs/sentinel1.md.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from lambat import data, flood
from lambat import sentinel1 as s1
from lambat import validation as V

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
REPORTS = ROOT / "data" / "validation" / "dagupan_flood_reports.csv"
EVENT = "Typhoon Egay / habagat 2023"
FLOOD_DATE, DRY_DATE = "20230728", "20230411"


def find_scene(folder: Path, date: str) -> Path:
    hits = [p for p in sorted(folder.iterdir()) if re.search(rf"_{date}T\d{{6}}_", p.name) and
            (p.suffix == ".zip" or p.is_dir())]
    if len(hits) != 1:
        raise SystemExit(f"expected exactly one scene for {date} in {folder}, found {len(hits)}")
    return hits[0]


def scene_db(path: Path, bounds, speckle: int, margin: float, rebuild: bool, cache: Path):
    tif = cache / f"s1_{s1.Product(path).date}.tif"
    meta = tif.with_suffix(".json")
    if tif.exists() and meta.exists() and not rebuild:
        info = json.loads(meta.read_text())
        if info.get("speckle_median") == speckle and info.get("margin_m") == margin:
            arr, tr, crs = s1.read_geotiff(tif)
            return arr, tr, crs, info
    arr, tr, crs, info = s1.load_sigma0_db(path, bounds, margin_m=margin, speckle=speckle)
    info["margin_m"] = margin
    s1.write_geotiff(tif, arr, tr, crs)
    meta.write_text(json.dumps(info, indent=1))
    return arr, tr, crs, info


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, np.integer):
        return int(o)
    return o


def corr(x, y, n_boot, n_perm):
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = np.asarray(x)[ok], np.asarray(y)[ok]
    if ok.sum() < 5 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return {"n": int(ok.sum()), "rho": None, "lo": None, "hi": None, "p": None}
    lo, hi = V.bootstrap_ci(x, y, n_boot=n_boot)
    return {"n": int(ok.sum()), "rho": V.spearman(x, y), "lo": lo, "hi": hi,
            "p": V.permutation_p(x, y, n_perm=n_perm)}


def report_auc(score, reported, n_boot, n_perm):
    ok = np.isfinite(score)
    score, rep = np.asarray(score)[ok], np.asarray(reported)[ok]
    a = V.auc(score, rep)
    rng = np.random.default_rng(V.SEED)
    boots = []
    for _ in range(n_boot):
        i = rng.integers(0, len(score), len(score))
        b = V.auc(score[i], rep[i])
        if np.isfinite(b):
            boots.append(b)
    lo, hi = np.percentile(boots, [2.5, 97.5]) if boots else (np.nan, np.nan)
    mem = pd.DataFrame([rep], index=[EVENT])
    p = V.event_auc(score, mem, min_reported=3, n_boot=10, n_perm=n_perm)["auc_p"]
    return {"n": int(ok.sum()), "n_reported": int(rep.sum()), "auc": a, "lo": float(lo), "hi": float(hi), "p": p}


def quicklook(path, vv_flood, vv_dry, labels, masks, perm, valid_extent):
    from PIL import Image, ImageDraw

    step = 2
    sl = (slice(None, None, step), slice(None, None, step))
    f, d, lab = vv_flood[sl], vv_dry[sl], labels[sl]
    g_flood = (np.clip((np.nan_to_num(f, nan=-30) + 25) / 25, 0, 1) * 255).astype(np.uint8)  # -25..0 dB
    # change = after - before, -8 dB (darker, blue) to +8 dB (brighter, red)
    ch = np.nan_to_num(np.clip((f - d) / 8, -1, 1), nan=0.0)
    p2 = np.stack([np.where(ch > 0, 255, 255 * (1 + ch)), 255 * (1 - np.abs(ch)),
                   np.where(ch < 0, 255, 255 * (1 - ch))], -1).astype(np.uint8)
    p1 = np.stack([g_flood] * 3, -1)
    p3 = p1.copy()
    p3[perm[sl]] = (10, 10, 90)
    p3[masks["threshold"][sl]] = (0, 140, 255)
    nan = ~np.isfinite(f)
    p1[nan] = p2[nan] = p3[nan] = 0
    edge = np.zeros(lab.shape, bool)
    edge[:-1] |= lab[:-1] != lab[1:]
    edge[:, :-1] |= lab[:, :-1] != lab[:, 1:]
    edge &= lab > 0
    panels = []
    for p, title in ((p1, "VV after (28 Jul 2023), dB"), (p2, "Change after - before (blue darker)"),
                     (p3, "Flood mask (blue), permanent water (navy)")):
        p = p.copy()
        p[edge] = (255, 220, 0)
        im = Image.fromarray(p)
        canvas = Image.new("RGB", (im.width, im.height + 24), (255, 255, 255))
        canvas.paste(im, (0, 24))
        ImageDraw.Draw(canvas).text((6, 6), title, fill=(0, 0, 0))
        panels.append(canvas)
    w = sum(p.width for p in panels) + 8 * (len(panels) - 1)
    sheet = Image.new("RGB", (w, panels[0].height), (255, 255, 255))
    x = 0
    for p in panels:
        sheet.paste(p, (x, 0))
        x += p.width + 8
    sheet.save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--s1-dir", default=str(ROOT / "data" / "raw" / "s1"))
    ap.add_argument("--out-dir", default=str(OUT))
    ap.add_argument("--cache-dir", default=str(s1.PROCESSED))
    ap.add_argument("--speckle", type=int, default=5, help="median filter size, 1 = off")
    ap.add_argument("--margin-m", type=float, default=1000.0)
    ap.add_argument("--drop-db", type=float, default=3.0)
    ap.add_argument("--water-db", type=float, default=-18.0)
    ap.add_argument("--checkpoint", default=str(ROOT / "checkpoints" / "unet_sen1floods11.pt"))
    ap.add_argument("--rebuild", action="store_true", help="ignore cached data/processed/s1_*.tif")
    ap.add_argument("--n-boot", type=int, default=V.N_BOOT)
    ap.add_argument("--n-perm", type=int, default=V.N_PERM)
    args = ap.parse_args()

    brgy = data.barangays()
    bounds = tuple(brgy.total_bounds)
    folder = Path(args.s1_dir)
    flood_path, dry_path = find_scene(folder, FLOOD_DATE), find_scene(folder, DRY_DATE)
    flood_db, tr, crs, f_info = scene_db(flood_path, bounds, args.speckle, args.margin_m, args.rebuild, Path(args.cache_dir))
    dry_db, tr2, _, d_info = scene_db(dry_path, bounds, args.speckle, args.margin_m, args.rebuild, Path(args.cache_dir))
    if flood_db.shape != dry_db.shape or tr != tr2:
        raise SystemExit("scenes are not on the same grid; rerun with --rebuild")
    H, W = flood_db.shape[1:]
    vv_f, vv_d = flood_db[0], dry_db[0]

    gdf = brgy.to_crs(crs)
    labels = s1.rasterize_labels(gdf.geometry, tr, (H, W))
    in_city = labels > 0
    both = np.isfinite(vv_f) & np.isfinite(vv_d)
    perm = np.isfinite(vv_d) & (vv_d < args.water_db)
    land = both & ~perm  # denominator: valid on both dates and not permanent water

    masks = {"threshold": flood.threshold_extent(vv_d, vv_f, drop_db=args.drop_db, water_db=args.water_db) & land}
    otsu_t = flood.otsu_threshold(vv_f[in_city & np.isfinite(vv_f)])
    masks["otsu"] = np.isfinite(vv_f) & (vv_f < otsu_t) & land
    unet_note = None
    ckpt = Path(args.checkpoint)
    if ckpt.exists():
        try:
            masks["unet"] = flood.unet_extent(flood_db, ckpt) & land
        except ImportError:
            unet_note = "torch not installed, U-Net skipped"
    else:
        unet_note = f"no checkpoint at {ckpt}"

    pixel_km2 = abs(tr.a * tr.e) / 1e6
    table = pd.DataFrame({"adm4_pcode": brgy.adm4_pcode, "adm4_en": brgy.adm4_en})
    summary_methods = {}
    for name, m in masks.items():
        share, nv, nf = s1.zonal_share(labels, m, land, len(gdf))
        table[f"s1_{name}_share"] = share
        if name == "threshold":
            table["land_km2"] = nv * pixel_km2
            table["flooded_km2"] = nf * pixel_km2
            table["valid_share_of_barangay"] = nv / np.maximum(np.bincount(labels.ravel(), minlength=len(gdf) + 1)[1:], 1)
        tot_v, tot_f = int((land & in_city).sum()), int((m & in_city).sum())
        summary_methods[name] = {"flooded_km2": tot_f * pixel_km2, "flooded_share_of_city_land": tot_f / max(tot_v, 1)}
    summary_methods["otsu"]["threshold_db"] = otsu_t
    perm_city = int((perm & in_city & np.isfinite(vv_d)).sum())

    hz = data.flood_hazard()
    for s in ("5yr", "25yr", "100yr"):
        table[f"noah_{s}_share"] = (sum(hz[f"{s}_{lvl}"] for lvl in ("low", "med", "high")) / 100
                                    ).clip(upper=1).reindex(table.adm4_pcode).to_numpy()
    reports = pd.read_csv(REPORTS)
    egay = reports[reports.event_name == EVENT]
    reported_names = set(egay.barangay)
    unmatched = sorted(reported_names - set(table.adm4_en))
    table["egay_reported"] = table.adm4_en.isin(reported_names)

    stats = {}
    for name in masks:
        col = table[f"s1_{name}_share"].to_numpy()
        stats[name] = {"vs_noah": {s: corr(col, table[f"noah_{s}_share"].to_numpy(), args.n_boot, args.n_perm)
                                   for s in ("5yr", "25yr", "100yr")},
                       "vs_reports": {"auc": report_auc(col, table.egay_reported.to_numpy(), args.n_boot, args.n_perm),
                                      "spearman": corr(col, table.egay_reported.astype(float).to_numpy(),
                                                       args.n_boot, args.n_perm)}}

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    table.to_csv(out / "s1_egay_barangays.csv", index=False)
    out_gdf = brgy[["adm4_pcode", "adm4_en", "geometry"]].merge(table.drop(columns="adm4_en"), on="adm4_pcode")
    out_gdf.to_file(out / "s1_egay_flood.geojson", driver="GeoJSON")
    quicklook(out / "s1_egay_quicklook.png", vv_f, vv_d, labels, masks, perm & both, in_city)

    summary = {
        "flood_scene": f_info, "dry_scene": d_info,
        "grid": {"crs": crs, "res_m": tr.a, "shape": [H, W], "origin": [tr.c, tr.f]},
        "params": {"drop_db": args.drop_db, "water_db": args.water_db, "speckle_median": args.speckle},
        "city_land_pixels_valid": int((land & in_city).sum()),
        "permanent_water_share_of_city": perm_city / max(int((in_city & np.isfinite(vv_d)).sum()), 1),
        "coverage": {"barangays_with_valid_pixels": int(table.s1_threshold_share.notna().sum()),
                     "min_valid_share_of_barangay": float(table.valid_share_of_barangay.min())},
        "methods": summary_methods, "unet_note": unet_note,
        "reports": {"event": EVENT, "n_names": len(reported_names), "n_matched": int(table.egay_reported.sum()),
                    "unmatched_names": unmatched},
        "stats": stats,
        "results_files": ["s1_egay_barangays.csv", "s1_egay_flood.geojson", "s1_egay_quicklook.png"],
    }
    (out / "s1_egay_summary.json").write_text(json.dumps(clean(summary), indent=1))
    print(json.dumps(clean({"methods": summary_methods, "stats": stats, "reports": summary["reports"]}), indent=1))


if __name__ == "__main__":
    main()
