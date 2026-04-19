# UTM Degree Explorer

A local-first web app for UTM students to plan their degree, validate prerequisites, and track program progress. Built on top of a fully scraped copy of the [UTM Academic Calendar](https://utm.calendar.utoronto.ca/).

See [`PLAN.md`](PLAN.md) for the full roadmap and upcoming features.

---

## What's working (Milestone 3 — Core Planner)

- **Semester grid** — Fall 2024 through Winter 2029, with toggle to hide summer semesters
- **Click-to-add courses** — click the `+ Add course` cell in any semester and type a course code
- **Live prerequisite validation** — each course card displays one of four statuses:
  - `Completed` — semester is in the past
  - `In Progress` — current semester
  - `No Issues` — all prerequisites satisfied in earlier semesters
  - `Issues Found` — a prerequisite is missing or an excluded course is also in the plan
- **Hover tooltips** — show course title, credits, distribution, prerequisites, and issue details
- **Credit summary panel** — segmented progress bar (completed / in-progress / planned / issues) toward a 20-credit target
- **Multiple plans** — create, rename, and switch between plans; data persists in `localStorage`

---

## Repository structure

```
UTM-Degree-Explorer/
├── app/                              # React frontend (Milestone 3)
│   ├── public/data/
│   │   ├── courses.json              # 2,231 courses (served statically)
│   │   └── programs_structured.json  # 164 programs with ASTs
│   ├── src/
│   │   ├── types/index.ts            # Course, Semester, Plan, CourseStatus types
│   │   ├── utils/
│   │   │   ├── semester.ts           # Sort keys, label helpers, default semesters
│   │   │   └── prereq.ts             # getCourseStatus(), getIssueReasons()
│   │   ├── store/planStore.ts        # Zustand store (plans, courses, localStorage persist)
│   │   ├── hooks/useCourses.ts       # Fetch + cache courses.json
│   │   ├── components/
│   │   │   ├── Header.tsx            # UTM navy top bar
│   │   │   ├── Sidebar.tsx           # Plan list + display options
│   │   │   ├── PlannerGrid.tsx       # Grid container + right panel
│   │   │   ├── SemesterRow.tsx       # One semester row with add-course input
│   │   │   ├── CourseCard.tsx        # Card with status band, tooltip, remove button
│   │   │   └── RequirementsPanel.tsx # Credit progress bar + legend
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css                 # Tailwind + status color utilities
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js            # UTM brand colors (navy #002A5C, blue #007FA3)
│   └── tsconfig.json
│
├── data/
│   ├── courses.json                  # 2,231 UTM courses with full metadata
│   ├── programs.json                 # 164 programs/certificates (raw text fields)
│   └── programs_structured.json      # 164 programs with parsed requirement ASTs
│
├── scraper/
│   ├── scrape_courses.py             # Step 1 — scrape all courses
│   ├── scrape_programs.py            # Step 2 — scrape all programs
│   ├── parse_requirements.py         # Step 3 — parse completion requirements into AST
│   └── requirements.txt              # Python dependencies (requests, beautifulsoup4)
│
├── PLAN.md                           # Full project roadmap and architecture
└── README.md
```

---

## Running the app

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The app loads `courses.json` from `public/data/` on startup. All plan data is saved to `localStorage` — no backend required.

---

## Data files

### `data/courses.json`

Array of 2,231 course objects scraped from the UTM course search.

```jsonc
{
  "code": "CSC207H5",
  "title": "Software Design",
  "description": "...",
  "credits": 0.5,                   // H5 = 0.5, Y5 = 1.0
  "prerequisites": {
    "type": "COURSE",
    "code": "CSC148H5"
  },                                // Prereq AST node format
  "prerequisites_raw": "CSC148H5",  // raw text (may include cross-campus refs)
  "exclusions": ["CSC209H5"],
  "exclusions_raw": "...",
  "recommended_preparation": [],
  "recommended_preparation_raw": "",
  "distribution": "Science",        // Science | Humanities | Social Science | ""
  "hours": "24L/12T",
  "delivery": "In Class",
  "note": "",
  "has_experiential": false,
  "has_international": false
}
```

### `data/programs.json`

Array of 164 program/certificate objects.

```jsonc
{
  "code": "ERMAJ1688",
  "name": "Computer Science",
  "type": "Major",                  // Major | Minor | Specialist | Certificate
  "degree_type": "Science",         // Arts | Science | HBA | BCom | BBA | null
  "url": "/program/ermaj1688",
  "program_areas": ["Computer Science"],
  "enrolment_requirements_courses": ["CSC108H5", "MAT102H5", "ISP100H5"],
  "completion_requirements_courses": ["CSC108H5", "CSC148H5", ...]
}
```

### `data/programs_structured.json`

Same as `programs.json` but replaces the flat text fields with a fully parsed `completion` object.

#### Requirement AST schema

```
ProgramRequirements {
  total_credits      : { min: float, max: float | null }
  total_credits_note : string | null
  groups             : RequirementGroup[]
  notes              : string[]
}

RequirementGroup {
  label     : string       // "First Year", "Higher Years", etc.
  condition : string | null
  items     : RequirementNode[]
}
```

#### RequirementNode types

| type | fields | meaning |
|---|---|---|
| `course` | `code` | Single required course |
| `all_of` | `items[]` | All must be completed (AND) |
| `one_of` | `items[]` | Pick one option (OR) |
| `n_from` | `n`, `items[]` | Need exactly N credits from the listed options |
| `open_pool` | `n`, `constraint`, `subject`, `min_level`, `max_level`, `specific_courses[]`, `excluding[]`, `sub_constraints[]`, `description` | N credits from a subject/level pool |
| `text` | `text`, `courses[]` | Unparseable natural language fallback |

`all_of` and `one_of` are recursive. **Parser coverage:** 86% structured, 14% `text` fallback (irreducible natural language — field days, point systems, external links).

---

## Running the scrapers

### Prerequisites

```bash
cd scraper
pip install -r requirements.txt
```

### Step 1 — Scrape all courses (~90 seconds)

```bash
python3 scrape_courses.py
# → data/courses.json  (2,231 courses)
```

Iterates pages `?page=0` through `?page=81` of the UTM course search with a 1-second polite delay. Resumes automatically if interrupted.

### Step 2 — Scrape all programs (~10 seconds)

```bash
python3 scrape_programs.py
# → data/programs.json  (164 programs)
```

### Step 3 — Parse completion requirements (~100 seconds, cached)

```bash
python3 parse_requirements.py
# → data/programs_structured.json
```

Fetches each program's individual page once (cached to `scraper/programs_html_cache.json`) and parses the HTML into the AST schema above. Re-running uses the cache.

> **Note:** `programs_html_cache.json` is git-ignored (515 KB, regeneratable).

---

## Architecture notes

### Semester sort key

Academic calendar ordering: Fall N → Winter N+1 → Summer N+1 → Fall N+1

```ts
function semesterSortKey(year, season):
  Fall   N  → year × 3
  Winter N  → (year − 1) × 3 + 1
  Summer N  → (year − 1) × 3 + 2
```

This is used throughout the app to compare semesters without string parsing.

### Prerequisite logic

`getCourseStatus(code, semester, allSemesters, courseMap)` priority:
1. Semester in the past → `completed`
2. Semester is current → `in-progress`
3. Any prerequisite absent from all earlier semesters → `issues`
4. Any exclusion present anywhere in the plan → `issues`
5. Otherwise → `no-issues`

---

## Upcoming features

See [`PLAN.md`](PLAN.md) for the full milestone breakdown. Next planned work:

- **Milestone 4** — Missing prerequisite radar (surface unmet prereqs with one-click add)
- **Milestone 5** — One-click program import (add all required courses in topological order)
- **Milestone 6** — Degree progress tracker (per-requirement credit satisfaction)
- **Milestone 7** — Prerequisite DAG visualizer
- **Milestone 8** — Polish, course search, PDF export

---

## Data source

All data is sourced from the [UTM Academic Calendar 2024–2025](https://utm.calendar.utoronto.ca/). Scraping is read-only and rate-limited to one request per second.
