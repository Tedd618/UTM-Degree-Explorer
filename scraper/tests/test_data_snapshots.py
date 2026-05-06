"""
Snapshot tests for parsed data integrity.

Locks in the current AST shape for top programs and a representative slice of
courses with complex prerequisites. If a parser change unintentionally drops or
re-arranges nodes, the affected snapshot fails — surfacing the regression in
CI before users see it.

Updating snapshots
==================
When you intentionally improve the parser:
    UPDATE_SNAPSHOTS=1 python -m pytest scraper/tests/test_data_snapshots.py
This regenerates the JSON files in scraper/tests/snapshots/. Review the diff
in `git diff` before committing.
"""

import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
COURSES_PATH = ROOT / "data" / "courses.json"
PROGRAMS_PATH = ROOT / "data" / "programs_structured.json"
SNAPSHOT_DIR = Path(__file__).parent / "snapshots"
SNAPSHOT_DIR.mkdir(exist_ok=True)


# ── Programs to snapshot ─────────────────────────────────────────────────────
# The 25 programs students most commonly look up at UTM.
SNAPSHOT_PROGRAM_CODES = [
    # Computer Science
    "ERMAJ1688", "ERSPE1688", "ERMIN1688",
    # Mathematical / Stats
    "ERMAJ1540", "ERSPE1540", "ERMAJ2511", "ERSPE2511", "ERMAJ2512",
    # Psychology
    "ERMAJ1160", "ERSPE1160", "ERMIN1160",
    # Bio / Health
    "ERMAJ2364", "ERSPE2364", "ERMAJ1149",
    # Commerce / Econ / Finance
    "ERSPE2380", "ERMAJ1478", "ERSPE1478", "ERSPE2722",
    # Crim / Soc
    "ERMAJ0727", "ERSPE0727",
    # English / History
    "ERMAJ1645", "ERSPE1645",
    # Phys / Chem
    "ERMAJ1944", "ERSPE1944", "ERMAJ1376",
]

# ── Courses to snapshot ──────────────────────────────────────────────────────
# Representative slice covering: core 100-level requirements students hit
# first, complex multi-clause Higher-Year prereqs, level-pool courses, and
# previously-buggy edge cases.
SNAPSHOT_COURSE_CODES = [
    # Common entry-point prereqs
    "MAT102H5", "MAT135H5", "MAT136H5", "MAT137H5", "CSC108H5", "CSC148H5",
    "BIO152H5", "BIO153H5", "CHM110H5", "CHM120H5", "PHY146H5", "PHY147H5",
    "ECO101H5", "ECO102H5", "PSY100Y5", "STA256H5", "STA258H5",
    # Higher-year courses with complex prereqs
    "STA302H5", "STA304H5", "STA305H5", "CSC207H5", "CSC236H5", "CSC263H5",
    "CSC373H5", "CSC384H5", "MAT223H5", "MAT232H5", "MAT233H5", "MAT240H5",
    # Previously-buggy edge cases (mismatched brackets etc.)
    "AST221H5", "JCP221H5", "CHM211H5", "CHM231H5", "CHM242H5",
    # Complex cluster prereqs
    "PSY415H5", "PSY410H5", "PSY420H5", "PSY471H5", "PSY490H5", "PSY495H5",
    # Forensic / Bio
    "FSC407H5", "FSC483H5",
    # Linguistics ('formerly X' annotations)
    "LIN411H5", "LIN460H5", "LIN476H5",
]


def _load_courses_by_code() -> dict:
    courses = json.loads(COURSES_PATH.read_text())
    courses_list = courses if isinstance(courses, list) else courses.get("courses", [])
    return {c["code"]: c for c in courses_list if c.get("code")}


def _load_programs_by_code() -> dict:
    progs = json.loads(PROGRAMS_PATH.read_text())
    plist = progs if isinstance(progs, list) else progs.get("programs", [])
    return {p["code"]: p for p in plist if p.get("code")}


def _course_snapshot_payload(course: dict) -> dict:
    """Subset of a course used for snapshotting — only the fields we care about."""
    return {
        "code": course.get("code"),
        "title": course.get("title"),
        "credits": course.get("credits"),
        "prerequisites_raw": course.get("prerequisites_raw"),
        "prerequisites": course.get("prerequisites"),
    }


def _program_snapshot_payload(prog: dict) -> dict:
    """Subset of a program used for snapshotting."""
    return {
        "code": prog.get("code"),
        "name": prog.get("name"),
        "type": prog.get("type"),
        "completion": prog.get("completion"),
    }


def _check_or_write_snapshot(name: str, payload: dict) -> None:
    """
    Compare `payload` against scraper/tests/snapshots/<name>.json. If
    UPDATE_SNAPSHOTS=1 is set in env, regenerate the snapshot. Otherwise fail
    on mismatch with a helpful message.
    """
    snap_path = SNAPSHOT_DIR / f"{name}.json"
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        snap_path.write_text(json.dumps(payload, indent=2, sort_keys=False))
        return

    if not snap_path.exists():
        # First run — generate the snapshot so the next CI pass can compare.
        snap_path.write_text(json.dumps(payload, indent=2, sort_keys=False))
        pytest.skip(f"Snapshot {name} created on first run; commit and re-test.")
        return

    expected = json.loads(snap_path.read_text())
    if payload != expected:
        # Compute a small diff hint
        diff_keys = []
        for k in sorted(set(list(payload.keys()) + list(expected.keys()))):
            if payload.get(k) != expected.get(k):
                diff_keys.append(k)
        msg = (
            f"Snapshot {name} drift detected (changed fields: {diff_keys}). "
            f"If the change is intentional, regenerate with: "
            f"UPDATE_SNAPSHOTS=1 python -m pytest scraper/tests/test_data_snapshots.py"
        )
        # Show the first difference in detail to aid debugging
        for k in diff_keys[:1]:
            msg += f"\n  expected[{k}] = {json.dumps(expected.get(k))[:300]}"
            msg += f"\n  actual[{k}]   = {json.dumps(payload.get(k))[:300]}"
        raise AssertionError(msg)


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("code", SNAPSHOT_PROGRAM_CODES)
def test_program_snapshot(code):
    progs = _load_programs_by_code()
    prog = progs.get(code)
    assert prog is not None, f"Program {code} missing from data/programs_structured.json"
    payload = _program_snapshot_payload(prog)
    _check_or_write_snapshot(f"program_{code}", payload)


@pytest.mark.parametrize("code", SNAPSHOT_COURSE_CODES)
def test_course_snapshot(code):
    courses = _load_courses_by_code()
    course = courses.get(code)
    assert course is not None, f"Course {code} missing from data/courses.json"
    payload = _course_snapshot_payload(course)
    _check_or_write_snapshot(f"course_{code}", payload)
