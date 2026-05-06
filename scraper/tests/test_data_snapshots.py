"""
Snapshot tests for parsed data integrity — exhaustive coverage.

Every program in data/programs_structured.json and every course in
data/courses.json has its parsed AST (and key metadata) frozen as a snapshot
file in scraper/tests/snapshots/. If a parser change unintentionally drops or
re-arranges anything for any program or course, the affected snapshot fails
in CI before the change can be merged.

Layout:
    scraper/tests/snapshots/programs/<CODE>.json
    scraper/tests/snapshots/courses/<CODE>.json

Updating snapshots
==================
When you intentionally improve the parser:
    UPDATE_SNAPSHOTS=1 python -m pytest scraper/tests/test_data_snapshots.py
This regenerates the JSON files. Always review `git diff` before committing —
that diff is exactly what users will experience as a behavior change.
"""

import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
COURSES_PATH = ROOT / "data" / "courses.json"
PROGRAMS_PATH = ROOT / "data" / "programs_structured.json"
SNAPSHOT_DIR = Path(__file__).parent / "snapshots"
PROGRAM_DIR = SNAPSHOT_DIR / "programs"
COURSE_DIR = SNAPSHOT_DIR / "courses"
PROGRAM_DIR.mkdir(parents=True, exist_ok=True)
COURSE_DIR.mkdir(parents=True, exist_ok=True)


def _load_courses() -> list[dict]:
    raw = json.loads(COURSES_PATH.read_text())
    return raw if isinstance(raw, list) else raw.get("courses", [])


def _load_programs() -> list[dict]:
    raw = json.loads(PROGRAMS_PATH.read_text())
    return raw if isinstance(raw, list) else raw.get("programs", [])


# Discover all codes at module load — pytest parametrize evaluates at collection.
_ALL_PROGRAM_CODES = sorted([p["code"] for p in _load_programs() if p.get("code")])
_ALL_COURSE_CODES = sorted([c["code"] for c in _load_courses() if c.get("code")])


def _course_snapshot_payload(course: dict) -> dict:
    """Subset of a course used for snapshotting — fields users care about."""
    return {
        "code": course.get("code"),
        "title": course.get("title"),
        "credits": course.get("credits"),
        "prerequisites_raw": course.get("prerequisites_raw"),
        "prerequisites": course.get("prerequisites"),
        "exclusions_raw": course.get("exclusions_raw"),
        "corequisites_raw": course.get("corequisites_raw"),
    }


def _program_snapshot_payload(prog: dict) -> dict:
    """Subset of a program used for snapshotting."""
    return {
        "code": prog.get("code"),
        "name": prog.get("name"),
        "type": prog.get("type"),
        "completion": prog.get("completion"),
    }


def _check_or_write_snapshot(snap_path: Path, payload: dict, label: str) -> None:
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        snap_path.write_text(json.dumps(payload, indent=2, sort_keys=False))
        return

    if not snap_path.exists():
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        snap_path.write_text(json.dumps(payload, indent=2, sort_keys=False))
        pytest.skip(f"Snapshot {label} created on first run; commit and re-test.")
        return

    expected = json.loads(snap_path.read_text())
    if payload != expected:
        diff_keys = []
        for k in sorted(set(list(payload.keys()) + list(expected.keys()))):
            if payload.get(k) != expected.get(k):
                diff_keys.append(k)
        msg = (
            f"Snapshot {label} drift detected (changed fields: {diff_keys}). "
            f"If intentional, regenerate with: "
            f"UPDATE_SNAPSHOTS=1 python -m pytest scraper/tests/test_data_snapshots.py"
        )
        for k in diff_keys[:1]:
            exp_str = json.dumps(expected.get(k))[:300]
            act_str = json.dumps(payload.get(k))[:300]
            msg += f"\n  expected[{k}] = {exp_str}"
            msg += f"\n  actual[{k}]   = {act_str}"
        raise AssertionError(msg)


# ── Programs (all of them) ───────────────────────────────────────────────────


_PROGS_BY_CODE = {p["code"]: p for p in _load_programs() if p.get("code")}


@pytest.mark.parametrize("code", _ALL_PROGRAM_CODES)
def test_program_snapshot(code):
    prog = _PROGS_BY_CODE.get(code)
    assert prog is not None, f"Program {code} disappeared from data/programs_structured.json"
    payload = _program_snapshot_payload(prog)
    _check_or_write_snapshot(PROGRAM_DIR / f"{code}.json", payload, f"program {code}")


# ── Courses (all of them) ────────────────────────────────────────────────────


_COURSES_BY_CODE = {c["code"]: c for c in _load_courses() if c.get("code")}


@pytest.mark.parametrize("code", _ALL_COURSE_CODES)
def test_course_snapshot(code):
    course = _COURSES_BY_CODE.get(code)
    assert course is not None, f"Course {code} disappeared from data/courses.json"
    payload = _course_snapshot_payload(course)
    _check_or_write_snapshot(COURSE_DIR / f"{code}.json", payload, f"course {code}")


# ── Catalog completeness — guard against silent course/program loss ─────────


def test_program_count_unchanged():
    """If any programs are silently dropped during regeneration, fail."""
    snap_count_path = SNAPSHOT_DIR / "_program_count.txt"
    actual = len(_ALL_PROGRAM_CODES)
    if os.environ.get("UPDATE_SNAPSHOTS") == "1" or not snap_count_path.exists():
        snap_count_path.write_text(str(actual))
        return
    expected = int(snap_count_path.read_text().strip())
    assert actual >= expected, (
        f"Program count dropped: was {expected}, now {actual}. "
        f"If intentional, regenerate: UPDATE_SNAPSHOTS=1 python -m pytest "
        f"scraper/tests/test_data_snapshots.py::test_program_count_unchanged"
    )


def test_course_count_unchanged():
    """If any courses are silently dropped during regeneration, fail."""
    snap_count_path = SNAPSHOT_DIR / "_course_count.txt"
    actual = len(_ALL_COURSE_CODES)
    if os.environ.get("UPDATE_SNAPSHOTS") == "1" or not snap_count_path.exists():
        snap_count_path.write_text(str(actual))
        return
    expected = int(snap_count_path.read_text().strip())
    assert actual >= expected, (
        f"Course count dropped: was {expected}, now {actual}. "
        f"If intentional, regenerate: UPDATE_SNAPSHOTS=1 python -m pytest "
        f"scraper/tests/test_data_snapshots.py::test_course_count_unchanged"
    )
