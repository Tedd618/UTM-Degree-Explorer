# Claude Collaboration Guide

## Project
UTM Degree Explorer — a local-first React/TypeScript web app for UTM students to plan their degree, validate prerequisites, and track program progress.

## Repository
`git@github.com:Tedd618/UTM-Degree-Explorer.git`

## Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **State:** Zustand
- **Data:** Static JSON (courses.json, programs_structured.json)
- **Backend:** Supabase (auth + plan sync for logged-in users)
- **Scraper:** Python

## Working Directory
`/Users/engwing_mkt/Documents/Documents/08 UTM Degree Explorer`

## Key Files
| Path | Purpose |
|------|---------|
| `app/src/components/` | React UI components |
| `app/src/store/planStore.ts` | Zustand global state |
| `app/src/utils/prereq.ts` | Prerequisite validation logic |
| `app/src/types/index.ts` | Shared TypeScript types |
| `data/courses.json` | 2,346 UTM courses |
| `data/programs_structured.json` | 164 programs with requirement ASTs |
| `scrum/PLAN.md` | Roadmap and milestones |
| `error.md` | Error log |

## Git Workflow
1. Pull before starting: `git pull origin main`
2. Make changes
3. Commit with descriptive message
4. Push: `git push origin main`

## Collaboration Notes
- Remote uses SSH: `git@github.com:Tedd618/UTM-Degree-Explorer.git`
- Always pull before pushing to avoid conflicts
- Log bugs and issues in `error.md` at the project root
