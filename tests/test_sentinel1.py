"""Sentinel-1 helpers on synthetic data: calibration, GCP window, grid, aggregation."""

import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box

from lambat import sentinel1 as s1


def _xml(vectors):
    body = "".join(
        f"<calibrationVector><line>{ln}</line><pixel count=\"{len(px)}\">{' '.join(map(str, px))}</pixel>"
        f"<sigmaNought count=\"{len(v)}\">{' '.join(map(str, v))}</sigmaNought></calibrationVector>"
        for ln, px, v in vectors
    )
    return f"<calibration><calibrationVectorList>{body}</calibrationVectorList></calibration>".encode()


def test_parse_and_interpolate_lut():
    px = [0, 10, 20]
    xml = _xml([(100, px, [100, 200, 300]), (0, px, [0, 100, 200])])  # out of order on purpose
    lines, pixels, grid = s1.parse_calibration(xml)
    assert lines.tolist() == [0, 100]
    assert grid[0].tolist() == [0, 100, 200]
    lut = s1.interp_lut(lines, pixels, grid, rows=[0, 50, 100, 150], cols=[0, 5, 20])
    # value = pixel*10 + line (a plane), so bilinear interpolation is exact
    assert lut[1, 1] == pytest.approx(50 + 50)
    assert lut[0, 2] == pytest.approx(200)
    assert lut[2, 0] == pytest.approx(100)
    assert lut[3, 0] == pytest.approx(100)  # beyond the last line: edge value held


def test_pixel_grids_that_differ_are_resampled():
    xml = _xml([(0, [0, 20], [0, 200]), (10, [0, 10, 20], [0, 100, 200])])
    _, pixels, grid = s1.parse_calibration(xml)
    assert pixels.tolist() == [0, 20]
    assert grid.tolist() == [[0, 200], [0, 200]]


def test_sigma0_and_db():
    dn = np.array([[100, 0], [10, 1000]], dtype=np.uint16)
    lut = np.full(dn.shape, 100.0, dtype=np.float32)
    sig = s1.sigma0_linear(dn, lut)
    assert sig[0, 0] == pytest.approx(1.0)
    assert np.isnan(sig[0, 1])  # DN 0 is no-data
    db = s1.to_db(sig)
    assert db[0, 0] == pytest.approx(0.0)
    assert db[1, 0] == pytest.approx(-20.0)
    assert db[1, 1] == pytest.approx(20.0)
    assert np.isnan(db[0, 1])
    assert np.isnan(s1.to_db(np.array([0.0, -1.0]))).all()


def _synthetic_gcps(rows=21, cols=10, n_lines=10000, n_pix=25000):
    """GCP grid from a rotated affine map, GDAL convention."""
    ln, px = np.meshgrid(np.linspace(0, n_lines, rows), np.linspace(0, n_pix, cols), indexing="ij")
    lon = 119.0 + px * 9.0e-5 + ln * 1.5e-5
    lat = 17.0 - ln * 8.0e-5 + px * 1.2e-5
    return np.column_stack([ln.ravel(), px.ravel(), lon.ravel(), lat.ravel()])


def test_window_from_gcps_covers_bbox_and_is_clipped():
    gcps = _synthetic_gcps()
    # bbox around a known pixel: line 5000, pixel 12000
    lon0 = 119.0 + 12000 * 9.0e-5 + 5000 * 1.5e-5
    lat0 = 17.0 - 5000 * 8.0e-5 + 12000 * 1.2e-5
    bbox = (lon0 - 0.02, lat0 - 0.02, lon0 + 0.02, lat0 + 0.02)
    (r0, r1, c0, c1), rmse = s1.window_from_gcps(gcps, bbox, pad=50, shape=(10000, 25000))
    assert rmse < 1e-6
    assert r0 < 5000 < r1 and c0 < 12000 < c1
    assert 0 <= r0 and r1 <= 10000 and 0 <= c0 and c1 <= 25000
    assert (r1 - r0) > 100 and (c1 - c0) > 100
    with pytest.raises(ValueError):
        s1.window_from_gcps(gcps, (10, 10, 10.1, 10.1), pad=0, shape=(10000, 25000))


def test_resample_recovers_a_ramp_on_the_target_grid():
    gcps = _synthetic_gcps()
    lon0 = 119.0 + 12000 * 9.0e-5 + 5000 * 1.5e-5
    lat0 = 17.0 - 5000 * 8.0e-5 + 12000 * 1.2e-5
    coef, _ = s1.fit_geo_to_pixel(gcps, lon0, lat0)
    # a "scene" whose value is its own line index (array index)
    r0, c0 = 4800, 11800
    window = np.repeat(np.arange(r0, r0 + 400, dtype=np.float32)[:, None], 400, axis=1)
    lon = np.array([lon0, lon0 + 1e-3])
    lat = np.array([lat0, lat0 - 1e-3])
    got = s1.resample_to_grid(window, (r0, c0), coef, lon, lat)
    line_gcp, _ = s1.apply_fit(coef, lon, lat)
    assert got == pytest.approx(line_gcp - 0.5, abs=1e-3)  # GCP convention minus half a pixel
    far = s1.resample_to_grid(window, (r0, c0), coef, np.array([lon0 + 1.0]), np.array([lat0]))
    assert np.isnan(far).all()


def test_target_grid_is_fixed_and_snapped():
    bounds = (120.30, 16.00, 120.40, 16.12)
    tr, shape, crs = s1.target_grid(bounds, margin_m=1000, res=10)
    assert crs == "EPSG:32651"
    assert tr.a == 10 and tr.e == -10
    assert tr.c % 10 == 0 and tr.f % 10 == 0
    # about 10.7 km x 13.3 km plus 2 km margin each way, at 10 m
    assert 1000 < shape[1] < 1500 and 1200 < shape[0] < 1700
    lon, lat = s1.grid_lonlat(tr, shape)
    assert lon.min() < bounds[0] and lon.max() > bounds[2]
    assert lat.min() < bounds[1] and lat.max() > bounds[3]


def test_median_filter_keeps_nan_and_removes_speckle():
    x = np.full((9, 9), -10.0, dtype=np.float32)
    x[4, 4] = 5.0  # speckle spike
    x[0, 0] = np.nan
    y = s1.median_filter_nan(x, 3)
    assert y[4, 4] == pytest.approx(-10.0)
    assert np.isnan(y[0, 0]) and np.isnan(y).sum() == 1
    assert s1.median_filter_nan(x, 1) is not None


def test_zonal_share_on_a_toy_grid():
    tr = Affine(1, 0, 0, 0, -1, 4)  # 4 x 8 grid, 1 m pixels
    labels = s1.rasterize_labels([box(0, 0, 4, 4), box(4, 0, 8, 4), None], tr, (4, 8))
    assert (labels[:, :4] == 1).all() and (labels[:, 4:] == 2).all()
    flooded = np.zeros((4, 8), bool)
    flooded[:, :2] = True  # half of barangay 1
    flooded[0, 4] = True   # one pixel of barangay 2 ...
    valid = np.ones((4, 8), bool)
    valid[0, 4] = False    # ... which is invalid, so it must not count
    valid[3, 5:] = False   # three more invalid pixels in barangay 2
    share, nv, nf = s1.zonal_share(labels, flooded, valid, 3)
    assert nv.tolist() == [16, 12, 0]
    assert nf.tolist() == [8, 0, 0]
    assert share[0] == pytest.approx(0.5)
    assert share[1] == 0.0
    assert np.isnan(share[2])


def test_product_finds_members_in_a_folder(tmp_path):
    safe = tmp_path / "S1A_IW_GRDH_1SDV_20230728T214651_20230728T214716_049629_05F7C6_F885_COG.SAFE"
    (safe / "measurement").mkdir(parents=True)
    (safe / "annotation" / "calibration").mkdir(parents=True)
    (safe / "measurement" / "s1a-iw-grd-vv-20230728t214651-004.tiff").write_bytes(b"x")
    (safe / "measurement" / "s1a-iw-grd-vh-20230728t214651-005.tiff").write_bytes(b"x")
    (safe / "annotation" / "calibration" / "calibration-s1a-iw-grd-vv-x-004.xml").write_bytes(_xml([(0, [0, 1], [1, 1])]))
    (safe / "annotation" / "calibration" / "noise-s1a-iw-grd-vv-x-004.xml").write_bytes(b"<noise/>")
    p = s1.Product(safe)
    assert p.date == "20230728"
    assert p.measurement("vv").endswith("-vv-20230728t214651-004.tiff")
    assert p.measurement("vh").endswith("-vh-20230728t214651-005.tiff")
    assert "calibration-s1a" in p.calibration("vv")
    lines, pixels, grid = s1.parse_calibration(p.read_bytes(p.calibration("vv")))
    assert grid.shape == (1, 2)
