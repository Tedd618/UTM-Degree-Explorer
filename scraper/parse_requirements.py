#!/usr/bin/env python3
"""
UTM Program Requirements Parser
Fetches each program's individual page, parses the completion requirement HTML
into a structured AST, and saves to ../data/programs_structured.json.

Schema overview
───────────────
ProgramRequirements {
  total_credits      : { min: float, max: float | null }
  total_credits_note : str | null          # e.g. "including at least 4.0 at 300/400 level"
  groups             : RequirementGroup[]
  notes              : str[]
}

RequirementGroup {
  label     : str                          # "First Year", "Higher Years", "" for ungrouped
  condition : str | null                   # conditional track label (rare)
  items     : RequirementNode[]
}

RequirementNode (discriminated union on `type`):

  course     { code: str }
  all_of     { items: RequirementNode[] }
  one_of     { items: RequirementNode[] }
  n_from     { n: float, items: RequirementNode[] }

  open_pool  {
    n             : float,
    constraint    : "at_least" | "exactly" | "at_most",
    subject       : str | null,            # e.g. "CSC", "ANT"
    min_level     : int | null,            # e.g. 300
    max_level     : int | null,            # e.g. 400
    specific_courses : str[],              # extra named courses that also count
    excluding     : str[],
    sub_constraints : SubConstraint[],
    description   : str                    # raw text for human reading
  }

  text       { text: str, courses: str[] } # fallback for unparseable items

SubConstraint {
  constraint  : "at_least" | "at_most" | "exactly"
  n           : float
  description : str
  courses     : str[]                      # specific courses (if any named)
  subject     : str | null
  min_level   : int | null
}
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

BASE_URL = "https://utm.calendar.utoronto.ca"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "programs_structured.json"
CACHE_FILE  = Path(__file__).parent / "programs_html_cache.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


# ══════════════════════════════════════════════════════════════
# Step 1 — fetch / cache HTML
# ══════════════════════════════════════════════════════════════

def fetch_all_program_html(programs: list[dict]) -> dict[str, str]:
    """Return {code: html_string} for every program, using file cache."""
    cache: dict[str, str] = {}
    if CACHE_FILE.exists():
        with open(CACHE_FILE) as f:
            cache = json.load(f)
        print(f"Cache loaded: {len(cache)} programs.")

    session = requests.Session()
    changed = False
    for p in programs:
        code = p["code"]
        url  = p["url"]
        if code in cache:
            continue
        full_url = f"{BASE_URL}{url}"
        print(f"  Fetching {code} …", end=" ")
        try:
            r = session.get(full_url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            comp = soup.find(class_="field--name-field-completion-req")
            cache[code] = str(comp) if comp else ""
            print("ok")
        except Exception as e:
            print(f"ERROR: {e}")
            cache[code] = ""
        changed = True
        time.sleep(0.6)

    if changed:
        with open(CACHE_FILE, "w") as f:
            json.dump(cache, f)

    return cache


# ══════════════════════════════════════════════════════════════
# Step 2 — tokenizer for course-expression strings
# ══════════════════════════════════════════════════════════════

# Token types
T_COURSE = "COURSE"
T_AND    = "AND"
T_OR     = "OR"
T_LP     = "LP"   # ( or [
T_RP     = "RP"   # ) or ]
T_EOF    = "EOF"

def tokenize_element(elem: Tag) -> list[tuple]:
    """
    Walk an HTML element and produce a flat token list.
    Each token is (type, value) where value is the course code or None.
    """
    tokens = []
    for node in elem.descendants:
        if isinstance(node, NavigableString):
            text = str(node)
            # split on connectors and parens
            parts = re.split(r'(\band\b|\bor\b|[\(\)\[\]])', text, flags=re.IGNORECASE)
            for part in parts:
                p = part.strip()
                if not p:
                    continue
                pl = p.lower()
                if pl == "and":
                    tokens.append((T_AND, None))
                elif pl == "or":
                    tokens.append((T_OR, None))
                elif p in ("(", "["):
                    tokens.append((T_LP, None))
                elif p in (")", "]"):
                    tokens.append((T_RP, None))
                # ignore other text fragments in the token stream
        elif isinstance(node, Tag) and node.name == "a":
            href = node.get("href", "")
            if "/course/" in href:
                code = href.split("/course/")[-1].upper()
                tokens.append((T_COURSE, code))
    tokens.append((T_EOF, None))
    return tokens


class Parser:
    """Simple recursive-descent parser for course-logic expressions."""

    def __init__(self, tokens: list[tuple]):
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> tuple:
        if self.pos >= len(self.tokens):
            return (T_EOF, None)
        return self.tokens[self.pos]

    def consume(self, expected_type=None) -> tuple:
        if self.pos >= len(self.tokens):
            return (T_EOF, None)
        tok = self.tokens[self.pos]
        if expected_type and tok[0] != expected_type:
            raise ValueError(f"Expected {expected_type}, got {tok}")
        self.pos += 1
        return tok

    def parse(self):
        node = self.parse_or()
        return node

    def parse_or(self):
        left = self.parse_and()
        items = [left] if left else []
        while self.peek()[0] == T_OR:
            self.consume(T_OR)
            item = self.parse_and()
            if item:
                items.append(item)
        if not items:
            return None
        if len(items) == 1:
            return items[0]
        return {"type": "one_of", "items": items}

    def parse_and(self):
        left = self.parse_atom()
        items = [left] if left else []
        while self.peek()[0] == T_AND:
            self.consume(T_AND)
            item = self.parse_atom()
            if item:
                items.append(item)
        if not items:
            return None
        if len(items) == 1:
            return items[0]
        return {"type": "all_of", "items": items}

    def parse_atom(self):
        tok = self.peek()
        if tok[0] in (T_EOF, T_RP):
            return None
        if tok[0] == T_LP:
            self.consume(T_LP)
            node = self.parse_or()
            if self.peek()[0] == T_RP:
                self.consume(T_RP)
            return node
        if tok[0] == T_COURSE:
            self.consume(T_COURSE)
            return {"type": "course", "code": tok[1]}
        # skip unexpected text tokens
        self.pos += 1
        return None


def parse_course_expr(elem: Tag):
    """Parse a soup element's course-logic into a RequirementNode tree."""
    tokens = tokenize_element(elem)
    # filter out None nodes later
    parser = Parser(tokens)
    result = parser.parse()
    return _clean(result)


def _clean(node):
    """Remove None atoms and flatten single-element groups."""
    if node is None:
        return None
    if node["type"] == "course":
        return node
    items = [_clean(i) for i in node.get("items", [])]
    items = [i for i in items if i is not None]
    if not items:
        return None
    if len(items) == 1:
        return items[0]
    return {**node, "items": items}


# ══════════════════════════════════════════════════════════════
# Step 3 — classify and parse individual requirement items
# ══════════════════════════════════════════════════════════════

def utm_codes_in(elem) -> list[str]:
    """All UTM course codes linked within an element, in order, deduplicated."""
    seen = set()
    result = []
    for a in elem.find_all("a", href=True):
        href = a["href"]
        if "/course/" in href:
            code = href.split("/course/")[-1].upper()
            if code not in seen:
                seen.add(code)
                result.append(code)
    return result


def parse_item(elem: Tag) -> dict:
    """
    Parse a single <li> or <p> into a RequirementNode.
    Dispatcher that handles all 24 pattern types.
    """
    text  = elem.get_text(" ", strip=True)
    codes = utm_codes_in(elem)

    if not text:
        return None

    # ── filter out structural noise ───────────────────────────────────────────
    noise_patterns = (
        r'^and$', r'^or$', r'^the\s+program\s+must\s+include',
        r'^required\s+courses?\s*:?\s*$', r'^foundation\s*:?\s*$',
    )
    if any(re.match(p, text, re.I) for p in noise_patterns):
        return None

    # ── note / pure text (no courses, or clearly informational) ──────────────
    note_prefixes = ("note", "notes", "*", "please", "for more", "students are",
                     "it is recommended", "up to", "rop/")
    if any(text.lower().startswith(p) for p in note_prefixes) and not codes:
        return {"type": "text", "text": text, "courses": codes}

    # ── n_from / open_pool detection ─────────────────────────────────────────
    # Primary: "N.0 credit[s] from/in/of ..."
    n_credit_m = re.match(
        r'^(?:.*?)?(\d+\.?\d*)\s+credit[s]?\s+(from|in|of)\b',
        text, re.I
    )
    # Secondary: "N.0 SUBJ credit[s]" (e.g. "3.0 RLG credits at the 300+level")
    subj_credit_m = re.match(
        r'^(\d+\.?\d*)\s+([A-Z]{2,4})\s+credit[s]?\b', text
    ) if not n_credit_m else None
    # Tertiary: "N.0 credit[s] at the NNN level" (no from/in)
    bare_credit_m = re.match(
        r'^(\d+\.?\d*)\s+credit[s]?\s+at\s+the\s+\d', text, re.I
    ) if not n_credit_m and not subj_credit_m else None

    min_n_m  = re.match(r'^(?:minimum\s+of|at\s+least)\s+(\d+\.?\d*)\s+(?:[A-Z]{2,4}\s+)?credit', text, re.I)
    # "N.0 additional [SUBJ] credit[s]" — e.g. "2.5 additional credits in PHL"
    additional_m = re.match(
        r'^(\d+\.?\d*)\s+additional\s+(?:[A-Za-z]+\s+)?credit[s]?\b', text, re.I
    ) if not n_credit_m and not subj_credit_m and not bare_credit_m and not min_n_m else None
    one_of_m = re.match(r'^one\s+of\b', text, re.I)

    if n_credit_m or min_n_m or subj_credit_m or bare_credit_m or additional_m:
        raw_m = n_credit_m or min_n_m or subj_credit_m or bare_credit_m or additional_m
        n = float(raw_m.group(1))
        return _parse_n_credit_item(elem, text, codes, n, n_credit_m)

    if one_of_m:
        if codes:
            return {"type": "one_of", "items": [{"type": "course", "code": c} for c in codes]}

    # ── no course links: pure descriptive text ───────────────────────────────
    if not codes:
        return {"type": "text", "text": text, "courses": []}

    # ── single course ─────────────────────────────────────────────────────────
    if len(codes) == 1 and "and" not in text.lower() and "or" not in text.lower():
        return {"type": "course", "code": codes[0]}

    # ── comma-separated course list (no and/or keywords) ─────────────────────
    # e.g. "PSY210H5 , PSY290H5" or "ECO325H5 ECO326H5"
    has_and = " and " in text.lower()
    has_or  = " or "  in text.lower()
    if not has_and and not has_or and len(codes) > 1:
        return {"type": "all_of", "items": [{"type": "course", "code": c} for c in codes]}

    # ── complex AND/OR expression — use recursive descent parser ─────────────
    has_paren = "(" in text or "[" in text

    if has_paren or (has_and and has_or):
        node = parse_course_expr(elem)
        if node:
            return node
        return {"type": "text", "text": text, "courses": codes}

    if has_and and not has_or:
        return {"type": "all_of", "items": [{"type": "course", "code": c} for c in codes]}

    if has_or and not has_and:
        return {"type": "one_of", "items": [{"type": "course", "code": c} for c in codes]}

    # ── single course with extra text (e.g. "PSY100Y5 (strongly recommended)") ─
    if len(codes) == 1:
        return {"type": "course", "code": codes[0]}

    return {"type": "text", "text": text, "courses": codes}


def _parse_n_credit_item(elem: Tag, text: str, codes: list[str], n: float, m) -> dict:
    """Handle all flavours of N-credits-from/in/of items."""

    # ── check for "one of" / explicit list → n_from ───────────────────────────
    preposition = m.group(2).lower() if m else "from"

    # Detect "any level" or level filter
    # Handles "300/400", "300-400", "300+ level", "200+ level"
    any_level_m  = re.search(r'any\s+(\d{3})[/\-]?(\d{3})?\+?\s*[-–]?\s*level', text, re.I)
    # Also handle "NNN or NNN level" (e.g. "300 or 400 level")
    level_or_m   = re.search(r'(\d{3})\s+or\s+(\d{3})\s+level', text, re.I)
    level_filt_m = re.search(r'(\d{3})[/\-]?(\d{3})?\+?\s*[-–]?\s*level', text, re.I)
    # "N.0 [additional] credit[s] in/of SUBJ" — only match uppercase 2-4 letter subjects
    subject_m    = re.search(
        r'(\d+\.?\d*)\s+(?:additional\s+)?credit[s]?\s+(?:in|of)\s+([A-Z]{2,4})\b', text
    )
    # "N.0 SUBJ credit[s]" (e.g. "3.0 RLG credits", "0.5 HIS credit")
    bare_subj_m  = re.match(r'(\d+\.?\d*)\s+([A-Z]{2,4})\s+credit', text)
    # "at least N.0 SUBJ credit[s]" (e.g. "At least 4.0 ENG credits")
    at_least_subj_m = re.match(
        r'(?:at\s+least|minimum\s+of)\s+\d+\.?\d*\s+([A-Z]{2,4})\s+credit', text, re.I
    )
    # "N.0 additional SUBJ credit[s]" (e.g. "1.0 additional RLG credits")
    additional_subj_m = re.match(
        r'\d+\.?\d*\s+additional\s+([A-Z]{2,4})\s+credit', text, re.I
    )
    # "in [subject] at the NNN level"
    subj_level_m = re.search(
        r'in\s+([A-Z]{2,4})\s+at\s+the\s+(\d{3})\s+level', text, re.I
    )

    # excluding clause — handle "except", "except for", "excluding", and "or" before last course
    excluding = []
    excl_m = re.search(
        r'(?:excluding|except(?:\s+for)?)\s+((?:[A-Z]{2,4}\d{3}[HY]\d[,\s]*(?:(?:and|or)\s+)?)+)',
        text, re.I
    )
    if excl_m:
        excluding = re.findall(r'[A-Z]{2,4}\d{3}[HY]\d', excl_m.group(1))
    # also catch linked courses preceded by "excluding" / "except" text,
    # or followed by "may not be counted" / "cannot be counted" text
    EXCL_PAT = re.compile(r'exclu|except|may\s+not\s+be\s+counted|cannot\s+be\s+counted', re.I)
    for a in elem.find_all("a", href=True):
        if "/course/" in a["href"]:
            prev = a.find_previous(string=True)
            nxt  = a.next_sibling  # NavigableString immediately after the <a>
            prev_str = str(prev) if prev else ""
            nxt_str  = str(nxt)  if nxt  else ""
            if EXCL_PAT.search(prev_str) or EXCL_PAT.search(nxt_str):
                code = a["href"].split("/course/")[-1].upper()
                if code not in excluding:
                    excluding.append(code)

    # sub-constraints: at_least / no_more_than within the text
    sub_constraints = _extract_sub_constraints(text, elem)

    # "SUBJ at the NNN/NNN level" — e.g. "MAT at the 300/400 level or CSC363H5"
    # This is an open pool with subject + level filter; named courses are specific_courses.
    # Require uppercase-only (no re.I) and at least 2 uppercase letters to avoid matching
    # common words like "be", "of", etc.
    subj_at_level_m = re.search(
        r'\b([A-Z]{2,4})\s+at\s+the\s+(\d{3})[/\-]?(\d{3})?\+?\s*[-–]?\s*level', text
    )

    # explicit list with no level/subject filter → n_from
    is_open = any_level_m or level_filt_m or subject_m or subj_level_m or subj_at_level_m
    # But if all courses are named AND there's no level/subject filter, it's n_from
    if codes and not any_level_m and not subject_m and not subj_level_m and not subj_at_level_m:
        non_excluding = [c for c in codes if c not in excluding]
        if non_excluding:
            # Try to extract a human-readable label from the text, e.g.:
            # "At least 0.5 credits in Group 1: Literary Theory/Methods: ENG101H5…"
            # → label = "Group 1: Literary Theory/Methods"
            label = None
            label_m = re.search(
                r'credit[s]?\s+(?:from|in)\s+(.+?)(?=\s*:\s*[A-Z]{2,4}\d{3}|\s*$)',
                text, re.I
            )
            if label_m:
                candidate = label_m.group(1).strip().rstrip(':').strip()
                # Only keep if it looks like a real label (not just "the following")
                # AND does not contain course codes (which means it IS the course list)
                if (candidate and
                        not re.match(r'^the\b|^following\b|^any\b', candidate, re.I) and
                        not re.search(r'[A-Z]{2,4}\d{3}[HY]\d', candidate)):
                    label = candidate
            node: dict = {
                "type": "n_from",
                "n": n,
                "items": [{"type": "course", "code": c} for c in non_excluding],
            }
            if label:
                node["label"] = label
            if excluding:
                node["excluding"] = excluding
            return node

    # open pool
    pool: dict = {
        "type": "open_pool",
        "n": n,
        "constraint": "at_most" if re.search(r'no\s+more\s+than|maximum', text, re.I) else "at_least",
        "description": text,
        "subject": None,
        "min_level": None,
        "max_level": None,
        "specific_courses": [c for c in codes if c not in excluding],
        "excluding": excluding,
        "sub_constraints": sub_constraints,
    }

    # "NNN or NNN level" takes priority over level_filt_m (which picks the last digit match)
    if any_level_m:
        lo = int(any_level_m.group(1))
        hi = int(any_level_m.group(2)) if any_level_m.group(2) else lo + 99
        pool.update({"min_level": lo, "max_level": hi})
    elif level_or_m:
        lo = int(level_or_m.group(1))
        hi = int(level_or_m.group(2)) + 99
        pool.update({"min_level": lo, "max_level": hi})
    elif level_filt_m and not subject_m:
        lo = int(level_filt_m.group(1))
        hi = int(level_filt_m.group(2)) if level_filt_m.group(2) else lo + 99
        pool.update({"min_level": lo, "max_level": hi})

    if subj_level_m:
        pool["subject"] = subj_level_m.group(1).upper()
        pool["min_level"] = int(subj_level_m.group(2))
    elif subj_at_level_m:
        pool["subject"] = subj_at_level_m.group(1).upper()
        lo = int(subj_at_level_m.group(2))
        hi = int(subj_at_level_m.group(3)) if subj_at_level_m.group(3) else lo + 99
        pool.update({"min_level": lo, "max_level": hi})
    elif subject_m:
        pool["subject"] = subject_m.group(2).upper()
    elif bare_subj_m:
        pool["subject"] = bare_subj_m.group(2).upper()
    elif at_least_subj_m:
        pool["subject"] = at_least_subj_m.group(1).upper()
    elif additional_subj_m:
        pool["subject"] = additional_subj_m.group(1).upper()

    # Extract subject from "any 300/400 level CSC course" — overrides above if found
    subj_any_m = re.search(r'any\s+\d+[/\-]?\d*\+?\s*[-–]?\s*level\s+([A-Z]{2,4})\b', text, re.I)
    if subj_any_m:
        pool["subject"] = subj_any_m.group(1).upper()

    # Handle "300+" shorthand: min_level = 300, max_level = 499
    if level_filt_m and pool["min_level"] is None:
        raw = level_filt_m.group(0)
        if "+" in raw:
            pool["min_level"] = int(level_filt_m.group(1))
            pool["max_level"] = int(level_filt_m.group(1)) + 199

    return pool


def _extract_sub_constraints(text: str, elem: Tag) -> list[dict]:
    """
    Extract inline sub-constraints like:
      "At least 0.5 credit must come from 400-level courses"
      "No more than 0.5 credit of GGR courses may count"
      "at least 0.5 credit must come from CSC369H5 or ..."
    """
    subs = []

    # Pattern: "At least N credit[s] (must come from | from | of) [text]"
    for m in re.finditer(
        r'(at\s+least|no\s+more\s+than|maximum\s+of?)\s+(\d+\.?\d*)\s+credit[s]?'
        r'(?:\s+(?:must\s+come\s+from|from|of)\s+(.+?)(?=\.|At least|No more|$))?',
        text, re.I
    ):
        kind_raw = m.group(1).lower()
        n_sub = float(m.group(2))
        desc  = (m.group(3) or "").strip().rstrip(".")

        constraint = "at_least" if "at least" in kind_raw else "at_most"

        # Collect courses mentioned in this sub-phrase
        sub_courses = re.findall(r'[A-Z]{2,4}\d{3}[HY]\d', desc)
        # Also grab from links near this part of the text
        # (approximate: just collect codes that appear after the match position)
        level_m = re.search(r'(\d{3})[-/]?(\d{3})?\s*[-–]?\s*level', desc, re.I)
        subj_m  = re.search(r'\b([A-Z]{2,4})\s+course', desc, re.I)

        sub: dict = {
            "constraint": constraint,
            "n": n_sub,
            "description": desc,
        }
        if sub_courses:
            sub["courses"] = sub_courses
        if level_m:
            sub["min_level"] = int(level_m.group(1))
        if subj_m and subj_m.group(1).upper() in ("CSC", "ANT", "GGR", "PSY", "BIO",
                                                    "ECO", "MAT", "STA", "MGT", "CCT",
                                                    "DRE", "ENG", "DRS", "CHM", "PHY"):
            sub["subject"] = subj_m.group(1).upper()

        subs.append(sub)

    return subs


# ══════════════════════════════════════════════════════════════
# Step 4 — parse year groups from the full completion req HTML
# ══════════════════════════════════════════════════════════════

YEAR_LABELS = re.compile(
    r'^(first|second|third|fourth|higher|upper|third\s+[&and]+\s+fourth|'
    r'third\s*/\s*fourth|required\s+courses|foundation|core|field\s+days|'
    r'for\s+students|all\s+students)',
    re.I
)
NOTE_LABELS = re.compile(r'^note[s]?[:\s]?$', re.I)


def _is_year_header(p_tag: Tag) -> tuple[bool, str]:
    """Return (is_header, label_text) for a <p> tag."""
    strong = p_tag.find("strong")
    if not strong:
        return False, ""
    label = strong.get_text(strip=True).rstrip(":")
    if YEAR_LABELS.match(label):
        return True, label
    # Sometimes label includes inline content: "First Year: CSC108H5 ..."
    full_text = p_tag.get_text(" ", strip=True)
    m = re.match(
        r'^(First|Second|Third|Fourth|Higher|Upper|Third\s*[&/]\s*Fourth)\s+[Yy]ear[s]?',
        full_text
    )
    if m:
        return True, m.group(0).rstrip(":")
    return False, ""


def _is_note_header(p_tag: Tag) -> bool:
    strong = p_tag.find("strong")
    if not strong:
        return False
    return bool(NOTE_LABELS.match(strong.get_text(strip=True)))


def _parse_total_credits(first_p_text: str) -> tuple:
    """
    Extract (total_credits_dict, total_credits_note) from the first paragraph.

    Handles many forms:
      "7.5 credits are required."
      "7.0-7.5 credits are required."
      "At least 7.0 ENG credits, including at least 2.0 credits at the 300 level"
      "A minimum of 16.5 credits..."
      "4.0 ITA credits are required including at least 1.0 300/400 level credit."
      "2.0 FSL credits plus 2.0 FRC credits including 1.0 at the 300 level."
    """
    if not first_p_text:
        return None, None

    # Pattern 1: "At least N.N [SUBJ] credit[s]"
    at_least_m = re.match(
        r'(?:at\s+least|minimum\s+of)\s+(\d+\.?\d*)(?:\s*[-–]\s*(\d+\.?\d*))?\s+(?:[A-Z]{2,4}\s+)?credit[s]?\b',
        first_p_text, re.I
    )
    # Pattern 2: "N.N [SUBJ] credit[s] are required"
    required_m = re.search(
        r'(\d+\.?\d*)(?:\s*[-–]\s*(\d+\.?\d*))?\s+(?:[A-Z]{2,4}\s+)?(?:total\s+)?credit[s]?\s+are\s+required\b',
        first_p_text, re.I
    )
    # Pattern 2b: "This program has a total of N.N credit[s]"
    total_of_m = re.search(
        r'(?:total\s+of|a\s+total\s+of)\s+(\d+\.?\d*)(?:\s*[-–]\s*(\d+\.?\d*))?\s+credit[s]?\b',
        first_p_text, re.I
    )
    # Pattern 3: "N.N [SUBJ] credit[s]" standalone at start of string (first occurrence)
    standalone_m = re.match(
        r'(\d+\.?\d*)(?:\s*[-–]\s*(\d+\.?\d*))?\s+(?:[A-Z]{2,4}\s+)?credit[s]?\b',
        first_p_text, re.I
    )

    m = at_least_m or required_m or total_of_m or standalone_m
    if not m:
        return None, None

    lo = float(m.group(1))
    hi = float(m.group(2)) if m.lastindex >= 2 and m.group(2) else None
    total_credits = {"min": lo, "max": hi}

    # Extract a note = everything after "credits are required" or after the main credit clause
    note = None
    # Try stripping "N.N credits are required." prefix
    rest = re.sub(
        r'^.*?(?:[A-Z]{2,4}\s+)?credit[s]?\s+are\s+required[.,]?\s*',
        '', first_p_text, flags=re.I, count=1
    ).strip()
    if rest and rest != first_p_text:
        note = rest or None
    elif at_least_m:
        # The whole line IS the note (e.g. "At least 7.0 ENG credits, including ...")
        # store the full line as the note
        note = first_p_text

    return total_credits, note


def parse_completion_html(html: str) -> dict:
    """
    Parse the full completion-requirement HTML into a ProgramRequirements dict.
    """
    soup = BeautifulSoup(html, "html.parser")
    inner = soup.find(class_="field__item")
    if not inner:
        return {"total_credits": None, "total_credits_note": None,
                "groups": [], "notes": []}

    children = [c for c in inner.children
                if not (isinstance(c, NavigableString) and not c.strip())]

    # ── parse total credits line ──────────────────────────────────────────────
    total_credits = None
    total_credits_note = None
    first_p_text = ""

    # Also accept <div> containers (some programs wrap content in a div)
    CREDIT_QUICK = re.compile(r'\d+\.?\d*\s+(?:[A-Z]{2,4}\s+)?credit[s]?\b', re.I)
    for child in children:
        if not isinstance(child, Tag):
            continue
        if child.name not in ("p", "div"):
            continue
        # For div, only use if it contains text (not just nested elements)
        if child.name == "div":
            direct_text = "".join(
                str(n) for n in child.children if isinstance(n, NavigableString)
            ).strip()
            if not direct_text:
                # Check for inner <p>
                inner_p = child.find("p")
                if inner_p:
                    t = inner_p.get_text(" ", strip=True)
                    if CREDIT_QUICK.search(t):
                        first_p_text = t
                        break
                continue
        t = child.get_text(" ", strip=True)
        if CREDIT_QUICK.search(t):
            first_p_text = t
            break

    total_credits, total_credits_note = _parse_total_credits(first_p_text)

    # ── walk children and build groups ───────────────────────────────────────
    groups: list[dict] = []
    notes: list[str]   = []
    in_notes           = False
    current_group      = {"label": "", "condition": None, "items": []}
    current_condition  = None

    def flush_group():
        if current_group["items"]:
            groups.append(dict(current_group))

    def add_item(item):
        if item is not None:
            current_group["items"].append(item)

    for child in children:
        if isinstance(child, NavigableString):
            continue

        if child.name == "br":
            continue

        # ── <p> element ───────────────────────────────────────────────────────
        if child.name == "p":
            text = child.get_text(" ", strip=True)
            if not text:
                continue

            # note section — only set in_notes=True if we already have group content,
            # otherwise a "Note:" at the top would swallow all subsequent year headers.
            if in_notes:
                t = re.sub(r'^note[s]?[:\s]*', '', text, flags=re.I).strip()
                if t:
                    notes.append(t)
                continue
            if _is_note_header(child):
                t = re.sub(r'^note[s]?[:\s]*', '', text, flags=re.I).strip()
                if t:
                    notes.append(t)
                # Only lock into notes mode if groups have already started
                if groups or current_group["items"]:
                    in_notes = True
                continue

            # year header
            is_hdr, label = _is_year_header(child)
            if is_hdr:
                flush_group()
                # Check if the <p> also has inline courses after the header
                strong = child.find("strong")
                inline_text = text[len(strong.get_text(strip=True)):].strip().lstrip(":").strip()
                current_group = {"label": label, "condition": current_condition, "items": []}
                current_condition = None
                if inline_text:
                    # treat it as an inline item in this group
                    item = parse_item(child)
                    if item and item.get("type") != "text" or (item and item.get("courses")):
                        add_item(item)
                continue

            # conditional track label (e.g. "For students admitted to UTM...")
            if text.lower().startswith("for students") or \
               text.lower().startswith("all students"):
                current_condition = text
                continue

            # skip the very first total-credits line
            if total_credits and text == first_p_text:
                continue

            # otherwise treat as a requirement item in the current group
            item = parse_item(child)
            add_item(item)

        # ── <ol> / <ul> ───────────────────────────────────────────────────────
        elif child.name in ("ol", "ul"):
            for li in child.find_all("li", recursive=False):
                li_text = li.get_text(" ", strip=True)
                if not li_text:
                    continue
                if in_notes:
                    notes.append(li_text)
                    continue

                # Check for a nested sub-list inside this <li>.
                # If the <li> has a direct child <ul>/<ol>, it represents a grouped
                # structure (e.g. "3.0 credits distributed among groups 1-6: <ul>…</ul>").
                # Expand the sub-items rather than collapsing all courses into one n_from.
                sub_list = li.find(["ul", "ol"], recursive=False)
                if sub_list:
                    # Parse each sub-list item individually
                    sub_items_added = 0
                    for sub_li in sub_list.find_all("li", recursive=False):
                        sub_text = sub_li.get_text(" ", strip=True)
                        if not sub_text:
                            continue
                        sub_item = parse_item(sub_li)
                        add_item(sub_item)
                        sub_items_added += 1
                    # If no sub-items were produced, fall back to parsing the whole <li>
                    if sub_items_added == 0:
                        item = parse_item(li)
                        add_item(item)
                else:
                    item = parse_item(li)
                    add_item(item)

        # ── <div> fallback (some programs use divs) ───────────────────────────
        elif child.name == "div":
            text = child.get_text(" ", strip=True)
            if not text:
                continue
            if in_notes or text.lower().startswith("note"):
                in_notes = True
                t = re.sub(r'^note[s]?[:\s]*', '', text, flags=re.I).strip()
                if t:
                    notes.append(t)
            else:
                item = parse_item(child)
                add_item(item)

    flush_group()

    # ── if no groups were produced but first_p described requirements (open pool
    #    with subject / level constraints), add it as a group item so the UI has
    #    something to display.  This covers single-paragraph programs like
    #    "4.0 PHL credits including at least 1.0 at the 300/400 level."
    if not groups and first_p_text and total_credits:
        # Re-find the paragraph element to get a proper Tag for parse_item
        first_p_elem = None
        for child in children:
            if isinstance(child, Tag) and child.name in ("p", "div"):
                t = child.get_text(" ", strip=True)
                if t == first_p_text:
                    first_p_elem = child
                    break
        if first_p_elem is not None:
            item = parse_item(first_p_elem)
            # Only add if it produced something useful (not just a bare course node
            # that would mis-represent the requirement)
            if item and item.get("type") in ("open_pool", "n_from", "text"):
                groups = [{"label": "", "condition": None, "items": [item]}]

    # ── merge groups with same label (can happen with conditional tracks) ────
    merged: list[dict] = []
    for g in groups:
        if merged and merged[-1]["label"] == g["label"] and g["condition"] is None:
            merged[-1]["items"].extend(g["items"])
        else:
            merged.append(g)

    return {
        "total_credits": total_credits,
        "total_credits_note": total_credits_note,
        "groups": merged,
        "notes": notes,
    }


# ══════════════════════════════════════════════════════════════
# Step 5 — main
# ══════════════════════════════════════════════════════════════

def main():
    programs_path = Path(__file__).parent.parent / "data" / "programs.json"
    with open(programs_path) as f:
        programs = json.load(f)

    print(f"Fetching HTML for {len(programs)} programs …")
    html_cache = fetch_all_program_html(programs)

    print("\nParsing requirements …")
    output = []
    for p in programs:
        code = p["code"]
        html = html_cache.get(code, "")
        if html:
            structured = parse_completion_html(html)
        else:
            structured = {
                "total_credits": None, "total_credits_note": None,
                "groups": [], "notes": []
            }

        output.append({
            "code":        p["code"],
            "name":        p["name"],
            "type":        p["type"],
            "degree_type": p["degree_type"],
            "url":         p["url"],
            "program_areas": p["program_areas"],
            "description": p["description"],
            "enrolment_requirements_text":    p["enrolment_requirements_text"],
            "enrolment_requirements_courses": p["enrolment_requirements_courses"],
            "note":        p["note"],
            "completion":  structured,
        })

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nDone. {len(output)} programs → {OUTPUT_FILE}")

    # ── quick quality report ──────────────────────────────────────────────────
    text_nodes = sum(
        1 for p in output
        for g in p["completion"]["groups"]
        for item in g["items"]
        if item and item.get("type") == "text"
    )
    total_nodes = sum(
        1 for p in output
        for g in p["completion"]["groups"]
        for item in g["items"]
        if item
    )
    no_credits = sum(1 for p in output if p["completion"]["total_credits"] is None)
    print(f"  Fallback text nodes:  {text_nodes} / {total_nodes} ({100*text_nodes//max(total_nodes,1)}%)")
    print(f"  No credits parsed:    {no_credits} programs")


if __name__ == "__main__":
    main()
