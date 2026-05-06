#!/usr/bin/env python3
"""
validate_data_integrity.py
──────────────────────────
Comprehensive validator for parsed data quality. Checks both programs and
courses for raw-vs-AST drift and compares against a frozen baseline so only
NEW issues fail the build.

How it works
============
1. For each program, compute `missing_in_struct = (raw_codes ∩ valid_catalog) - struct_codes`
   (subtracts phantom codes). The auto-recovered groups added by the patcher
   count toward struct_codes, so post-patch coverage is what we measure.
2. For each course, compute `missing_in_ast` similarly, with phantom-code
   pruning baked in.
3. Compare the per-program / per-course missing counts against
   scraper/validation_baseline.json. If any value INCREASED, fail with a
   diff. Decreases are fine and silently accepted (you can refresh the
   baseline at any time).

Usage
=====
    # Check current data against baseline (used by pytest in CI)
    python3 scraper/validate_data_integrity.py

    # Refresh the baseline after intentional improvements
    python3 scraper/validate_data_integrity.py --update-baseline

Exit code 0 if all good, 1 if any regression detected.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES = ROOT / "data" / "courses.json"
PROGRAMS_RAW = ROOT / "data" / "programs.json"
PROGRAMS_STRUCT = ROOT / "data" / "programs_structured.json"
BASELINE = Path(__file__).parent / "validation_baseline.json"

CODE_RE = re.compile(r"\b[A-Z]{2,4}\d{3}[HY]\d\b")


# ── AST traversal helpers ────────────────────────────────────────────────────

def collect_codes_from_prereq_ast(node):
    """For course prereq AST (uses `operands` and `specific_courses`)."""
    s = set()
    if not isinstance(node, dict):
        return s
    if node.get("type") == "COURSE" and node.get("code"):
        s.add(node["code"])
    for k in ("operands", "items"):
        v = node.get(k)
        if isinstance(v, list):
            for x in v:
                s |= collect_codes_from_prereq_ast(x)
    sc = node.get("specific_courses")
    if isinstance(sc, list):
        for x in sc:
            if isinstance(x, str):
                s.add(x)
    return s


def collect_codes_from_program(prog, all_course_codes):
    """For program AST. Expands open_pool subject+level filters."""
    def _collect_node(node):
        s = set()
        if not isinstance(node, dict):
            return s
        if node.get("type") == "course" and node.get("code"):
            s.add(node["code"])
        for k in ("items", "specific_courses", "excluding"):
            v = node.get(k)
            if isinstance(v, list):
                for c in v:
                    if isinstance(c, str):
                        s.add(c)
                    elif isinstance(c, dict):
                        s |= _collect_node(c)
        return s

    s = set()
    for g in prog.get("completion", {}).get("groups", []):
        for it in g.get("items", []):
            s |= _collect_node(it)
            # Expand open_pool subject+level filters against catalog
            if isinstance(it, dict) and it.get("type") == "open_pool":
                subj = it.get("subject")
                min_l = it.get("min_level")
                max_l = it.get("max_level")
                if subj or min_l or max_l:
                    for code in all_course_codes:
                        if subj and not code.startswith(subj):
                            continue
                        m = re.search(r"\d{3}", code)
                        if m and (min_l or max_l):
                            lvl = (int(m.group(0)) // 100) * 100
                            if min_l is not None and lvl < min_l:
                                continue
                            if max_l is not None and lvl > max_l:
                                continue
                        s.add(code)
    return s


# ── Counting drifts ──────────────────────────────────────────────────────────

def compute_drift():
    """
    Returns:
        program_drift: dict[program_code, {name, missing_count, missing_codes}]
        course_drift:  dict[course_code,  {missing_count, missing_codes}]
    """
    raw_programs = json.loads(PROGRAMS_RAW.read_text())
    struct_programs = json.loads(PROGRAMS_STRUCT.read_text())
    courses = json.loads(COURSES.read_text())

    raw_list = raw_programs if isinstance(raw_programs, list) else raw_programs.get("programs", [])
    struct_list = struct_programs if isinstance(struct_programs, list) else struct_programs.get("programs", [])
    courses_list = courses if isinstance(courses, list) else courses.get("courses", [])

    valid = {c["code"] for c in courses_list if c.get("code")}
    raw_by_code = {p["code"]: p for p in raw_list}

    program_drift = {}
    for p in struct_list:
        code = p.get("code")
        if not code or code not in raw_by_code:
            continue
        raw_p = raw_by_code[code]
        raw_text = raw_p.get("completion_requirements_text") or ""
        raw_codes = set(raw_p.get("completion_requirements_courses") or [])
        raw_codes |= set(CODE_RE.findall(raw_text))
        raw_codes &= valid  # only count real UTM courses
        struct_codes = collect_codes_from_program(p, list(valid))
        missing = sorted(raw_codes - struct_codes)
        if missing:
            program_drift[code] = {
                "name": p.get("name"),
                "missing_count": len(missing),
                "missing_codes": missing,
            }

    course_drift = {}
    for c in courses_list:
        code = c.get("code")
        if not code:
            continue
        raw = c.get("prerequisites_raw") or ""
        raw_codes = set(CODE_RE.findall(raw)) & valid
        raw_codes.discard(code)
        ast_codes = collect_codes_from_prereq_ast(c.get("prerequisites"))
        missing = sorted(raw_codes - ast_codes)
        if missing:
            course_drift[code] = {
                "missing_count": len(missing),
                "missing_codes": missing,
            }

    return program_drift, course_drift


# ── Baseline I/O ─────────────────────────────────────────────────────────────

def write_baseline(program_drift, course_drift):
    payload = {
        "_doc": (
            "Baseline of currently-known parser drift. The validator only fails "
            "if missing_count INCREASES vs this baseline (decreases are silently "
            "accepted). Refresh with: python3 scraper/validate_data_integrity.py "
            "--update-baseline"
        ),
        "programs": {k: v["missing_count"] for k, v in program_drift.items()},
        "courses": {k: v["missing_count"] for k, v in course_drift.items()},
        "summary": {
            "programs_with_drift": len(program_drift),
            "total_program_missing": sum(v["missing_count"] for v in program_drift.values()),
            "courses_with_drift": len(course_drift),
            "total_course_missing": sum(v["missing_count"] for v in course_drift.values()),
        },
    }
    BASELINE.write_text(json.dumps(payload, indent=2, sort_keys=True))


def load_baseline():
    if not BASELINE.exists():
        return None
    return json.loads(BASELINE.read_text())


# ── Comparison ───────────────────────────────────────────────────────────────

def compare_against_baseline(program_drift, course_drift, baseline):
    """Return list of regression strings; empty list = no regressions."""
    regressions = []

    base_programs = baseline.get("programs", {})
    for code, info in program_drift.items():
        baseline_count = base_programs.get(code, 0)
        if info["missing_count"] > baseline_count:
            regressions.append(
                f"PROGRAM {code} ({info['name']}): drift increased "
                f"{baseline_count} → {info['missing_count']} "
                f"(new missing: {info['missing_codes'][:5]}{'...' if len(info['missing_codes']) > 5 else ''})"
            )
    # Programs not in baseline that now have drift
    for code, info in program_drift.items():
        if code not in base_programs and info["missing_count"] > 0:
            # Already caught above (baseline_count = 0)
            pass

    base_courses = baseline.get("courses", {})
    for code, info in course_drift.items():
        baseline_count = base_courses.get(code, 0)
        if info["missing_count"] > baseline_count:
            regressions.append(
                f"COURSE {code}: drift increased "
                f"{baseline_count} → {info['missing_count']} "
                f"(missing: {info['missing_codes']})"
            )

    return regressions


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update-baseline", action="store_true",
                    help="Refresh the baseline with current drift counts")
    args = ap.parse_args()

    print("Computing data drift...")
    program_drift, course_drift = compute_drift()
    print(f"  programs with drift: {len(program_drift)} "
          f"(total missing codes: {sum(v['missing_count'] for v in program_drift.values())})")
    print(f"  courses with drift:  {len(course_drift)} "
          f"(total missing codes: {sum(v['missing_count'] for v in course_drift.values())})")

    if args.update_baseline:
        write_baseline(program_drift, course_drift)
        print(f"\n✓ Baseline refreshed at {BASELINE}")
        return 0

    baseline = load_baseline()
    if baseline is None:
        print("\nNo baseline found. Creating one from current state.")
        write_baseline(program_drift, course_drift)
        print(f"✓ Baseline written to {BASELINE}. Commit it and re-run for regression detection.")
        return 0

    regressions = compare_against_baseline(program_drift, course_drift, baseline)
    if not regressions:
        print("\n✓ No regressions vs baseline.")
        return 0

    print(f"\n✗ {len(regressions)} regression(s) detected:")
    for r in regressions[:20]:
        print(f"  • {r}")
    if len(regressions) > 20:
        print(f"  ... and {len(regressions) - 20} more")
    print("\nIf these are intentional improvements (e.g. parser was made more "
          "selective), refresh the baseline with:\n"
          "    python3 scraper/validate_data_integrity.py --update-baseline")
    return 1


if __name__ == "__main__":
    sys.exit(main())
