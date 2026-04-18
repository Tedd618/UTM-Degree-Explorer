#!/usr/bin/env python3
"""
UTM Program & Certificate Scraper
Extracts all program/certificate data from https://utm.calendar.utoronto.ca/program-search
and saves to ../data/programs.json

Usage:
    python3 scrape_programs.py

Resumes from where it left off if interrupted (progress saved to programs_progress.json).

Data fields per program:
  code              - e.g. "ERMAJ1775"
  name              - e.g. "Anthropology"
  type              - "Major" | "Minor" | "Specialist" | "Certificate"
  degree_type       - "Arts" | "Science" | null (certificates have no degree type)
  program_areas     - list of program area strings, e.g. ["Anthropology"]
  description       - optional description text
  enrolment_requirements_text   - plain text of enrolment rules
  enrolment_requirements_courses - UTM course codes found in enrolment section
  completion_requirements_text  - plain text of completion rules
  completion_requirements_courses - UTM course codes found in completion section
  note              - optional note text
  url               - relative URL, e.g. "/program/ermaj1775"
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

BASE_URL = "https://utm.calendar.utoronto.ca"
SEARCH_URL = f"{BASE_URL}/program-search"
TOTAL_PAGES = 6   # pages 0..5
DELAY_SECONDS = 1.0

OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "programs.json"
PROGRESS_FILE = Path(__file__).parent / "programs_progress.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


# ──────────────────────────────────────────────
# Parsing helpers
# ──────────────────────────────────────────────

def extract_utm_codes(tag) -> list[str]:
    """Return sorted unique UTM course codes linked via /course/... hrefs."""
    if tag is None:
        return []
    codes = []
    for a in tag.find_all("a"):
        href = a.get("href", "")
        if href.startswith("/course/"):
            code = href.split("/course/")[-1].upper()
            codes.append(code)
    # Deduplicate preserving order
    seen = set()
    result = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return result


def collect_after_label(label_tag) -> list[Tag | NavigableString]:
    """
    Given a <strong class="views-label views-label-field-X"> tag, collect
    all following siblings until the next views-label strong or the end of
    the parent.
    """
    siblings = []
    for sib in label_tag.next_siblings:
        if isinstance(sib, Tag):
            if "views-label" in sib.get("class", []):
                break
            # Stop at the code/area footer line (contains /program/ link)
            if sib.name == "br":
                # peek ahead — if next meaningful sibling is the /program/ link, stop
                peek = sib.next_sibling
                while peek and isinstance(peek, NavigableString) and not peek.strip():
                    peek = peek.next_sibling
                if peek and isinstance(peek, Tag) and peek.name == "a":
                    href = peek.get("href", "")
                    if "/program/" in href:
                        break
        siblings.append(sib)
    return siblings


def siblings_to_soup(siblings) -> BeautifulSoup:
    """Wrap a list of siblings into a BeautifulSoup fragment for text/link extraction."""
    html = "".join(str(s) for s in siblings)
    return BeautifulSoup(html, "html.parser")


def get_label_content(inner_row: Tag, label_suffix: str):
    """
    Find the views-label strong for the given suffix and return
    (text: str, soup_fragment: BeautifulSoup | None).
    Returns ("", None) if the label is absent.
    """
    label = inner_row.find(
        "strong",
        class_=lambda c: c and f"views-label-{label_suffix}" in c
    )
    if label is None:
        return "", None
    siblings = collect_after_label(label)
    if not siblings:
        return "", None
    frag = siblings_to_soup(siblings)
    text = frag.get_text(separator=" ", strip=True)
    return text, frag


def parse_program_title(aria_label: str) -> dict:
    """
    Parse an aria-label into structured fields.

    Majors/Minors/Specialists:
        "Anthropology - Major (Arts) - ERMAJ1775"
        "Computer Science - Co-op (Science) - ERMAJ1070"
    Certificates:
        "Certificate in Advanced Economics - ERCER1478"
        "Professional Experience Certificate in Digital Media... - ERCER1033"
    """
    aria_label = aria_label.strip()

    # Pattern: "Name - Type (DegreeType) - CODE"
    m = re.match(
        r'^(.+?)\s*-\s*(Major|Minor|Specialist|Co-op)\s*\((.+?)\)\s*-\s*(ER\w+)$',
        aria_label
    )
    if m:
        return {
            "name": m.group(1).strip(),
            "type": m.group(2).strip(),
            "degree_type": m.group(3).strip(),
            "code": m.group(4).strip(),
        }

    # Pattern: "... Certificate ... - CODE"
    m = re.match(r'^(.+?)\s*-\s*(ER\w+)$', aria_label)
    if m:
        name_part = m.group(1).strip()
        code = m.group(2).strip()
        # Determine type: if name contains "Certificate" it's a certificate
        prog_type = "Certificate" if "Certificate" in name_part else "Program"
        return {
            "name": name_part,
            "type": prog_type,
            "degree_type": None,
            "code": code,
        }

    # Fallback
    return {
        "name": aria_label,
        "type": "Unknown",
        "degree_type": None,
        "code": "",
    }


def parse_footer(inner_row: Tag) -> tuple[str, list[str], str]:
    """
    Extract (program_code, program_areas, url) from the footer line at the
    bottom of each program entry:
      <a href="/program/ermaj1775">ERMAJ1775</a> | Program Area: <a ...>Anthropology</a>
    """
    # Find the /program/ link
    prog_link = inner_row.find("a", href=re.compile(r"^/program/"))
    if prog_link is None:
        return "", [], ""

    code = prog_link.get_text(strip=True).upper()
    url = prog_link.get("href", "")

    # Collect program area links that come after the program code link
    areas = []
    for sib in prog_link.next_siblings:
        if isinstance(sib, Tag) and sib.name == "a":
            href = sib.get("href", "")
            if "/section/" in href:
                areas.append(sib.get_text(strip=True))

    return code, areas, url


def parse_program(outer_row: Tag) -> dict | None:
    """Parse a single outer views-row (which contains an h3 + inner views-row)."""
    # Get aria-label from the h3
    header = outer_row.find("h3", class_="js-views-accordion-group-header")
    if not header:
        return None
    label_div = header.find("div", attrs={"aria-label": True})
    if not label_div:
        return None
    aria = label_div["aria-label"].strip()

    title_fields = parse_program_title(aria)
    if not title_fields["code"]:
        return None

    # The inner views-row holds all the detail fields
    inner_row = outer_row.find("div", class_="views-row")
    if not inner_row:
        return None

    description, _ = get_label_content(inner_row, "field-description")
    enrol_text, enrol_frag = get_label_content(inner_row, "field-enrolment-requirements")
    completion_text, completion_frag = get_label_content(inner_row, "field-completion-req")
    note, _ = get_label_content(inner_row, "field-program-note")

    enrol_courses = extract_utm_codes(enrol_frag)
    completion_courses = extract_utm_codes(completion_frag)

    # Footer: code, areas, url
    footer_code, program_areas, url = parse_footer(inner_row)
    # Prefer the footer code (always uppercase) over the parsed title code
    code = footer_code or title_fields["code"]

    return {
        "code": code,
        "name": title_fields["name"],
        "type": title_fields["type"],
        "degree_type": title_fields["degree_type"],
        "url": url,
        "program_areas": program_areas,
        "description": description,
        "enrolment_requirements_text": enrol_text,
        "enrolment_requirements_courses": enrol_courses,
        "completion_requirements_text": completion_text,
        "completion_requirements_courses": completion_courses,
        "note": note,
    }


def scrape_page(session: requests.Session, page: int) -> list[dict]:
    url = f"{SEARCH_URL}?page={page}"
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    view_content = soup.find(class_="view-content")
    if not view_content:
        print(f"  WARNING: no view-content on page {page}")
        return []

    programs = []
    for row in view_content.find_all("div", class_="views-row", recursive=False):
        parsed = parse_program(row)
        if parsed:
            programs.append(parsed)

    return programs


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            progress = json.load(f)
        all_programs: list[dict] = progress["programs"]
        completed_pages: set[int] = set(progress["completed_pages"])
        print(f"Resuming — {len(completed_pages)} pages done, {len(all_programs)} programs so far.")
    else:
        all_programs = []
        completed_pages = set()

    session = requests.Session()

    for page in range(TOTAL_PAGES):
        if page in completed_pages:
            continue

        print(f"Scraping page {page + 1}/{TOTAL_PAGES} (?page={page})...", end=" ")
        try:
            programs = scrape_page(session, page)
            all_programs.extend(programs)
            completed_pages.add(page)
            print(f"{len(programs)} programs (total: {len(all_programs)})")
        except requests.RequestException as e:
            print(f"\nERROR on page {page}: {e}")
            print("Saving progress and exiting. Re-run to resume.")
            break

        with open(PROGRESS_FILE, "w") as f:
            json.dump({"completed_pages": sorted(completed_pages), "programs": all_programs}, f)

        if page < TOTAL_PAGES - 1:
            time.sleep(DELAY_SECONDS)

    # Deduplicate by code
    seen: dict[str, dict] = {}
    for p in all_programs:
        seen[p["code"]] = p
    unique = sorted(seen.values(), key=lambda p: p["code"])

    with open(OUTPUT_FILE, "w") as f:
        json.dump(unique, f, indent=2, ensure_ascii=False)

    print(f"\nDone! {len(unique)} unique programs saved to {OUTPUT_FILE}")

    if len(completed_pages) == TOTAL_PAGES:
        PROGRESS_FILE.unlink(missing_ok=True)
        print("Progress file removed (scrape complete).")


if __name__ == "__main__":
    main()
