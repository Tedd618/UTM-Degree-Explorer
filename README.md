# UTM Degree Explorer

A local-first web app for UTM students to plan their degree, validate prerequisites, and track program progress. Built on top of a fully scraped copy of the [UTM Academic Calendar](https://utm.calendar.utoronto.ca/).

See [`PLAN.md`](PLAN.md) for the full roadmap and upcoming features.

---

## What's working (Milestone 6 — Degree Progress Tracker)

- **Semester grid** — fixed 8-slot CSS grid per semester, Fall/Winter/Summer from 2024 through 2029, with toggle to hide summers
- **Click-to-add courses** — type a course code or name; results sorted by exact match → prefix → contains
- **Live prerequisite validation** — each course card displays one of four statuses:
  - `Completed` — semester is in the past
  - `In Progress` — current semester
  - `No Issues` — all prerequisites satisfied in earlier semesters
  - `Issues Found` — a prerequisite is missing, an excluded course is also in the plan, or the course isn't offered in that season
- **Prerequisite Radar panel** — lists all unmet prereqs for future courses; chips are draggable directly into any semester; credit/level-pool requirements shown as non-draggable badges
- **Degree Progress Tracker** — per-requirement satisfaction view when a program is selected
- **Credit summary panel** — segmented progress bar toward a 20-credit target
- **Multiple plans** — create, rename, and switch between plans; synced to Supabase for logged-in users
- **Guest mode** — full planner available without sign-in (changes not persisted)

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
│   ├── courses.json                  # 2,346 UTM courses with full metadata
│   ├── programs.json                 # 164 programs/certificates (raw text fields)
│   └── programs_structured.json      # 164 programs with parsed requirement ASTs
│
├── scraper/
│   ├── scrape_courses.py             # Step 1 — scrape all courses from paginated search
│   ├── scrape_programs.py            # Step 2 — scrape all programs
│   ├── parse_requirements.py         # Step 3 — parse completion requirements into AST
│   ├── fetch_missing_from_ttb.py     # Step 4 — add courses missing from search (from timetable builder)
│   ├── reparse_prereqs.py            # Step 5 — re-parse all prerequisites_raw with improved parser
│   ├── scrape_missing_courses.py     # Utility — probe gap codes not in paginated search
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

Array of 2,346 course objects. Built by running all scraper steps in order.

```jsonc
{
  "code": "CSC207H5",
  "title": "Software Design",
  "description": "...",
  "credits": 0.5,                   // H5 = 0.5, Y5 = 1.0
  "prerequisites": { ... },         // PrereqNode AST — see below
  "prerequisites_raw": "CSC148H5",  // raw calendar text
  "exclusions": ["CSC209H5"],
  "exclusions_raw": "...",
  "recommended_preparation": [],
  "recommended_preparation_raw": "",
  "distribution": "Science",        // Science | Humanities | Social Science | ""
  "hours": "24L/12T",
  "delivery": "In Class",
  "note": "",
  "has_experiential": false,
  "has_international": false,
  "offerings": ["Fall", "Winter"]   // seasons the course runs; absent = unknown
}
```

#### PrereqNode AST

| type | fields | meaning |
|---|---|---|
| `COURSE` | `code` | Single required course |
| `AND` | `operands[]` | All must be satisfied |
| `OR` | `operands[]` | Any one must be satisfied |
| `RAW` | `codes[]` | Unparsed fallback — all codes required |
| `CREDITS` | `minimum` | Must have completed ≥ N total credits |
| `LEVEL_POOL` | `n`, `subjects[]`, `min_level`, `max_level`, `specific_courses[]` | Must have ≥ N credits from a subject/level pool or specific course list |

`LEVEL_POOL` examples:
- `"1.0 credit in LIN at the 200-level"` → `{ n: 1.0, subjects: ["LIN"], min_level: 200, max_level: 299, specific_courses: [] }`
- `"1.0 credit from ITA350H5 or ITA351H5"` → `{ n: 1.0, subjects: null, min_level: null, max_level: null, specific_courses: ["ITA350H5","ITA351H5"] }`
- `"1.0 credit from STA256H5, STA258H5, STA260H5"` → specific_courses pool

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
# → data/courses.json  (~2,231 courses from paginated search)
```

Iterates pages of the UTM course search with a polite delay. Some courses don't appear in the paginated results — run steps 4 and 5 after to fill gaps.

### Step 4 — Add missing courses from timetable builder (~35 seconds)

```bash
python3 fetch_missing_from_ttb.py
# reads data/seasonal/fall_winter_courses.json + summer_courses.json
# fetches any codes not in courses.json from the UTM calendar
# → data/courses.json  (adds ~115 missing courses)
```

Compares course codes in the UofT timetable builder export against `courses.json`, fetches each missing course from the UTM Academic Calendar, and merges them in.

### Step 5 — Re-parse prerequisites (~5 seconds)

```bash
python3 reparse_prereqs.py
# → data/courses.json  (fixes parsed ASTs for ~900 courses)
```

Re-processes every `prerequisites_raw` field with an improved rule-based parser. Safe to re-run — only updates entries where the AST changes. Fixes:
- "no prerequisite" text → `[]` (removes falsely-extracted course codes)
- `"excluding X"` clauses stripped before tokenising
- `"(or equivalent)"`, `"permission of instructor"` noise stripped
- `"at least N credits"`, `"N full credits, including X"`, `"Any N credits"` → `CREDITS` node
- `"N credits including X and Y"` → `CREDITS` + required course nodes
- `"N.N credit from X, Y, Z"` embedded in OR → `LEVEL_POOL` with `specific_courses`
- `"N credits at the 200-level in LIN"` → `LEVEL_POOL` with subject + level range

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
5. Course not offered in that season → `issues`
6. Otherwise → `no-issues`

`evaluatePrereq(node, codesBefore, courseMap)` handles all PrereqNode types:
- `CREDITS` — sums `credits` field of all courses in `codesBefore`, checks ≥ minimum
- `LEVEL_POOL` — filters completed courses by subject prefix and level range (or `specific_courses` list), sums credits, checks ≥ n

---

## Upcoming features

See [`PLAN.md`](PLAN.md) for the full milestone breakdown. Next planned work:

- **Milestone 7** — Prerequisite DAG visualizer
- **Milestone 8** — Polish, PDF export, mobile layout

---

## Data source

All data is sourced from the [UTM Academic Calendar 2024–2025](https://utm.calendar.utoronto.ca/). Scraping is read-only and rate-limited to one request per second.
