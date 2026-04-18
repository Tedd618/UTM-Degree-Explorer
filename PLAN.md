# UTM Degree Explorer — Rebuild Plan

## Overview

A local-first web app that helps UTM students plan their degree by visualizing
course requirements, prerequisite chains, and degree progress. The rebuild adds
smarter automation on top of what the original tool offered.

---

## Phase 1 — Data Extraction (current focus)

### Source
`https://utm.calendar.utoronto.ca/course-search` — Drupal 10 SSR, 82 pages of
courses (pages `?page=0` through `?page=81`), ~2,540 courses total, 31 per page.

### Fields available on the listing pages (no per-course requests needed)
| Field | CSS class on listing | Notes |
|---|---|---|
| Course code + title | `h3 > div[aria-label]` | Format: `"ANT201H5 - Archaeology..."` |
| Description | `views-field-field-desc` | Full paragraph |
| Prerequisites | `views-field-field-prerequisite` | Links → `/course/CODEX` for UTM courses; external links for other campuses |
| Exclusions | `views-field-field-exclusion` | Same link pattern |
| Recommended Preparation | `views-field-field-recommended-preparation` | Same link pattern |
| Distribution Requirement | `views-field-field-distribution-requirements` | Science / Humanities / Social Science |
| Total Instructional Hours | `views-field-field-hours` | e.g. `24L/12P` |
| Mode of Delivery | `views-field-field-mode-of-delivery` | e.g. `Online, In Class` |
| Notes | `views-field-field-note` | Occasional extra info |
| Course Experience | `views-field-field-course-experience` | e.g. experiential learning flag |
| International Component | `views-field-field-international-component` | Flag |

### Scraper output
`data/courses.json` — array of course objects:
```json
{
  "code": "ANT201H5",
  "title": "Introduction to Archaeology",
  "description": "...",
  "prerequisites": ["ANT101H5"],
  "prerequisites_raw": "ANT101H5",
  "exclusions": ["ANT200Y5"],
  "exclusions_raw": "ANT200Y5 or ANT200Y1 (artsci)",
  "recommended_preparation": ["ANT102H5"],
  "distribution": "Science",
  "hours": "24L/12P",
  "delivery": "In Class",
  "note": "",
  "has_experiential": false,
  "has_international": false,
  "credits": 0.5
}
```

`credits` is inferred from the suffix: `H5` → 0.5, `Y5` → 1.0.

### Scraper implementation
`scraper/scrape_courses.py` — uses `requests` + `BeautifulSoup`.
- Iterates pages 0–81
- Polite delay: 1 s between requests
- Saves progress incrementally (resume on crash)
- Separates UTM-internal prerequisites (relative links `/course/…`) from
  cross-campus ones (absolute links to `artsci.calendar.utoronto.ca`, etc.)

---

## Phase 2 — App Architecture

### Tech stack
- **Frontend:** React + TypeScript (Vite)
- **State management:** Zustand (lightweight, no boilerplate)
- **Styling:** Tailwind CSS
- **Data:** bundled `courses.json` (static), degree requirements in separate
  `programs/` JSON files
- **Persistence:** `localStorage` (no backend needed for v1)

### Data model
```
Plan {
  id, name, degreeType, majors[], minors[]
  semesters: Semester[]
}

Semester {
  id, label (e.g. "Fall 2025"), year, season
  courses: CourseEntry[]
}

CourseEntry {
  code, status: "planned" | "completed" | "in-progress"
}
```

---

## Phase 3 — Features

### Carried over from original
- **Planner table** — drag-and-drop courses into semester slots
- **Prerequisite validation** — warn if a course appears before its prerequisite
- **Degree progress tracker** — show % of credits satisfied per requirement category

### New features

#### 3a. One-click degree essentials
Select a program (e.g. "Computer Science Major") and click **"Add required
courses"** → all mandatory courses are instantly added to the planner in a
recommended order based on the prerequisite graph (topological sort).

#### 3b. Missing prerequisite radar
For every course currently in the plan, scan its prerequisite chain and surface
any prerequisites that are **not** in the plan. Show them in a sidebar panel
with a one-click "Add to plan" button.

#### 3c. Prerequisite graph visualizer
Click any course to see a DAG (directed acyclic graph) of its full prerequisite
tree using a small canvas/SVG renderer. Helps students understand deep chains
(e.g. CSC258H5 requires CSC108H5 → CSC148H5 → CSC207H5 chain).

#### 3d. Credit counter & GPA estimator
Live tally of credits planned / completed, broken down by year and category.
Optional GPA estimate based on entered grades.

#### 3e. Course search + filter
Search by code, keyword, distribution requirement, or delivery mode. Add
directly from search results into any semester.

#### 3f. Conflict detection
Flag courses that mutually exclude each other if both appear in the plan.

---

## Phase 4 — Program / Degree Data

UTM degree requirements are currently on
`https://utm.calendar.utoronto.ca/program-search`. These will need a separate
scraper or manual JSON encoding for each program of interest (e.g., CS Major,
CS Minor, Statistics Major, etc.).

Format for `programs/cs-major.json`:
```json
{
  "id": "cs-major",
  "name": "Computer Science Major",
  "type": "major",
  "credits_required": 10.0,
  "requirements": [
    { "label": "Core (7.5 credits)", "courses": ["CSC108H5", ...], "pick": "all" },
    { "label": "Electives (2.5 credits)", "courses": [...], "min_credits": 2.5 }
  ]
}
```

---

## Milestones

| # | Milestone | Status | Deliverable |
|---|---|---|---|
| 1 | Data extraction | ✅ Done | `data/courses.json` — 2,231 UTM courses |
| 2 | Program data | ✅ Done | `data/programs_structured.json` — 164 programs with ASTs |
| 3 | Core planner | ✅ Done | Semester grid, prerequisite validation, credit summary, multi-plan support |
| 4 | Prerequisite radar | 🔜 Next | Surface unmet prereqs with one-click add |
| 5 | One-click import | 🔜 | Add all required courses from a program in topological order |
| 6 | Degree progress | 🔜 | Per-requirement credit satisfaction bars |
| 7 | Graph visualizer | 🔜 | DAG view per course |
| 8 | Polish + export | 🔜 | Course search, PDF/image export |
