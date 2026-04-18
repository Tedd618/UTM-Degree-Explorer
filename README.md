# UTM Degree Explorer

A tool for UTM students to plan their degree, visualize prerequisite chains, and
track progress toward program completion. This repository currently contains the
**data extraction layer** — all 2,231 courses and 164 programs scraped from the
[UTM Academic Calendar](https://utm.calendar.utoronto.ca/).

See [`PLAN.md`](PLAN.md) for the full roadmap.

---

## Repository structure

```
UTM-Degree-Explorer/
├── data/
│   ├── courses.json              # 2,231 UTM courses with full metadata
│   ├── programs.json             # 164 programs/certificates (raw text fields)
│   └── programs_structured.json  # 164 programs with parsed requirement ASTs
│
├── scraper/
│   ├── scrape_courses.py         # Step 1 — scrape all courses
│   ├── scrape_programs.py        # Step 2 — scrape all programs
│   ├── parse_requirements.py     # Step 3 — parse completion requirements into AST
│   └── requirements.txt          # Python dependencies
│
├── PLAN.md                       # Full project roadmap and architecture
└── README.md
```

---

## Data files

### `data/courses.json`

Array of ~2,231 course objects scraped from the UTM course search.

```jsonc
{
  "code": "CSC207H5",
  "title": "Software Design",
  "description": "...",
  "credits": 0.5,                   // H5 = 0.5, Y5 = 1.0
  "prerequisites": ["CSC148H5"],    // UTM course codes only
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
  "description": "",
  "enrolment_requirements_text": "...",
  "enrolment_requirements_courses": ["CSC108H5", "MAT102H5", "ISP100H5"],
  "completion_requirements_text": "...",
  "completion_requirements_courses": ["CSC108H5", "CSC148H5", ...],
  "note": ""
}
```

### `data/programs_structured.json`

Same as `programs.json` but replaces `completion_requirements_text` /
`completion_requirements_courses` with a fully parsed `completion` object.

#### Requirement AST schema

```
ProgramRequirements {
  total_credits      : { min: float, max: float | null }
  total_credits_note : string | null   // e.g. "including 4.0 at 300/400 level"
  groups             : RequirementGroup[]
  notes              : string[]
}

RequirementGroup {
  label     : string                   // "First Year", "Higher Years", etc.
  condition : string | null            // conditional track label (rare)
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
| `open_pool` | `n`, `constraint`, `subject`, `min_level`, `max_level`, `specific_courses[]`, `excluding[]`, `sub_constraints[]`, `description` | N credits from a subject/level pool (no fixed course list) |
| `text` | `text`, `courses[]` | Unparseable natural language (internships, field days, etc.) |

`all_of` and `one_of` are recursive — their `items` can contain any node type,
enabling expressions like `(CSC108H5 and MAT102H5) or CSC110Y5`.

`open_pool.sub_constraints` is an array of `{ constraint, n, description, courses?, subject?, min_level? }` — captures inline rules like "at least 0.5 from 400-level" or "no more than 0.5 GGR credits".

**Parser coverage:** 86% of requirement items are fully structured nodes;
14% fall back to `text` (irreducible natural language — field days, point
systems, external links).

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

Iterates pages `?page=0` through `?page=81` of the UTM course search with a
1-second polite delay. Resumes automatically if interrupted.

### Step 2 — Scrape all programs (~10 seconds)

```bash
python3 scrape_programs.py
# → data/programs.json  (164 programs)
```

Iterates pages `?page=0` through `?page=5` of the UTM program search.

### Step 3 — Parse completion requirements (~100 seconds, cached)

```bash
python3 parse_requirements.py
# → data/programs_structured.json  (164 programs with structured ASTs)
```

Fetches each program's individual page once (cached to
`programs_html_cache.json`) and parses the HTML completion requirement block
into the AST schema above. Re-running uses the cache — no extra network
requests.

> **Note:** `programs_html_cache.json` is excluded from git (515 KB,
> regeneratable). Delete it and re-run Step 3 to refresh from the live calendar.

---

## Project plan

See [`PLAN.md`](PLAN.md) for the full roadmap including:
- App architecture (React + TypeScript + Vite + Zustand + Tailwind)
- Planned features: one-click program import, missing prerequisite radar,
  prerequisite DAG visualizer, conflict detection, GPA estimator
- Data model for the degree planner
- Milestone breakdown

---

## Data source

All data is sourced from the
[UTM Academic Calendar 2024–2025](https://utm.calendar.utoronto.ca/).
Scraping is read-only and rate-limited to one request per second.
