# Claude Collaboration Guide

## Project
UTM Degree Explorer — a local-first React/TypeScript web app for UTM students
to plan their degree, validate prerequisites, and track program progress.

## Repository
`https://github.com/Tedd618/UTM-Degree-Explorer.git`

## Stack
| Layer | Tech |
|-------|------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| State | Zustand (`app/src/store/planStore.ts`) |
| Data | Static JSON — `courses.json`, `programs_structured.json` |
| Backend | Supabase (auth + plan sync, not yet wired) |
| Scraper | Python + BeautifulSoup (`scraper/`) |

## Working Directories
- **Taehyeon:** `/Users/taehyeon/Projects/utm degree explorer`
- **Collaborator:** `/Users/engwing_mkt/Documents/Documents/08 UTM Degree Explorer`

## Key Files
| Path | Purpose |
|------|---------|
| `app/src/components/` | All React UI components |
| `app/src/components/RequirementsPanel.tsx` | Degree progress panel |
| `app/src/components/PrereqRadarPanel.tsx` | Missing prereq radar sidebar |
| `app/src/store/planStore.ts` | Zustand global state + localStorage persistence |
| `app/src/utils/prereq.ts` | Prereq validation, duplicate detection, issue reasons |
| `app/src/utils/evaluator.ts` | Requirement AST evaluation (n_from, one_of, etc.) |
| `app/src/types/index.ts` | Shared TypeScript types |
| `data/courses.json` | 2,346 UTM courses (do not hand-edit) |
| `data/programs_structured.json` | 164 programs with requirement ASTs (do not hand-edit) |
| `app/public/programs_structured.json` | Copy served to app — regenerate both together |
| `scraper/parse_requirements.py` | Regenerates programs_structured.json |
| `scraper/scrape_courses.py` | Regenerates courses.json |
| `scrum/PLAN.md` | Roadmap and milestones |
| `scrum/SPRINT.md` | Current sprint + who is working on what |
| `scrum/bug.md` | Bug tracker |

## Architecture Notes

### Data flow
```
scraper/ → data/*.json → app/public/*.json → bundled into Vite build
```
Never hand-edit `programs_structured.json` or `courses.json` — always regenerate
via the scraper scripts.

### PrereqNode AST
Course prerequisites are stored as a recursive discriminated union:
- `COURSE` — single course code
- `AND` / `OR` — logical combinations with `operands[]`
- `RAW` — legacy comma-separated list
- `CREDITS` — minimum total credits (e.g. ≥ 4.0)
- `LEVEL_POOL` — N credits from a subject/level group

### RequirementNode AST (programs)
- `course`, `all_of`, `one_of`, `n_from`, `open_pool`, `text`
- `n_from` nodes carry an optional `label` (e.g. "Group 1: Literary Theory")

### Summer co-enrollment rule
In `buildCodesBefore()` (`prereq.ts`): courses in the same Summer semester
count as satisfying each other's prereqs (Summer 1 can precede Summer 2).
Do not remove this logic.

### Override key conventions (ignoredPrereqs in planStore)
| Key format | Meaning |
|---|---|
| `__sg__CODE` | SG (H1) course, no prereq check |
| `__issue__SEMID__CODE` | Per-placement issue dismissed |
| `__credit_N` | Credit minimum dismissed |
| `__pool_N_SUBJ_MIN_MAX` | Level pool dismissed |

### Tailwind dynamic colors
Tailwind purges dynamic class names. Use inline `style` for computed border/bg
colors instead of template-literal class names.

## Dev Commands
```bash
cd app && npm run dev                           # start dev server
cd app && npx tsc --noEmit                      # type-check (run before committing)
cd app && npm test -- --run                     # vitest (70 tests)
python3 -m pytest scraper/tests/ -q             # pytest (165 tests, includes snapshots + integrity)
python3 scraper/parse_requirements.py           # regenerate programs_structured.json
python3 scraper/patch_missing_requirements.py   # post-process: fix dropped sections
python3 scraper/reparse_prereqs.py              # regenerate course prereq ASTs
python3 scraper/scrape_courses.py               # regenerate courses.json
```

## Data Integrity (must run green before any commit that touches scraper/ or data/)

The parser silently dropped requirement sections in 30%+ of UTM programs in
the past — bugs only surfaced via user reports. To prevent regressions:

| Tool | What it does |
|------|--------------|
| `scraper/tests/test_data_snapshots.py` | Locks in AST shape for 25 most-used programs + 45 representative courses. Fails on any change. |
| `scraper/tests/test_data_integrity.py` | Runs `validate_data_integrity.py`; fails if missing-code count INCREASED for any program/course vs the baseline. |
| `scraper/validation_baseline.json` | Frozen drift counts. Updated only when intentional improvements land. |

**Workflow when you intentionally change parsed data:**
```bash
# After running parse_requirements.py / patch_missing_requirements.py / reparse_prereqs.py:
python3 scraper/validate_data_integrity.py            # check for regressions
python3 -m pytest scraper/tests/ -q                   # snapshot + integrity tests

# If improvements are real and tests fail because the data got better:
UPDATE_SNAPSHOTS=1 python3 -m pytest scraper/tests/test_data_snapshots.py
python3 scraper/validate_data_integrity.py --update-baseline
git diff scraper/tests/snapshots/ scraper/validation_baseline.json   # review!
```
Never refresh snapshots/baseline without inspecting the diff. A regression
disguised as "tests failed, just regenerate them" is exactly what this
infrastructure exists to catch.

## Git Workflow (see SPRINT.md for full flow)
1. `git pull origin main` before starting any work
2. Work on a feature branch: `git checkout -b feat/your-feature`
3. Type-check before committing: `cd app && npx tsc --noEmit`
4. When done, merge your own branch into main — no review needed
5. Never push directly to `main` (always branch first)

## Collaboration Notes
- Check `scrum/SPRINT.md` before starting — claim your task so there's no overlap
- `data/*.json` files are generated — if you regenerate them, commit both
  `data/` and `app/public/` copies together

## Session Start Checklist (do this before any other work)
1. `git pull origin main`
2. Read `scrum/bug.md` — if there are any entries, triage them immediately:
   - Investigate the affected code
   - Add a structured entry to the Backlog in `scrum/SPRINT.md` (priority, affected files, reproduction steps)
   - Remove the triaged line from `scrum/bug.md`
   - Commit: `git add scrum/ && git commit -m "chore: triage bug reports"`
3. Check `scrum/SPRINT.md` In Progress table — make sure no one else is already working on your intended task
