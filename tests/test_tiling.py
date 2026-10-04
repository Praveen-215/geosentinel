"""
Acceptance tests for tiling.py. Black-box: they call run_tiling() and inspect the SQLite output,
so they work against any version of tiling.py and say which criterion fails.

From backend/:
    python tests/test_tiling_acceptance.py        # checklist report (PASS/FAIL per criterion)
    python -m pytest tests/test_tiling_acceptance.py -v

Criteria (C01..C12)
  C01 only tiles fully inside a scene's coverage get observations; validation accepts that
  C02 grid origin and every tile edge sit on the 20 m lattice
  C03 tile windows must land on exact pixel boundaries; a shifted band is never rounded away
  C04 per-tile SCL quality: cloud/shadow/snow/clear/nodata/other, summing to 100
  C05 incremental: a re-run changes nothing; a new scene adds only its rows; AOIs do not collide
  C06 the grid is immutable once registered
  C07 read_tile(): shapes, margin, 20 -> 10 m, reflectance, padding
  C08 MGRS comes from the registry (no hard-coded default)
  C09 no machine-specific absolute paths persisted
  C10 no hand-written projection fallback
  C11 a failed observation never crashes the run AND is caught by validation
  C12 real registry (optional): set GEOSENTINEL_REGISTRY, GEOSENTINEL_IMAGERY_ROOT, GEOSENTINEL_AOI
"""
import inspect
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds, transform_geom

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from src import tiling  # noqa: E402

CRS = "EPSG:32643"
X0, Y0 = 380000.0, 2050000.0          # raster top-left; multiples of 20 m
MGRS = "43QCA"
BANDS = {"B02": 10, "B03": 10, "B04": 10, "B08": 10,
         "B05": 20, "B06": 20, "B07": 20, "B11": 20, "B12": 20, "SCL": 20}
QUALITY_COLS = ("cloud_pct", "shadow_pct", "snow_pct", "clear_pct", "nodata_pct", "other_pct")

# Real ingest.py scenes schema (so tiling is tested against the real ingest output shape)
SCENES_DDL = """
CREATE TABLE scenes (
    product_id TEXT PRIMARY KEY, satellite TEXT, sensor TEXT, acquisition_date TEXT,
    processing_level TEXT, processing_baseline TEXT, mgrs_tile TEXT, relative_orbit INTEGER,
    crs TEXT, bbox_json TEXT, bands_json TEXT, band_resolution_m_json TEXT,
    cloud_percent REAL, shadow_percent REAL, valid_percent REAL, status TEXT NOT NULL,
    rejection_reason TEXT, warnings_json TEXT, ingested_at TEXT NOT NULL, metadata_json TEXT NOT NULL
);
"""


# ---------------------------------------------------------------------------
# Synthetic world
# ---------------------------------------------------------------------------
def write_aoi(path: Path, rect=(X0 + 100, Y0 - 5900, X0 + 5900, Y0 - 100)):
    x0, y0, x1, y1 = rect  # UTM rectangle written as lon/lat (round-trips exactly)
    ring = [[x0, y1], [x1, y1], [x1, y0], [x0, y0], [x0, y1]]
    geom = transform_geom(CRS, "EPSG:4326", {"type": "Polygon", "coordinates": [ring]})
    path.write_text(json.dumps({"type": "Feature", "properties": {}, "geometry": geom}))


def inside(b, outer, tol=1e-6) -> bool:
    return (b[0] >= outer[0] - tol and b[1] >= outer[1] - tol
            and b[2] <= outer[2] + tol and b[3] <= outer[3] + tol)


@dataclass
class Run:
    summary: Any = None
    error: Optional[Exception] = None

    def require(self):
        if self.error is not None:
            pytest.fail(f"TILING CRASHED: run_tiling raised {type(self.error).__name__}: {self.error}",
                        pytrace=False)
        return self.summary


class Ctx:
    def __init__(self, tmp: Path):
        self.tmp, self.root, self.db = tmp, tmp / "raw", tmp / "reg.db"
        self.root.mkdir()
        self.aoi, self.aoi_id = tmp / "aoi.geojson", "PUN_01"
        write_aoi(self.aoi)
        self.bounds: dict[str, tuple] = {}
        c = self.conn()
        c.executescript(SCENES_DDL)
        c.commit()
        c.close()

    def conn(self):
        return sqlite3.connect(self.db)

    def add(self, pid, date, size=6000, shift=None, scl=None, baseline="05.10"):
        shift = shift or {}
        d = self.root / pid
        d.mkdir(parents=True)
        assets = {}
        for band, res in BANDS.items():
            n = size // res
            if band == "SCL":
                arr = np.full((n, n), 4, dtype="uint8")
                if scl:
                    scl(arr)
            else:
                arr = np.full((n, n), 1500, dtype="uint16")
            with rasterio.open(d / f"{band}.tif", "w", driver="GTiff", height=n, width=n, count=1,
                               dtype=arr.dtype, crs=CRS,
                               transform=from_origin(X0 + shift.get(band, 0.0), Y0, res, res)) as dst:
                dst.write(arr, 1)
            assets[band] = {"path": f"{pid}/{band}.tif"}
        self.bounds[pid] = (X0, Y0 - size, X0 + size, Y0)
        lon0, lat0, lon1, lat1 = transform_bounds(CRS, "EPSG:4326", *self.bounds[pid])
        c = self.conn()
        c.execute(
            """INSERT INTO scenes (product_id, satellite, sensor, acquisition_date, processing_level,
               processing_baseline, mgrs_tile, relative_orbit, crs, bbox_json, bands_json,
               band_resolution_m_json, cloud_percent, shadow_percent, valid_percent, status,
               rejection_reason, warnings_json, ingested_at, metadata_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, "Sentinel-2A", "MSI", date, "L2A / Analysis Ready", baseline, MGRS, 105, CRS,
             json.dumps({"min_lon": lon0, "min_lat": lat0, "max_lon": lon1, "max_lat": lat1}),
             json.dumps(list(BANDS)), json.dumps(BANDS), 0.0, 0.0, 100.0, "accepted", None, "[]",
             "2024-01-01T00:00:00Z", json.dumps({"assets": assets, "coverage_footprint_bounds": list(self.bounds[pid]), "coverage_crs": CRS})))
        c.commit()
        c.close()

    def run(self, aoi=None, aoi_id=None, **kw) -> Run:
        try:
            return Run(summary=tiling.run_tiling(registry_path=self.db, aoi_path=aoi or self.aoi,
                                                 imagery_root=self.root, aoi_id=aoi_id or self.aoi_id, **kw))
        except Exception as exc:  # noqa: BLE001
            return Run(error=exc)

    def tiles(self, aoi_id=None) -> dict[str, list[float]]:
        c = self.conn()
        try:
            return {r[0]: json.loads(r[1]) for r in c.execute(
                "SELECT tile_id, native_bounds_json FROM tiles WHERE aoi_id = ?", (aoi_id or self.aoi_id,))}
        finally:
            c.close()

    def rows(self) -> list[dict]:
        c = self.conn()
        c.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in c.execute("SELECT * FROM tile_observations ORDER BY tile_id, scene_id")]
        finally:
            c.close()

    def observed(self, scene) -> set:
        return {r["tile_id"] for r in self.rows() if r["scene_id"] == scene}

    # NEW (Replace the old covered method with this)
    def covered(self, scene) -> set:
        c = self.conn()
        try:
            row = c.execute(
                "SELECT metadata_json FROM scenes WHERE product_id = ?",
                (scene,),
            ).fetchone()
            assert row is not None

            metadata = json.loads(row[0])
            footprint = tuple(metadata["coverage_footprint_bounds"])

            return {
                tile_id
                for tile_id, bounds in self.tiles().items()
                if inside(bounds, footprint)
            }
        finally:
            c.close()


@pytest.fixture
def ctx(tmp_path):
    return Ctx(tmp_path)


def need(name):
    fn = getattr(tiling, name, None)
    if fn is None:
        pytest.fail(f"{name}() does not exist in tiling.py", pytrace=False)
    return fn


def validation_problems(c: Ctx) -> list:
    conn = c.conn()
    try:
        if hasattr(tiling, "validate_registry"):
            return list(tiling.validate_registry(conn, c.aoi_id))
        if hasattr(tiling, "validate_phase1"):
            ok = tiling.validate_phase1(conn=conn, aoi_path=c.aoi, aoi_id=c.aoi_id, aoi_crs="EPSG:4326",
                                        processing_crs=CRS, tile_size_m=2560, mgrs_tile=MGRS)
            return [] if ok else ["validate_phase1 reported failures"]
        pytest.fail("no validation function (validate_registry / validate_phase1)", pytrace=False)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# C01 coverage / edge tiles
# ---------------------------------------------------------------------------
def test_c01a_only_fully_covered_tiles_get_observations(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    expected, tiles = ctx.covered("A"), ctx.tiles()
    assert 0 < len(expected) < len(tiles), "fixture needs both covered and overhanging tiles"
    got = ctx.observed("A")
    assert got == expected, (f"observations must exist only for tiles fully inside the scene. "
                             f"missing={sorted(expected - got)} unexpected={sorted(got - expected)}")


def test_c01b_validation_accepts_partial_coverage(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    problems = validation_problems(ctx)
    assert problems == [], f"validation rejects a healthy run where some tiles lie outside coverage: {problems}"


# ---------------------------------------------------------------------------
# C02 grid origin on the 20 m lattice
# ---------------------------------------------------------------------------
def test_c02_origin_and_edges_on_20m_lattice(ctx):
    rect = (X0 + 137, Y0 - 5863, X0 + 5863, Y0 - 137)          # AOI bounds are NOT 20 m multiples
    assert (rect[0] % 20) != 0
    aoi2 = ctx.tmp / "aoi_awkward.geojson"
    write_aoi(aoi2, rect)
    ctx.add("A", "2024-01-01")
    ctx.run(aoi=aoi2).require()
    tiles = ctx.tiles()
    assert tiles, "no tiles produced"
    off = [(t, b) for t, b in tiles.items() if any(abs(v / 20 - round(v / 20)) > 1e-6 for v in b)]
    assert not off, f"tile edges off the 20 m lattice, e.g. {off[:2]}"
    origin = (min(b[0] for b in tiles.values()), max(b[3] for b in tiles.values()))
    assert all(abs(v / 20 - round(v / 20)) < 1e-6 for v in origin), f"grid origin {origin} not on 20 m lattice"


# ---------------------------------------------------------------------------
# C03 exact window alignment
# ---------------------------------------------------------------------------
def test_c03a_aligned_scene_gets_full_covered_set(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    assert ctx.observed("A") == ctx.covered("A") != set()


def test_c03b_shifted_band_is_not_rounded_away(ctx):
    ctx.add("GOOD", "2024-01-01")
    ctx.add("SHIFT", "2024-01-11", shift={"B05": 5.0})          # one band off by 5 m
    ctx.run().require()
    assert ctx.observed("GOOD") == ctx.covered("GOOD") != set(), "aligned scene must still be tiled"
    assert ctx.observed("SHIFT") == set(), "scene with a half-pixel-shifted band was tiled (rounding rescue)"


# ---------------------------------------------------------------------------
# C04 per-tile quality
# ---------------------------------------------------------------------------
STRIPES = [8, 8, 9, 10, 3, 11, 0, 4, 4, 4, 5, 5, 6, 1, 2, 7]    # 16 stripes x 8 rows = tile r000_c000


def engineered_scl(arr):
    for i, cls in enumerate(STRIPES):
        arr[5 + 8 * i: 5 + 8 * (i + 1), 5:133] = cls


def test_c04a_quality_columns_exist(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    c = ctx.conn()
    cols = {r[1] for r in c.execute("PRAGMA table_info(tile_observations)")}
    c.close()
    assert not (set(QUALITY_COLS) - cols), f"tile_observations lacks columns: {sorted(set(QUALITY_COLS) - cols)}"


def test_c04b_quality_percentages_are_exact_and_sum_to_100(ctx):
    ctx.add("A", "2024-01-01", scl=engineered_scl)
    ctx.run().require()
    row = next((r for r in ctx.rows() if r["tile_id"] == f"{MGRS}_r000_c000"), None)
    assert row is not None, "no observation for tile r000_c000"
    missing = [k for k in QUALITY_COLS if k not in row]
    assert not missing, f"missing quality columns {missing}"
    want = {"cloud_pct": 25.0, "shadow_pct": 6.25, "snow_pct": 6.25,
            "clear_pct": 37.5, "nodata_pct": 6.25, "other_pct": 18.75}
    for k, v in want.items():
        assert row[k] == pytest.approx(v, abs=1e-6), f"{k}: got {row[k]}, want {v}"
    assert sum(row[k] for k in QUALITY_COLS) == pytest.approx(100.0, abs=1e-6)


# ---------------------------------------------------------------------------
# C05 incremental behaviour
# ---------------------------------------------------------------------------
def test_c05a_rerun_changes_nothing_and_new_scene_adds_only_its_rows(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    before = ctx.rows()
    time.sleep(1.1)                                              # timestamps have 1 s resolution
    ctx.run().require()
    assert ctx.rows() == before, "re-run rewrote existing observation rows"
    ctx.add("B", "2024-01-11")
    ctx.run().require()
    after = ctx.rows()
    assert [r for r in after if r["scene_id"] == "A"] == before, "scene A rows changed when B was added"
    assert ctx.observed("B") == ctx.covered("B") != set()


def test_c05b_two_aois_do_not_share_or_overwrite_tiles(ctx):
    ctx.add("A", "2024-01-01", size=8000)
    ctx.run(aoi_id="A1").require()
    first = ctx.tiles("A1")
    aoi2 = ctx.tmp / "aoi2.geojson"
    write_aoi(aoi2, (X0 + 1000, Y0 - 5000, X0 + 5000, Y0 - 1000))
    ctx.run(aoi=aoi2, aoi_id="A2").require()
    assert ctx.tiles("A1") == first, "tiling AOI 2 modified AOI 1's tiles (tile_id is not AOI-unique)"
    second = ctx.tiles("A2")
    assert second, "AOI 2 got no tiles of its own"
    assert min(b[0] for b in second.values()) == X0 + 1000, "AOI 2 tiles have the wrong geometry"


# ---------------------------------------------------------------------------
# C06 grid immutability
# ---------------------------------------------------------------------------
def test_c06_grid_is_immutable(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    before = ctx.tiles()
    ctx.run().require()                                          # same parameters: fine
    moved = ctx.tmp / "aoi_moved.geojson"
    write_aoi(moved, (X0 + 600, Y0 - 5900, X0 + 5900, Y0 - 100))
    for label, aoi, kw in (("tile size", None, {"tile_size_m": 1280}), ("origin", moved, {})):
        r = ctx.run(aoi=aoi, **kw)
        assert r.error is not None and re.search(r"grid|differ|immutable|registered", str(r.error), re.I), \
            f"{label} change was not refused with a grid error (error={r.error!r})"
        assert ctx.tiles() == before, f"{label} change modified existing tiles"


# ---------------------------------------------------------------------------
# C07 read_tile
# ---------------------------------------------------------------------------
def test_c07a_read_tile_shapes_margin_resample_reflectance(ctx):
    rt = need("read_tile")
    ctx.add("A", "2024-01-01", baseline="05.10")
    ctx.add("OLD", "2024-01-11", baseline="03.01")
    ctx.run().require()
    conn, tid = ctx.conn(), f"{MGRS}_r000_c000"
    px = rt(conn, ctx.root, tid, "A", bands=("B04", "B05", "SCL"))
    assert px["B04"].shape == (256, 256) and px["B05"].shape == (128, 128) and px["SCL"].shape == (128, 128)
    m = rt(conn, ctx.root, tid, "A", bands=("B04", "B05"), margin_m=40)
    assert m["B04"].shape == (264, 264) and m["B05"].shape == (132, 132)
    assert rt(conn, ctx.root, tid, "A", bands=("B05",), to_10m=True)["B05"].shape == (256, 256)
    assert np.allclose(rt(conn, ctx.root, tid, "A", bands=("B04",), reflectance=True)["B04"], 0.05)
    assert np.allclose(rt(conn, ctx.root, tid, "OLD", bands=("B04",), reflectance=True)["B04"], 0.15)


def test_c07b_read_tile_pads_outside_the_raster_only_when_asked(ctx):
    rt = need("read_tile")
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    conn, tid = ctx.conn(), f"{MGRS}_r000_c000"
    raw = rt(conn, ctx.root, tid, "A", bands=("B04",), margin_m=200)["B04"]   # reaches 100 m past the raster
    assert raw.shape == (296, 296) and (raw == 0).any() and (raw == 1500).any()
    refl = rt(conn, ctx.root, tid, "A", bands=("B04",), margin_m=200, reflectance=True)["B04"]
    assert np.isnan(refl).any() and not np.isnan(refl).all()


# ---------------------------------------------------------------------------
# C08 / C09 / C10 hygiene
# ---------------------------------------------------------------------------
def test_c08_mgrs_comes_from_registry(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()                                          # no mgrs_tile argument given
    ids = list(ctx.tiles())
    assert ids and all(t.startswith(f"{MGRS}_") for t in ids), f"tile ids ignore the registry MGRS {MGRS}: {ids[:3]}"


def test_c09_no_absolute_paths_persisted(ctx):
    ctx.add("A", "2024-01-01")
    ctx.run().require()
    c = ctx.conn()
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for table in ("grid", "tiles", "tile_observations"):
        if table in names:
            dump = json.dumps(c.execute(f"SELECT * FROM {table}").fetchall(), default=str)
            assert str(ctx.tmp) not in dump, f"{table} stores a machine-specific absolute path"
    c.close()


def test_c10_no_hand_written_projection_fallback():
    src = inspect.getsource(tiling)
    assert not any(hasattr(tiling, n) for n in ("_wgs84_to_utm43n", "_utm43n_to_wgs84", "HAS_GEOSPATIAL")), \
        "hand-written projection fallback is still present"
    assert "Snyder" not in src


# ---------------------------------------------------------------------------
# C11 skipping must not hide failure
# ---------------------------------------------------------------------------
def inject_failure(monkeypatch, scene_id="B", tile_id=f"{MGRS}_r001_c001"):
    if hasattr(tiling, "build_window_recipe"):                   # per-tile pipeline
        orig = tiling.build_window_recipe

        def boom_tile(tile, *a, **k):
            if tile.tile_id == tile_id:
                raise ValueError("injected tile failure")
            return orig(tile, *a, **k)
        monkeypatch.setattr(tiling, "build_window_recipe", boom_tile)
    elif hasattr(tiling, "observe_scene"):                       # per-scene pipeline
        orig = tiling.observe_scene

        def boom_scene(scene, *a, **k):
            if scene["product_id"] == scene_id:
                raise ValueError("injected scene failure")
            return orig(scene, *a, **k)
        monkeypatch.setattr(tiling, "observe_scene", boom_scene)
    else:
        pytest.fail("cannot inject a failure: no build_window_recipe / observe_scene", pytrace=False)


def test_c11_failed_observation_does_not_crash_but_is_caught_by_validation(ctx, monkeypatch):
    ctx.add("A", "2024-01-01", size=8000)                        # size 8000 covers every tile
    ctx.run().require()
    assert validation_problems(ctx) == [], "baseline run should validate cleanly"
    ctx.add("B", "2024-01-11", size=8000)
    inject_failure(monkeypatch)
    summary = ctx.run().require()                                # must not crash
    assert ctx.observed("B") != set(ctx.tiles()), "failure injection had no effect"
    assert validation_problems(ctx), "validation reports SUCCESS although an observation is missing"
    if isinstance(summary, dict) and "failed_scenes" in summary:
        assert summary["failed_scenes"], "summary hides the failure"


# ---------------------------------------------------------------------------
# C12 real registry (optional)
# ---------------------------------------------------------------------------
def _real():
    vals = [os.environ.get(k) for k in ("GEOSENTINEL_REGISTRY", "GEOSENTINEL_IMAGERY_ROOT", "GEOSENTINEL_AOI")]
    return dict(zip(("registry", "root", "aoi"), vals)) if all(vals) else None


real_only = pytest.mark.skipif(_real() is None, reason="set GEOSENTINEL_REGISTRY / _IMAGERY_ROOT / _AOI")


def _preflight(real):
    conn = sqlite3.connect(f"file:{real['registry']}?mode=ro", uri=True)
    rows = conn.execute("SELECT product_id, mgrs_tile, crs, metadata_json FROM scenes "
                        "WHERE status = 'accepted'").fetchall()
    conn.close()
    problems = []
    if not rows:
        problems.append("registry has no accepted scenes")
    if len({r[1] for r in rows}) > 1:
        problems.append(f"several MGRS tiles: {sorted({r[1] for r in rows})}")
    if len({r[2] for r in rows}) > 1:
        problems.append(f"several CRS values: {sorted({r[2] for r in rows})}")
    for pid, _, _, meta in rows:
        try:
            assets = json.loads(meta).get("assets", {})
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{pid}: metadata_json does not parse ({exc})")
            continue
        for band in BANDS:
            rel = assets.get(band, {}).get("path")
            if not rel:
                problems.append(f"{pid}: no asset entry for {band}")
            elif not (Path(real["root"]) / rel).is_file():
                problems.append(f"{pid}: file missing for {band}: {rel}")
    return problems, rows


@real_only
def test_c12a_real_inputs_preflight():
    problems, rows = _preflight(_real())
    assert not problems, "INPUT PROBLEMS (not a tiling bug):\n  " + "\n  ".join(problems[:20])


@real_only
def test_c12b_real_registry_end_to_end(tmp_path):
    real = _real()
    problems, rows = _preflight(real)
    if problems:
        pytest.skip("input problems, see C12A")
    db = tmp_path / "copy.db"
    shutil.copy(real["registry"], db)                            # the backup itself is never modified
    try:
        tiling.run_tiling(registry_path=db, aoi_path=real["aoi"], imagery_root=real["root"],
                          aoi_id=os.environ.get("GEOSENTINEL_AOI_ID", "real_aoi"))
    except Exception as exc:  # noqa: BLE001
        pytest.fail(f"TILING CRASHED on the real registry: {type(exc).__name__}: {exc}", pytrace=False)
    conn = sqlite3.connect(db)
    mgrs = rows[0][1]
    tiles = {r[0]: json.loads(r[1]) for r in conn.execute("SELECT tile_id, native_bounds_json FROM tiles")}
    assert tiles and all(t.startswith(f"{mgrs}_") for t in tiles), f"tile ids do not use registry MGRS {mgrs}"
    obs = {}
    for tid, sid in conn.execute("SELECT tile_id, scene_id FROM tile_observations"):
        obs.setdefault(sid, set()).add(tid)
    for pid, _, _, meta in rows:
        rel = json.loads(meta)["assets"]["B02"]["path"]
        with rasterio.open(Path(real["root"]) / rel) as src:
            bounds = tuple(src.bounds)
        expected = {t for t, b in tiles.items() if inside(b, bounds)}
        assert obs.get(pid, set()) == expected, f"{pid}: observed tile set differs from fully-covered set"
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tile_observations)")}
    if set(QUALITY_COLS) <= cols:
        total = conn.execute("SELECT MIN(" + "+".join(QUALITY_COLS) + "), MAX(" + "+".join(QUALITY_COLS) +
                             ") FROM tile_observations").fetchone()
        assert total[0] == pytest.approx(100.0, abs=1e-3) and total[1] == pytest.approx(100.0, abs=1e-3)
    conn.close()


# ---------------------------------------------------------------------------
# Checklist runner:  python tests/test_tiling_acceptance.py
# ---------------------------------------------------------------------------
class _Report:
    def __init__(self):
        self.results: dict[str, str] = {}

    def pytest_runtest_logreport(self, report):
        if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
            self.results[report.nodeid.split("::")[-1]] = report.outcome

    def pytest_sessionfinish(self, session):
        label = {"passed": "PASS", "failed": "FAIL", "skipped": "SKIP"}
        print("\n" + "=" * 64 + "\nTILING ACCEPTANCE CHECKLIST\n" + "=" * 64)
        for name, outcome in self.results.items():
            code = name.split("_")[1].upper()
            print(f"  {label.get(outcome, outcome):5} {code:5} {' '.join(name.split('_')[2:])}")
        bad = sum(1 for o in self.results.values() if o == "failed")
        print("=" * 64 + f"\nFINAL: {'PASS' if not bad else f'FAIL ({bad} failing)'}\n" + "=" * 64)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q", "--tb=short", "-p", "no:cacheprovider"], plugins=[_Report()]))