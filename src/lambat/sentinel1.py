"""Sentinel-1 GRD scenes to calibrated dB crops on a fixed UTM grid.

Steps for one scene (see docs/sentinel1.md):
1. Open the SAFE product (a .zip or an unzipped folder). Only small XML files are
   read from the archive and nothing is extracted to disk; the big measurement
   TIFFs are read through GDAL's /vsizip/ in small windows.
2. Read the sigma-nought calibration table from annotation/calibration/ and
   interpolate it bilinearly to the window: sigma0 = DN^2 / A^2.
3. The TIFF is in radar geometry with ground control points (GCPs). Fit a local
   affine map lon/lat -> (line, pixel) from the GCPs nearest the area, find the
   window, then resample onto a 10 m EPSG:32651 grid over the barangays.
4. Optional median speckle filter, then dB.

Everything except `Product.raster_uri` / `load_sigma0_db` is plain numpy and is
tested on synthetic data. Downloaded scenes are treated as untrusted data:
nothing is executed from them and no archive member is extracted.
"""

from __future__ import annotations

import fnmatch
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
from affine import Affine
from scipy import ndimage

CRS_METRIC = "EPSG:32651"
ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

def parse_calibration(xml_bytes: bytes, tag: str = "sigmaNought"):
    """Parse a calibration XML. Returns (lines, pixels, grid) with
    grid[i, j] = LUT value at line lines[i], pixel pixels[j].

    Pixel positions are taken from the first vector; later vectors are resampled
    onto them if they differ.
    """
    root = ET.fromstring(xml_bytes)
    lines, rows, pixels = [], [], None
    for vec in root.iter("calibrationVector"):
        line = int(vec.findtext("line"))
        pix = np.array(vec.findtext("pixel").split(), dtype=float)
        val = np.array(vec.findtext(tag).split(), dtype=float)
        if pix.shape != val.shape:
            raise ValueError("pixel and LUT lengths differ")
        if pixels is None:
            pixels = pix
        elif pix.shape != pixels.shape or not np.allclose(pix, pixels):
            val = np.interp(pixels, pix, val)
        lines.append(line)
        rows.append(val)
    if not lines:
        raise ValueError("no calibrationVector in XML")
    order = np.argsort(lines)
    return np.asarray(lines, float)[order], pixels, np.vstack(rows)[order]


def interp_lut(lines, pixels, grid, rows, cols) -> np.ndarray:
    """Bilinear interpolation of a LUT on a rectilinear (line, pixel) grid to the
    integer lines `rows` and pixels `cols`. Outside the grid the edge value is held.
    Returns (len(rows), len(cols)) float32."""
    rows = np.asarray(rows, float)
    cols = np.asarray(cols, float)
    # along pixels for every LUT line, then along lines for every output pixel
    along_pix = np.empty((grid.shape[0], len(cols)))
    for i in range(grid.shape[0]):
        along_pix[i] = np.interp(cols, pixels, grid[i])
    out = np.empty((len(rows), len(cols)), dtype=np.float32)
    # weights along lines are the same for every column: do it with index math
    idx = np.clip(np.searchsorted(lines, rows, side="right") - 1, 0, len(lines) - 2) if len(lines) > 1 else None
    if idx is None:
        out[:] = along_pix[0]
        return out
    l0, l1 = lines[idx], lines[idx + 1]
    t = np.clip((rows - l0) / (l1 - l0), 0.0, 1.0)[:, None]
    out[:] = along_pix[idx] * (1 - t) + along_pix[idx + 1] * t
    return out


def sigma0_linear(dn, lut) -> np.ndarray:
    """sigma0 = DN^2 / A^2 (power, linear). DN == 0 is no-data and becomes NaN."""
    dn = np.asarray(dn, dtype=np.float32)
    s = (dn * dn) / (np.asarray(lut, dtype=np.float32) ** 2)
    s[dn == 0] = np.nan
    return s


def to_db(power) -> np.ndarray:
    """10 log10; non-positive and NaN become NaN."""
    p = np.asarray(power, dtype=np.float32)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = 10.0 * np.log10(p)
    out[~np.isfinite(out)] = np.nan
    return out.astype(np.float32)


# --------------------------------------------------------------------------
# Geometry: GCPs, window, grid
# --------------------------------------------------------------------------

def _design(lon, lat, center, quadratic: bool):
    x = np.asarray(lon, float) - center[0]
    y = np.asarray(lat, float) - center[1]
    cols = [x, y, np.ones_like(x)]
    if quadratic:
        cols += [x * x, x * y, y * y]
    return np.stack(cols, axis=-1)


def fit_geo_to_pixel(gcps, lon, lat, k: int = 9):
    """Local fit from the k GCPs nearest (lon, lat): quadratic when there are at
    least 8 GCPs, affine otherwise. The GCP grid bends across a scene: on the
    Egay scene a leave-one-out check near Dagupan gave a median error of about
    1 px for a quadratic on the 9 nearest GCPs, against 13 px for an affine fit.

    gcps: (N, 4) array of [line, pixel, lon, lat] (GDAL convention: 0,0 is the
    top-left corner of the first pixel). Returns (coef, rmse_px); pass coef to
    apply_fit.
    """
    g = np.asarray(gcps, float)
    d = (g[:, 2] - lon) ** 2 + (g[:, 3] - lat) ** 2
    sel = g[np.argsort(d)[: max(k, 4)]]
    center = (float(lon), float(lat))
    quadratic = len(sel) >= 8
    A = _design(sel[:, 2], sel[:, 3], center, quadratic)
    m, *_ = np.linalg.lstsq(A, sel[:, :2], rcond=None)
    resid = A @ m - sel[:, :2]
    coef = {"center": center, "quadratic": quadratic, "m": m}
    return coef, float(np.sqrt((resid ** 2).sum(axis=1).mean()))


def apply_fit(coef, lon, lat):
    """lon/lat arrays -> (line, pixel) arrays in GCP convention."""
    out = _design(lon, lat, coef["center"], coef["quadratic"]) @ coef["m"]
    return out[..., 0], out[..., 1]


def window_from_gcps(gcps, bbox, pad: int = 100, shape=None, k: int = 9):
    """Pixel window (r0, r1, c0, c1), half-open, covering bbox (west, south, east, north)
    plus `pad` pixels. Clipped to shape = (n_lines, n_pixels) if given. Returns
    (window, rmse_px)."""
    w, s, e, n = bbox
    coef, rmse = fit_geo_to_pixel(gcps, (w + e) / 2, (s + n) / 2, k=k)
    lon = np.array([w, w, e, e, (w + e) / 2])
    lat = np.array([s, n, s, n, (s + n) / 2])
    r, c = apply_fit(coef, lon, lat)
    r0, r1 = int(np.floor(r.min())) - pad, int(np.ceil(r.max())) + pad
    c0, c1 = int(np.floor(c.min())) - pad, int(np.ceil(c.max())) + pad
    if shape is not None:
        r0, c0 = max(r0, 0), max(c0, 0)
        r1, c1 = min(r1, shape[0]), min(c1, shape[1])
    if r1 <= r0 or c1 <= c0:
        raise ValueError("bbox is outside the scene")
    return (r0, r1, c0, c1), rmse


def target_grid(bounds_wgs84, margin_m: float = 1000.0, res: float = 10.0, crs: str = CRS_METRIC):
    """Fixed north-up grid over a lon/lat bbox (west, south, east, north) plus a margin.
    Origin is snapped to a multiple of `res`. Returns (transform, (H, W), crs)."""
    from pyproj import Transformer

    w, s, e, n = bounds_wgs84
    tf = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    xs, ys = tf.transform([w, w, e, e], [s, n, s, n])
    x0 = np.floor((min(xs) - margin_m) / res) * res
    x1 = np.ceil((max(xs) + margin_m) / res) * res
    y0 = np.floor((min(ys) - margin_m) / res) * res
    y1 = np.ceil((max(ys) + margin_m) / res) * res
    W, H = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    return Affine(res, 0, x0, 0, -res, y1), (H, W), crs


def grid_lonlat(transform: Affine, shape, crs: str = CRS_METRIC):
    """lon, lat (H, W) of the pixel centres of a grid."""
    from pyproj import Transformer

    H, W = shape
    cols, rows = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    x = transform.c + transform.a * cols
    y = transform.f + transform.e * rows
    lon, lat = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform(x, y)
    return np.asarray(lon), np.asarray(lat)


def resample_to_grid(src, window_origin, coef, lon, lat) -> np.ndarray:
    """Bilinear sample of a radar-geometry window onto lon/lat points.

    src: (h, w) window whose first pixel is at (line, pixel) = window_origin.
    coef: affine from fit_geo_to_pixel (GCP convention, so 0.5 is subtracted to
    get array indices). Points outside the window are NaN.
    """
    r, c = apply_fit(coef, lon, lat)
    r = r - 0.5 - window_origin[0]
    c = c - 0.5 - window_origin[1]
    out = ndimage.map_coordinates(src, [r, c], order=1, mode="constant", cval=np.nan)
    h, w = src.shape
    out[(r < 0) | (c < 0) | (r > h - 1) | (c > w - 1)] = np.nan
    return out.astype(np.float32)


def median_filter_nan(db, size: int = 5) -> np.ndarray:
    """Median filter that keeps NaN where the input was NaN. size <= 1 is a no-op."""
    x = np.asarray(db, dtype=np.float32)
    if size <= 1:
        return x
    nan = np.isnan(x)
    filled = np.where(nan, np.nanmedian(x) if (~nan).any() else 0.0, x)
    out = ndimage.median_filter(filled, size=size, mode="nearest")
    out[nan] = np.nan
    return out.astype(np.float32)


# --------------------------------------------------------------------------
# Product access
# --------------------------------------------------------------------------

@dataclass
class Product:
    """A SAFE product as a zip file or an unzipped folder."""

    path: Path

    def __post_init__(self):
        self.path = Path(self.path)
        if self.path.is_dir():
            self._names = [p.relative_to(self.path).as_posix() for p in self.path.rglob("*") if p.is_file()]
        else:
            with zipfile.ZipFile(self.path) as z:
                self._names = [i.filename for i in z.infolist() if not i.is_dir()]

    @property
    def name(self) -> str:
        return self.path.name.removesuffix(".zip")

    @property
    def date(self) -> str:
        m = re.search(r"_(\d{8})T\d{6}_", self.path.name)
        if not m:
            raise ValueError(f"no acquisition date in {self.path.name}")
        return m.group(1)

    def find(self, pattern: str) -> str:
        hits = [n for n in self._names if fnmatch.fnmatch(n.lower(), pattern.lower())]
        if len(hits) != 1:
            raise FileNotFoundError(f"{pattern}: {len(hits)} matches in {self.path.name}")
        return hits[0]

    def measurement(self, pol: str) -> str:
        return self.find(f"*measurement/*-{pol}-*.tif*")

    def calibration(self, pol: str) -> str:
        return self.find(f"*annotation/calibration/calibration-*-{pol}-*.xml")

    def read_bytes(self, member: str, limit: int = 64 * 1024 * 1024) -> bytes:
        if self.path.is_dir():
            return (self.path / member).read_bytes()
        with zipfile.ZipFile(self.path) as z:
            if z.getinfo(member).file_size > limit:
                raise ValueError(f"{member} is unexpectedly large")
            return z.read(member)

    def raster_uri(self, member: str) -> str:
        if self.path.is_dir():
            return str(self.path / member)
        return "/vsizip/" + self.path.resolve().as_posix() + "/" + member


def _gcp_array(ds) -> np.ndarray:
    gcps, _ = ds.gcps
    return np.array([[g.row, g.col, g.x, g.y] for g in gcps], float)


def _read_pol(product: Product, pol: str, bbox, pad: int, dst_transform, dst_shape, dst_crs):
    """Calibrated linear sigma0 for one polarisation, on the target grid."""
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import Window

    lines, pixels, grid = parse_calibration(product.read_bytes(product.calibration(pol)))
    with rasterio.open(product.raster_uri(product.measurement(pol))) as ds:
        info: dict = {"shape": [ds.height, ds.width]}
        if ds.gcps[0]:
            gcps = _gcp_array(ds)
            (r0, r1, c0, c1), rmse = window_from_gcps(gcps, bbox, pad=pad, shape=(ds.height, ds.width))
            dn = ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0))
            lut = interp_lut(lines, pixels, grid, np.arange(r0, r1), np.arange(c0, c1))
            sig = sigma0_linear(dn, lut)
            lon, lat = grid_lonlat(dst_transform, dst_shape, dst_crs)
            coef, _ = fit_geo_to_pixel(gcps, (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
            out = resample_to_grid(sig, (r0, c0), coef, lon, lat)
            info.update(window=[r0, r1, c0, c1], gcp_fit_rmse_px=round(rmse, 2), geometry="gcp")
        else:
            from pyproj import Transformer
            from rasterio.windows import from_bounds

            w, s, e, n = bbox
            x, y = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True).transform([w, e, w, e], [s, s, n, n])
            win = from_bounds(min(x), min(y), max(x), max(y), ds.transform).round_offsets().round_lengths()
            win = Window(max(win.col_off - pad, 0), max(win.row_off - pad, 0),
                         win.width + 2 * pad, win.height + 2 * pad)
            win = win.intersection(Window(0, 0, ds.width, ds.height))
            dn = ds.read(1, window=win)
            r0, c0 = int(win.row_off), int(win.col_off)
            lut = interp_lut(lines, pixels, grid, np.arange(r0, r0 + dn.shape[0]), np.arange(c0, c0 + dn.shape[1]))
            sig = sigma0_linear(dn, lut)
            out = np.full(dst_shape, np.nan, dtype=np.float32)
            reproject(sig, out, src_transform=ds.window_transform(win), src_crs=ds.crs,
                      dst_transform=dst_transform, dst_crs=dst_crs, resampling=Resampling.bilinear,
                      src_nodata=np.nan, dst_nodata=np.nan)
            info.update(window=[r0, r0 + dn.shape[0], c0, c0 + dn.shape[1]], geometry="crs")
    return out, info


def load_sigma0_db(product_path, bounds_wgs84, res: float = 10.0, margin_m: float = 1000.0,
                   speckle: int = 5, pad_px: int = 100):
    """Calibrated, cropped, speckle-filtered VV and VH in dB on a fixed UTM grid.

    Returns (array (2, H, W) float32 [VV, VH], transform, crs, info dict).
    The grid depends only on bounds_wgs84, margin_m and res, so two scenes loaded
    with the same arguments are pixel-aligned.
    """
    product = Product(product_path)
    transform, shape, crs = target_grid(bounds_wgs84, margin_m=margin_m, res=res)
    w, s, e, n = bounds_wgs84
    d = margin_m / 111_000.0 * 1.5  # read a little beyond the grid so edge pixels are valid
    bbox = (w - d, s - d, e + d, n + d)
    layers, infos = [], {}
    for pol in ("vv", "vh"):
        lin, info = _read_pol(product, pol, bbox, pad_px, transform, shape, crs)
        layers.append(median_filter_nan(to_db(lin), speckle))
        infos[pol] = info
    info = {"product": product.name, "date": product.date, "speckle_median": speckle, **infos}
    return np.stack(layers).astype(np.float32), transform, crs, info


def write_geotiff(path, array, transform, crs=CRS_METRIC, descriptions=("VV_dB", "VH_dB")):
    """Write a (bands, H, W) float32 array as a compressed GeoTIFF."""
    import rasterio

    arr = np.asarray(array, dtype=np.float32)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[1], width=arr.shape[2], count=arr.shape[0],
                       dtype="float32", crs=crs, transform=transform, nodata=np.nan, compress="deflate") as dst:
        dst.write(arr)
        for i, d in enumerate(descriptions[: arr.shape[0]], start=1):
            dst.set_band_description(i, d)
    return path


def read_geotiff(path):
    """(array, transform, crs string) from a GeoTIFF written by write_geotiff."""
    import rasterio

    with rasterio.open(path) as src:
        return src.read().astype(np.float32), src.transform, src.crs.to_string()


# --------------------------------------------------------------------------
# Barangay aggregation
# --------------------------------------------------------------------------

def rasterize_labels(geoms, transform: Affine, shape) -> np.ndarray:
    """Integer label raster: pixel = index+1 of the polygon covering its centre, 0 elsewhere."""
    from rasterio.features import rasterize

    shapes = [(g, i + 1) for i, g in enumerate(geoms) if g is not None and not g.is_empty]
    return rasterize(shapes, out_shape=shape, transform=transform, fill=0, dtype="int32")


def zonal_share(labels, flooded, valid, n: int):
    """Per-polygon flooded share of valid pixels.

    labels: int raster with 0 = outside, i+1 = polygon i. flooded, valid: bool rasters.
    Returns (share, n_valid, n_flooded), each length n; share is NaN where n_valid is 0.
    """
    lab = np.asarray(labels).ravel()
    ok = np.asarray(valid, bool).ravel() & (lab > 0)
    fl = np.asarray(flooded, bool).ravel() & ok
    n_valid = np.bincount(lab[ok], minlength=n + 1)[1:n + 1]
    n_flood = np.bincount(lab[fl], minlength=n + 1)[1:n + 1]
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.where(n_valid > 0, n_flood / n_valid, np.nan)
    return share, n_valid, n_flood
