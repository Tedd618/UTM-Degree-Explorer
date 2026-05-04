# Bug Tracker

Format: **status** — `open` | `in-progress` | `fixed`

---

## BUG-001 — SG override too broad
**Status:** open
**Reported by:** Taehyeon
**Description:** Marking a course as SG (H1) suppresses all issue flags for that
course. It should only suppress the "not offered in this season" flag — prereq
and exclusion checks should still apply.
**File:** `app/src/utils/prereq.ts` → `getCourseStatus`, `getIssueReasons`
**Reproduce:** Add any course as SG, place it in a semester where it has an
unmet prereq — the card incorrectly shows green.

---

## BUG-002 — Exclusion logic flags past placements
**Status:** open
**Reported by:** Taehyeon
**Description:** If Course A excludes Course B, and Course B is already completed
(in a past semester), Course A is still flagged as conflicting. Only future or
concurrent placements should be flagged — completed exclusions are fine.
**File:** `app/src/utils/prereq.ts` → `getCourseStatus`, `getIssueReasons`
**Reproduce:** Put CHM110H5 in a past semester, then add its exclusion partner
to a future semester — it should not be flagged.

---

## BUG-003 — CHM242H5 prereq parsing broken
**Status:** open
**Reported by:** Taehyeon
**Description:** CHM242H5 (and likely others) have malformed prereq ASTs — the
prerequisite validation either always passes or always fails incorrectly.
**File:** `data/courses.json` → check `CHM242H5.prerequisites` raw vs parsed
**Reproduce:** Add CHM242H5 to a plan without its prereqs — card should be red
but may show green (or vice versa).

---

## BUG-004 — Receptive course issue
**Status:** open
**Reported by:** Taehyeon
**Description:** Unknown — needs investigation. Likely related to courses that
list themselves or a variant as a prerequisite.
**File:** Unknown
**Reproduce:** TBD — investigate what "receptive course" means in this context.
