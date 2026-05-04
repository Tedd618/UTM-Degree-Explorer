# Current Sprint

**Sprint goal:** Polish core planner correctness + start graph visualizer
**Period:** Week of 2026-05-03

---

## How We Work

### Branching
- `main` — always stable and deployable
- Feature branches: `feat/short-description`
- Bug branches: `fix/short-description`
- Never commit directly to `main`

### Pull Request Rules
- When your branch is ready, merge it into main yourself — no review required
- Squash-merge preferred to keep main history clean
- Always pull main first before merging to avoid conflicts

### Bug Triage (Claude's job)
- Users drop raw reports into `scrum/bug.md` as plain text — no formatting required
- When Claude sees new entries in `bug.md`, it elaborates them and moves them here into the Backlog with a priority, affected file(s), and reproduction steps
- Entries stay in `bug.md` until triaged; once added to Backlog below, they can be removed from `bug.md`

### Before Opening a PR
- [ ] `cd app && npx tsc --noEmit` passes (no type errors)
- [ ] Manually tested the affected feature in the browser
- [ ] If you fixed a bug, remove it from the Backlog below and add to Done
- [ ] `scrum/SPRINT.md` updated (move task to Done)

### Conflict Prevention
- Claim your task below under "In Progress" before starting
- Pull `main` every time you sit down to work
- If you need to touch the same file as the other person — communicate first

---

## In Progress

| Who | Task | Branch |
|-----|------|--------|
| Taehyeon | — | — |
| Collaborator | — | — |

---

## Done This Sprint

| Who | What | PR / Commit |
|-----|------|-------------|
| Collaborator | BUG-001: exclusion check ignores completed semesters | 0ef5afe |
| Collaborator | BUG-002: SG override only bypasses offerings check | 0ef5afe |
| Taehyeon | Duplicate course detection (red card + credit dedup) | 869595e |
| Taehyeon | Comprehensive program parser audit (164 programs) | e1dabdd |
| Taehyeon | New-user import button highlight | 9abb8ea |
| Taehyeon | Prereq Radar recursive AND/OR display | d9364f5 |

---

## Backlog (prioritized)

### Bugs

**BUG-003 — Grade-conditioned prerequisites not parsed** `High`
- **File:** `scraper/scrape_courses.py` (prereq parser)
- **Root cause:** Raw prereq like `CHM110H5 and a minimum grade of 60% in CHM120H5 and [...]` — the scraper strips the grade condition and loses CHM120H5 entirely. Confirmed: parsed AST for CHM242H5 has CHM110H5 and the MAT pool but not CHM120H5.
- **Fix:** Treat `minimum grade of X% in CODEX` as a standard `COURSE` prerequisite (drop the grade threshold — the planner doesn't track grades).
- **Reproduce:** Add CHM242H5 to a plan with only CHM110H5 — shows green but CHM120H5 should also be required.

**BUG-004 — Summer not auto-inserted by importCourses** `Medium`
- **File:** `app/src/store/planStore.ts` → `importCourses` (line ~254)
- **Root cause:** `importCourses` only creates semesters that appear in the import entries. If a one-click import assigns courses to Fall Y + Winter Y+1 + Fall Y+1, no Summer Y+1 is created between them. The `+year` button (`handleAdd`) does create Summers correctly, but import bypasses that logic.
- **Fix:** After building the semester list from import entries, auto-insert a Summer semester between any Winter Y and Fall Y that have no Summer Y in between.
- **Reproduce:** Import a degree with courses spanning multiple years — check if Summer semesters appear between each Fall/Winter group.

**BUG-005 — Mutually receptive courses create confusing prereq state** `Low`
- **File:** `app/src/utils/prereq.ts` → `evaluatePrereq`, `collectMissingPrereqGroups`
- **Root cause:** LIN411H5 and LIN476H5 each list the other in their 0.5-credit pool requirement. If both are in the plan and one comes before the other, the later one shows green (correct), but the earlier one flags the later one as "missing" even though the intent is they're alternatives, not a sequence. FSC407H5 self-references itself.
- **Fix:** Self-referencing codes in `LEVEL_POOL` or `OR` nodes should be excluded from the pool evaluation (a course can't satisfy its own prerequisite).
- **Reproduce:** Add LIN411H5 and LIN476H5 to the same plan in different semesters — check which one flags incorrectly.

---

### Features

| Priority | Task |
|----------|------|
| Medium | Prerequisite graph visualizer (DAG view) |
| Medium | Course search + filter panel |
| Low | PDF / image export |
| Low | GPA estimator |
