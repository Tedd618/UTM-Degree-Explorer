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
| Collaborator | BUG-003: grade-conditioned prereqs preserved in parser | 8b3bb84 |
| Collaborator | BUG-004: Summer auto-inserted on import | 8b3bb84 |
| Collaborator | Exclusion logic: ordering + level upgrade rule | 8b3bb84 |
| Collaborator | BUG-001: exclusion check ignores completed semesters | 0ef5afe |
| Collaborator | BUG-002: SG override only bypasses offerings check | 0ef5afe |
| Taehyeon | Duplicate course detection (red card + credit dedup) | 869595e |
| Taehyeon | Comprehensive program parser audit (164 programs) | e1dabdd |
| Taehyeon | New-user import button highlight | 9abb8ea |
| Taehyeon | Prereq Radar recursive AND/OR display | d9364f5 |

---

## Backlog (prioritized)

### Bugs

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
