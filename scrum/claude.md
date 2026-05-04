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
cd app && npm run dev          # start dev server
cd app && npx tsc --noEmit    # type-check (run before committing)
cd scraper && python parse_requirements.py   # regenerate programs_structured.json
cd scraper && python scrape_courses.py       # regenerate courses.json
```

## Git Workflow (see SPRINT.md for full flow)
1. `git pull origin main` before starting any work
2. Work on a feature branch: `git checkout -b feat/your-feature`
3. Type-check before committing: `cd app && npx tsc --noEmit`
4. Open a PR → the other person reviews and merges
5. Never push directly to `main`

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
