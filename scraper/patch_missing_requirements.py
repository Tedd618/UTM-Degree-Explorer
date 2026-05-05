#!/usr/bin/env python3
"""
patch_missing_requirements.py
─────────────────────────────
Post-processor that detects requirement sections the main parser missed
and patches programs_structured.json with reconstructed AST nodes.

Strategy
========
1. Manual OVERRIDES run first for programs whose existing AST nodes are
   themselves wrong (e.g. open_pool with subject=null that should be
   Psychology-only, or pools with Group A/B/C course lists missing).
2. A conservative auto-patcher then sweeps remaining programs and appends
   `n_from(n=X, items=[...])` nodes for any "X credits from ..." raw segment
   that contains ≥3 missing courses.
"""

import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW   = ROOT / "data" / "programs.json"
STRUC = ROOT / "data" / "programs_structured.json"
COURSES = ROOT / "data" / "courses.json"

CODE_RE = re.compile(r'\b[A-Z]{2,4}\d{3}[HY]\d\b')
CRED_PHRASE_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s+(?:additional\s+)?credits?\s+(?:from|of|in)\b',
    re.IGNORECASE,
)
# Markers that signify the end of a requirement section — segments should not
# extend past these (everything after is informational notes, not requirements).
NOTE_MARKERS_RE = re.compile(
    r'\bNOTES?\s*:|\bNote\s*:|\bNote\s+\d+\s*:|\b[A-Z]+\d{3}[HY]\d\s+is\s+(highly\s+)?recommended\b'
    r'|\bmay\s+be\s+used\s+to\s+satisfy\b|\bare\s+not\s+permitted\b|\bSpecial\s+consideration\b',
    re.IGNORECASE,
)


def collect_codes_from_node(node):
    s = set()
    if not isinstance(node, dict):
        return s
    if node.get('type') == 'course' and node.get('code'):
        s.add(node['code'])
    for k in ('items', 'specific_courses', 'excluding', 'courses'):
        v = node.get(k)
        if isinstance(v, list):
            for c in v:
                if isinstance(c, str):
                    s.add(c)
                elif isinstance(c, dict):
                    s |= collect_codes_from_node(c)
    return s


def collect_codes_from_program(prog):
    s = set()
    for g in prog.get('completion', {}).get('groups', []):
        for it in g.get('items', []):
            s |= collect_codes_from_node(it)
    return s


def collect_codes_with_pool_expansion(prog, all_course_codes: list[str]) -> set[str]:
    """
    Like collect_codes_from_program but also expands open_pool subject+level
    filters: e.g. open_pool(subj=STA, min_level=300, max_level=400) implicitly
    covers every STA 300-400 course in the catalog.

    This prevents the auto-patcher from creating duplicate n_from nodes for
    courses already implicitly covered by a subject-filtered open_pool.
    """
    s = collect_codes_from_program(prog)
    for g in prog.get('completion', {}).get('groups', []):
        for it in g.get('items', []):
            if not isinstance(it, dict): continue
            if it.get('type') != 'open_pool': continue
            subj = it.get('subject')
            min_l = it.get('min_level')
            max_l = it.get('max_level')
            if not subj and not (min_l or max_l):
                continue
            for code in all_course_codes:
                if subj and not code.startswith(subj):
                    continue
                if min_l is not None or max_l is not None:
                    lvl = course_century(code)
                    if min_l is not None and lvl < min_l: continue
                    if max_l is not None and lvl > max_l: continue
                s.add(code)
    return s


def course_century(code: str) -> int:
    """Return the level century: CSC490H5 → 400, MAT223H5 → 200."""
    m = re.search(r'\d{3}', code)
    return (int(m.group(0)) // 100) * 100 if m else 0


def filter_by_level(codes: list[str], min_level: int | None, max_level: int | None) -> list[str]:
    out = []
    for c in codes:
        lvl = course_century(c)
        if min_level is not None and lvl < min_level: continue
        if max_level is not None and lvl > max_level: continue
        out.append(c)
    return out


# ════════════════════════════════════════════════════════════════
# Manual overrides — run first
# ════════════════════════════════════════════════════════════════
OVERRIDES = {}


def override(*codes):
    def deco(fn):
        for c in codes:
            OVERRIDES[c] = fn
        return fn
    return deco


def _extract_groups_abc(raw_text: str) -> dict[str, list[str]]:
    """Extract 'Group A - ...', 'Group B - ...', 'Group C - ...' course lists from raw text."""
    out = {}
    for label in ('A', 'B', 'C'):
        # Match "Group X - <name>: <courses>" up to next "Group Y -" or "Note" or end
        m = re.search(
            rf'Group\s+{label}\s*[-–]\s*[^:]+:(.*?)(?=Group\s+[A-Z]\s*[-–]|Note\s*[:：]|$)',
            raw_text, re.IGNORECASE | re.DOTALL,
        )
        if not m: continue
        out[label] = list(dict.fromkeys(CODE_RE.findall(m.group(1))))
    return out


@override('ERMAJ1160', 'ERSPE1160')
def fix_psychology(prog):
    """
    Psychology Major + Specialist: open_pools with subject=null but description
    references "Psychology". These were matching ANY 300/400-level course.
    Fix: set subject="PSY" so only Psychology courses count.
    """
    for g in prog.get('completion', {}).get('groups', []):
        for it in g.get('items', []):
            if it.get('type') != 'open_pool': continue
            if it.get('subject'): continue
            desc = (it.get('description') or '').lower()
            if 'in psychology' in desc or 'psychology requirement' in desc:
                it['subject'] = 'PSY'


@override('ERMAJ0727', 'ERSPE0727')
def fix_criminology(prog, raw_text=None):
    """
    Criminology, Law & Society: open_pools "X credit from Group A/B/C at level
    Y" have subject=null and empty specific_courses, so they match ANY course
    at that level. Fix: extract Group A/B/C course lists from raw text and
    assign as specific_courses, filtered by the pool's level.

    Description variants we handle:
      - "Group A or B or C (below) at the 400-level"   → use A∪B∪C
      - "courses listed in Group A below"              → use A only
      - "courses listed in Group C below"              → use C only
      - "courses listed in Group A or B or C below"    → use A∪B∪C
    """
    if raw_text is None:
        return
    groups_abc = _extract_groups_abc(raw_text)
    if not groups_abc: return

    A = groups_abc.get('A', [])
    B = groups_abc.get('B', [])
    C = groups_abc.get('C', [])

    def courses_for_desc(desc: str) -> list[str]:
        d = desc.lower()
        # Most specific patterns first
        # "Group A or B or C" or "Group A, B, or C"
        if re.search(r'group\s+a[, ]?\s*(?:or\s+)?b[, ]?\s*(?:or\s+)?c', d):
            return list(dict.fromkeys(A + B + C))
        # "Group A and B and C"
        if 'group a' in d and 'group b' in d and 'group c' in d:
            return list(dict.fromkeys(A + B + C))
        # Single group
        if 'group a' in d and 'group b' not in d and 'group c' not in d:
            return list(A)
        if 'group b' in d and 'group a' not in d and 'group c' not in d:
            return list(B)
        if 'group c' in d and 'group a' not in d and 'group b' not in d:
            return list(C)
        return list(dict.fromkeys(A + B + C))  # fallback to union

    for g in prog.get('completion', {}).get('groups', []):
        for it in g.get('items', []):
            if it.get('type') != 'open_pool': continue
            desc = it.get('description') or ''
            if 'group ' not in desc.lower(): continue
            if it.get('specific_courses'): continue  # already populated
            candidates = courses_for_desc(desc)
            if not candidates: continue

            min_lvl = it.get('min_level')
            max_lvl = it.get('max_level')
            # Special case: pool says "300-/400-level" or "300/400" but the parser
            # set max_level=400 (single century) — broaden to 300-499.
            if '300-/400' in desc or '300/400' in desc or '300- and 400' in desc.lower():
                min_lvl = 300
                max_lvl = 499
                it['min_level'] = 300
                it['max_level'] = 499
            filtered = filter_by_level(candidates, min_lvl, max_lvl)
            if filtered:
                it['specific_courses'] = filtered


def auto_patch(prog: dict, raw_prog: dict, all_course_codes: list[str]) -> dict:
    """Append n_from nodes for raw segments with ≥3 missing courses.

    `all_course_codes` is used to expand open_pool implicit coverage so we
    don't create duplicates of pool-filtered course sets.
    """
    raw_text = raw_prog.get('completion_requirements_text') or ''
    raw_codes = set(raw_prog.get('completion_requirements_courses') or [])
    raw_codes |= set(CODE_RE.findall(raw_text))

    struct_codes = collect_codes_with_pool_expansion(prog, all_course_codes)
    missing = raw_codes - struct_codes
    if not missing:
        return {'patched': False, 'reason': 'no_missing'}

    matches = list(CRED_PHRASE_RE.finditer(raw_text))
    if not matches:
        return {'patched': False, 'reason': 'no_phrases', 'missing_count': len(missing)}

    new_nodes = []
    nodes_codes_seen: set[str] = set()
    for i, m in enumerate(matches):
        n = float(m.group(1))
        seg_start = m.start()
        seg_end = matches[i + 1].start() if i + 1 < len(matches) else len(raw_text)
        seg_text = raw_text[seg_start:seg_end]
        # Truncate at a NOTES/Note marker — everything after is informational
        note_m = NOTE_MARKERS_RE.search(seg_text, pos=1)  # skip pos 0 to avoid matching the credit phrase itself
        if note_m:
            seg_text = seg_text[:note_m.start()]
        seg_codes = list(dict.fromkeys(CODE_RE.findall(seg_text)))
        seg_missing = [c for c in seg_codes if c in missing]
        if len(seg_missing) < 3:
            continue
        if set(seg_codes) <= nodes_codes_seen:
            continue
        new_nodes.append({
            'type': 'n_from',
            'n': n,
            'items': [{'type': 'course', 'code': c} for c in seg_codes],
        })
        nodes_codes_seen |= set(seg_codes)

    if not new_nodes:
        return {'patched': False, 'reason': 'no_actionable_segments', 'missing_count': len(missing)}

    groups = prog.setdefault('completion', {}).setdefault('groups', [])
    target = next((g for g in groups if g.get('label') == 'Additional Requirements (auto-recovered)'), None)
    if target is None:
        target = {'label': 'Additional Requirements (auto-recovered)', 'condition': None, 'items': []}
        groups.append(target)
    target['items'].extend(new_nodes)

    new_struct_codes = collect_codes_with_pool_expansion(prog, all_course_codes)
    return {'patched': True, 'new_nodes': len(new_nodes),
            'still_missing': len(raw_codes - new_struct_codes)}


def main():
    raw_data = json.loads(RAW.read_text())
    struct_data = json.loads(STRUC.read_text())
    courses_data = json.loads(COURSES.read_text())
    courses_list = courses_data if isinstance(courses_data, list) else courses_data.get('courses', [])
    all_course_codes = [c['code'] for c in courses_list if c.get('code')]

    raw_list = raw_data if isinstance(raw_data, list) else raw_data.get('programs', [])
    struct_list = struct_data if isinstance(struct_data, list) else struct_data.get('programs', [])
    raw_by_code = {p['code']: p for p in raw_list}

    stats = {'patched': 0, 'no_missing': 0, 'no_action': 0,
             'overrides': 0, 'new_nodes': 0}

    for prog in struct_list:
        code = prog.get('code')
        if not code or code not in raw_by_code:
            continue

        # Apply manual override (passes raw_text as kwarg if accepted)
        if code in OVERRIDES:
            fn = OVERRIDES[code]
            try:
                fn(prog, raw_text=raw_by_code[code].get('completion_requirements_text') or '')
            except TypeError:
                fn(prog)
            stats['overrides'] += 1

        result = auto_patch(prog, raw_by_code[code], all_course_codes)
        if result['patched']:
            stats['patched'] += 1
            stats['new_nodes'] += result['new_nodes']
            print(f"PATCHED {code} | {(prog.get('name') or '')[:40]:40s} | "
                  f"+{result['new_nodes']} n_from, still missing {result['still_missing']}")
        elif result.get('reason') == 'no_missing':
            stats['no_missing'] += 1
        else:
            stats['no_action'] += 1

    STRUC.write_text(json.dumps(struct_data, indent=2))
    for dest in [
        ROOT / 'app' / 'public' / 'programs_structured.json',
        ROOT / 'app' / 'public' / 'data' / 'programs_structured.json',
    ]:
        if dest.exists():
            dest.write_text(json.dumps(struct_data, indent=2))

    print()
    print(f"=== SUMMARY ===")
    print(f"manual overrides applied:   {stats['overrides']}")
    print(f"auto-patched programs:      {stats['patched']} (+{stats['new_nodes']} new n_from)")
    print(f"already complete:           {stats['no_missing']}")
    print(f"still need manual fix:      {stats['no_action']}")


if __name__ == '__main__':
    main()
