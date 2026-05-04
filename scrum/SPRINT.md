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
- Open a PR when your branch is ready
- The **other person** reviews and merges (not yourself)
- PR description should say: what changed, how to test it
- Squash-merge preferred to keep main history clean
- If the other person is unreachable for 24h, you may self-merge with a comment

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
| Taehyeon | Duplicate course detection (red card + credit dedup) | 869595e |
| Taehyeon | Comprehensive program parser audit (164 programs) | e1dabdd |
| Taehyeon | New-user import button highlight | 9abb8ea |
| Taehyeon | Prereq Radar recursive AND/OR display | d9364f5 |

---

## Backlog (prioritized)

| Priority | Type | Task |
|----------|------|------|
| High | Bug | SG override suppresses all issues instead of only unsupported seasons |
| High | Bug | Exclusion logic: only flag future placements, not past |
| High | Bug | CHM242H5 prereq parsing broken (+ others) |
| High | Bug | "Receptive course" issue — needs investigation |
| Medium | Feature | Prerequisite graph visualizer (DAG view) |
| Medium | Feature | Course search + filter panel |
| Low | Feature | PDF / image export |
| Low | Feature | GPA estimator |
