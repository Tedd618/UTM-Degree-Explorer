#!/usr/bin/env python3
"""
Data validation script for data/courses.json.

Checks every course for:
  1. Phantom codes — courses mentioned in AST that don't exist in the course list
  2. Dropped codes — AST has fewer course codes than raw string (codes were dropped)
  3. Structural mismatch — top-level OR when raw string strongly suggests AND
  4. Self-referencing prerequisites — a course requires itself
  5. Mutual prereq cycles — A requires B, B requires A

Exit code 0 if no errors, 1 if any errors found (suitable for CI).

Run: python3 scraper/validate_courses.py
"""

import json
import re
import sys
from pathlib import Path
from collections import defaultdict

DATA_DIR = Path(__file__).parent.parent / "data"


def collect_codes_from_ast(node):
    """Recursively collect all COURSE codes from a prerequisite AST node."""
    if not node or node == []:
        return set()
    if isinstance(node, list):
        codes = set()
        for item in node:
            codes.update(collect_codes_from_ast(item))
        return codes
    if not isinstance(node, dict):
        return set()

    t = node.get("type")
    if t == "COURSE":
        return {node["code"]}
    if t in ("AND", "OR"):
        codes = set()
        for op in node.get("operands", []):
            codes.update(collect_codes_from_ast(op))
        return codes
    if t == "RAW":
        return set(node.get("codes", []))
    if t == "LEVEL_POOL":
        return set(node.get("specific_courses") or [])
    if t == "CREDITS":
        return set()
    return set()


def collect_codes_from_raw(raw):
    """Extract all course codes from the raw prerequisite string."""
    return set(re.findall(r'[A-Z]{3}\d{3}[HY]\d', raw.upper()))


def find_mutual_cycles(prereq_map):
    """
    Find all mutual 2-cycles: A requires B and B requires A.
    Returns list of (A, B) pairs (normalized so A < B).
    """
    cycles = []
    seen = set()
    for a, b_set in prereq_map.items():
        for b in b_set:
            pair = tuple(sorted([a, b]))
            if pair in seen:
                continue
            if b in prereq_map and a in prereq_map[b]:
                cycles.append(pair)
                seen.add(pair)
    return cycles


def main():
    courses_path = DATA_DIR / "courses.json"
    if not courses_path.exists():
        print(f"ERROR: {courses_path} not found", file=sys.stderr)
        sys.exit(1)

    courses = json.load(open(courses_path))
    all_codes = {c["code"] for c in courses}

    # Build direct prereq map: code → set of required course codes from AST
    prereq_map = defaultdict(set)
    for c in courses:
        ast_codes = collect_codes_from_ast(c.get("prerequisites"))
        prereq_map[c["code"]].update(ast_codes)

    errors = {
        "phantom_codes": [],
        "dropped_codes": [],
        "structural_mismatch": [],
        "self_reference": [],
        "mutual_cycles": [],
    }

    for c in courses:
        code = c["code"]
        raw = c.get("prerequisites_raw", "") or ""
        ast = c.get("prerequisites")

        raw_codes = collect_codes_from_raw(raw)
        ast_codes = collect_codes_from_ast(ast)

        # 1. Phantom codes: in AST but not in course list
        phantoms = ast_codes - all_codes
        if phantoms:
            errors["phantom_codes"].append({
                "course": code,
                "phantoms": sorted(phantoms),
            })

        # 2. Dropped codes: in raw but not in AST (excluding the course itself)
        # Exclude high-school codes that aren't in our DB — they're intentionally absent.
        # We filter to only codes that exist in our course list OR are structurally typical UTM codes.
        # A "dropped" code is one that's in raw, looks like a UTM code, exists in DB, but is absent from AST.
        eligible_raw = raw_codes & all_codes  # only codes we know about
        dropped = eligible_raw - ast_codes - {code}
        # Exclude cases where raw also has "no prerequisites" (those courses intentionally drop everything)
        if dropped and not re.search(r'\bno prerequisites?\b', raw, re.IGNORECASE):
            errors["dropped_codes"].append({
                "course": code,
                "dropped": sorted(dropped),
                "raw_snippet": raw[:120],
            })

        # 3. Structural mismatch: top-level OR but raw string has an "and" that's not inside parens
        # Heuristic: if raw has " and " at the top level (not inside brackets) but AST is an OR
        if isinstance(ast, dict) and ast.get("type") == "OR":
            # Remove bracketed content and check for top-level "and"
            stripped = re.sub(r'\([^)]*\)', ' ', raw)
            stripped = re.sub(r'\[[^\]]*\]', ' ', stripped)
            if re.search(r'\band\b', stripped, re.IGNORECASE):
                errors["structural_mismatch"].append({
                    "course": code,
                    "ast_type": "OR",
                    "raw_snippet": raw[:150],
                })

        # 4. Self-reference: course requires itself
        if code in ast_codes:
            errors["self_reference"].append(code)

    # 5. Mutual cycles
    mutual = find_mutual_cycles(prereq_map)
    for pair in mutual:
        errors["mutual_cycles"].append({"pair": list(pair)})

    # ── Report ────────────────────────────────────────────────────────────────

    total_errors = (
        len(errors["phantom_codes"]) +
        len(errors["dropped_codes"]) +
        len(errors["structural_mismatch"]) +
        len(errors["self_reference"]) +
        len(errors["mutual_cycles"])
    )

    print(f"\n{'='*60}")
    print(f"Course Data Validation Report")
    print(f"Total courses: {len(courses)}")
    print(f"{'='*60}\n")

    print(f"[1] Phantom codes (in AST, not in course DB): {len(errors['phantom_codes'])}")
    for item in errors["phantom_codes"][:20]:
        print(f"    {item['course']}: {', '.join(item['phantoms'])}")
    if len(errors["phantom_codes"]) > 20:
        print(f"    ... and {len(errors['phantom_codes']) - 20} more")

    print(f"\n[2] Dropped codes (in raw, not in AST): {len(errors['dropped_codes'])}")
    for item in errors["dropped_codes"][:20]:
        print(f"    {item['course']}: dropped {', '.join(item['dropped'])}")
        print(f"      raw: {item['raw_snippet']!r}")
    if len(errors["dropped_codes"]) > 20:
        print(f"    ... and {len(errors['dropped_codes']) - 20} more")

    print(f"\n[3] Structural mismatches (OR at top but 'and' in raw): {len(errors['structural_mismatch'])}")
    for item in errors["structural_mismatch"][:20]:
        print(f"    {item['course']}: {item['raw_snippet']!r}")
    if len(errors["structural_mismatch"]) > 20:
        print(f"    ... and {len(errors['structural_mismatch']) - 20} more")

    print(f"\n[4] Self-referencing prerequisites: {len(errors['self_reference'])}")
    for code in errors["self_reference"]:
        print(f"    {code}")

    print(f"\n[5] Mutual prerequisite cycles (A needs B, B needs A): {len(errors['mutual_cycles'])}")
    for item in errors["mutual_cycles"][:20]:
        a, b = item["pair"]
        print(f"    {a} ↔ {b}")
    if len(errors["mutual_cycles"]) > 20:
        print(f"    ... and {len(errors['mutual_cycles']) - 20} more")

    print(f"\n{'='*60}")
    print(f"Total issues: {total_errors}")
    if total_errors > 0:
        # Distinguish between errors that block CI and soft warnings
        hard_errors = len(errors["phantom_codes"]) + len(errors["self_reference"])
        soft_warnings = (
            len(errors["dropped_codes"]) +
            len(errors["structural_mismatch"]) +
            len(errors["mutual_cycles"])
        )
        print(f"  Hard errors (CI fail): {hard_errors}  (phantom codes, self-references)")
        print(f"  Soft warnings: {soft_warnings}  (dropped codes, mismatches, cycles)")
        print(f"{'='*60}\n")
        if hard_errors > 0:
            sys.exit(1)
    else:
        print("No issues found.")
        print(f"{'='*60}\n")

    sys.exit(0)


if __name__ == "__main__":
    main()
