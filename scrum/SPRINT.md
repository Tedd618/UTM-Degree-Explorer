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

### Before Opening a PR
- [ ] `cd app && npx tsc --noEmit` passes (no type errors)
- [ ] Manually tested the affected feature in the browser
- [ ] `scrum/bug.md` updated if you fixed or found a bug
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
