#!/usr/bin/env python3
"""
UTM Course Scraper
Extracts all course data from https://utm.calendar.utoronto.ca/course-search
and saves to ../data/courses.json

Usage:
    pip install requests beautifulsoup4
    python3 scrape_courses.py

Resumes from where it left off if interrupted (progress saved to courses_progress.json).
"""

import json
import os
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://utm.calendar.utoronto.ca"
SEARCH_URL = f"{BASE_URL}/course-search"
TOTAL_PAGES = 82  # pages 0..81
DELAY_SECONDS = 1.0

OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "courses.json"
PROGRESS_FILE = Path(__file__).parent / "courses_progress.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def infer_credits(code: str) -> float:
    """H5 = 0.5 credits, Y5 = 1.0 credit."""
    if re.search(r'Y\d+$', code):
        return 1.0
    return 0.5


def extract_course_codes(field_tag) -> tuple[list[str], str]:
    """
    Given a BeautifulSoup tag containing a prerequisite/exclusion/etc. field,
    return (utm_codes, raw_text).

    UTM courses are linked with relative /course/... paths.
    Cross-campus courses link to external calendars — we keep the code but
    flag it in raw_text.
    """
    if field_tag is None:
        return [], ""

    raw = field_tag.get_text(separator=" ", strip=True)
    utm_codes = []
    for a in field_tag.find_all("a"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if href.startswith("/course/"):
            # UTM-internal course
            code = href.split("/course/")[-1].upper()
            utm_codes.append(code)
        # Cross-campus codes (artsci, utsc) are visible in raw_text but not added
        # to utm_codes since we can't validate them against our dataset.
    return utm_codes, raw


def parse_course(row_soup) -> dict | None:
    """
    Parse a single course from a views-row div on the listing page.
    Returns a dict or None if parsing fails.
    """
    # Course code + title from the accordion header aria-label
    header = row_soup.find("h3", class_="js-views-accordion-group-header")
    if not header:
        return None
    label_div = header.find("div", attrs={"aria-label": True})
    if not label_div:
        return None

    aria = label_div["aria-label"]  # "ANT201H5 - Introduction to Archaeology"
    # Split on first " - " or " • " (the page uses bullet in display text but
    # aria-label uses " - ")
    m = re.match(r'^([A-Z]{3}\d{3}[HY]\d)\s*[-•]\s*(.+)$', aria.strip())
    if not m:
        return None
    code = m.group(1).strip()
    title = m.group(2).strip()

    def get_field(css_suffix: str):
        tag = row_soup.find(class_=f"views-field-{css_suffix}")
        if tag is None:
            return tag
        # The actual content lives in the .field-content child
        content = tag.find(class_="field-content")
        return content if content else tag

    # Description
    desc_tag = get_field("field-desc")
    description = desc_tag.get_text(strip=True) if desc_tag else ""

    # Prerequisites
    prereq_tag = get_field("field-prerequisite")
    prereq_utm, prereq_raw = extract_course_codes(prereq_tag)

    # Exclusions
    excl_tag = get_field("field-exclusion")
    excl_utm, excl_raw = extract_course_codes(excl_tag)

    # Recommended preparation
    prep_tag = get_field("field-recommended-preparation")
    prep_utm, prep_raw = extract_course_codes(prep_tag)

    # Distribution requirement
    dist_tag = get_field("field-distribution-requirements")
    distribution = dist_tag.get_text(strip=True) if dist_tag else ""

    # Hours
    hours_tag = get_field("field-hours")
    hours = hours_tag.get_text(strip=True) if hours_tag else ""

    # Mode of delivery
    delivery_tag = get_field("field-mode-of-delivery")
    delivery = delivery_tag.get_text(strip=True) if delivery_tag else ""

    # Notes
    note_tag = get_field("field-note")
    note = note_tag.get_text(strip=True) if note_tag else ""

    # Boolean flags
    exp_tag = get_field("field-course-experience")
    has_experiential = bool(exp_tag and exp_tag.get_text(strip=True))

    intl_tag = get_field("field-international-component")
    has_international = bool(intl_tag and intl_tag.get_text(strip=True))

    return {
        "code": code,
        "title": title,
        "description": description,
        "credits": infer_credits(code),
        "prerequisites": prereq_utm,
        "prerequisites_raw": prereq_raw,
        "exclusions": excl_utm,
        "exclusions_raw": excl_raw,
        "recommended_preparation": prep_utm,
        "recommended_preparation_raw": prep_raw,
        "distribution": distribution,
        "hours": hours,
        "delivery": delivery,
        "note": note,
        "has_experiential": has_experiential,
        "has_international": has_international,
    }


def scrape_page(session: requests.Session, page: int) -> list[dict]:
    """Fetch one listing page and return all parsed courses."""
    url = f"{SEARCH_URL}?page={page}"
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # The outer view-content div contains all course rows
    view_content = soup.find(class_="view-content")
    if not view_content:
        print(f"  WARNING: no view-content on page {page}")
        return []

    # Each course is wrapped in a top-level views-row that contains an h3
    # followed by a nested views-row with the detail fields.
    # We select the outer rows that have an h3 header.
    courses = []
    for row in view_content.find_all("div", class_="views-row", recursive=False):
        parsed = parse_course(row)
        if parsed:
            courses.append(parsed)

    return courses


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load progress (resume support)
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            progress = json.load(f)
        all_courses: list[dict] = progress["courses"]
        completed_pages: set[int] = set(progress["completed_pages"])
        print(f"Resuming from progress file — {len(completed_pages)} pages done, "
              f"{len(all_courses)} courses so far.")
    else:
        all_courses = []
        completed_pages = set()

    session = requests.Session()

    for page in range(TOTAL_PAGES):
        if page in completed_pages:
            continue

        print(f"Scraping page {page + 1}/{TOTAL_PAGES} (?page={page})...", end=" ")
        try:
            courses = scrape_page(session, page)
            all_courses.extend(courses)
            completed_pages.add(page)
            print(f"{len(courses)} courses (total: {len(all_courses)})")
        except requests.RequestException as e:
            print(f"\nERROR on page {page}: {e}")
            print("Saving progress and exiting. Re-run to resume.")
            break

        # Save progress after every page
        with open(PROGRESS_FILE, "w") as f:
            json.dump({"completed_pages": sorted(completed_pages), "courses": all_courses}, f)

        if page < TOTAL_PAGES - 1:
            time.sleep(DELAY_SECONDS)

    # Deduplicate (by code, keep last seen — later pages shouldn't duplicate but just in case)
    seen: dict[str, dict] = {}
    for c in all_courses:
        seen[c["code"]] = c
    unique_courses = sorted(seen.values(), key=lambda c: c["code"])

    with open(OUTPUT_FILE, "w") as f:
        json.dump(unique_courses, f, indent=2, ensure_ascii=False)

    print(f"\nDone! {len(unique_courses)} unique courses saved to {OUTPUT_FILE}")

    if len(completed_pages) == TOTAL_PAGES:
        PROGRESS_FILE.unlink(missing_ok=True)
        print("Progress file removed (scrape complete).")


if __name__ == "__main__":
    main()
