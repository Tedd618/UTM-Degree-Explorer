#!/usr/bin/env python3
"""
Scraper for UTM courses that exist as individual pages but are missing
from the paginated course-search listing.

Usage:
    python3 scrape_missing_courses.py

Probes all likely-missing codes (gaps and 100-level courses for each
subject prefix), fetches individual course pages, parses them properly,
and merges them into data/courses.json.
"""

import json, re, time, sys
from pathlib import Path
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://utm.calendar.utoronto.ca"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
DATA_DIR = Path(__file__).parent.parent / "data"

# ─── Prereq AST (same as main scraper) ──────────────────────────────────────

class TokenType:
    AND = 'AND'; OR = 'OR'; LPAREN = 'LPAREN'; RPAREN = 'RPAREN'; COURSE = 'COURSE'

class Token:
    def __init__(self, t, v): self.type = t; self.value = v

def tokenize(text):
    pattern = re.compile(
        r'([A-Z]{3}\d{3}[HY]\d)'
        r'|(\b(?:and|plus)\b|&)'
        r'|(\bor\b|/)'
        r'|([\(\[])'
        r'|([\)\]])',
        re.IGNORECASE
    )
    tokens = []
    for m in pattern.finditer(text):
        if m.group(1): tokens.append(Token(TokenType.COURSE, m.group(1).upper()))
        elif m.group(2): tokens.append(Token(TokenType.AND, 'and'))
        elif m.group(3): tokens.append(Token(TokenType.OR, 'or'))
        elif m.group(4): tokens.append(Token(TokenType.LPAREN, '('))
        elif m.group(5): tokens.append(Token(TokenType.RPAREN, ')'))
    return tokens

class Parser:
    def __init__(self, tokens): self.tokens = tokens; self.pos = 0
    def peek(self): return self.tokens[self.pos] if self.pos < len(self.tokens) else None
    def consume(self, t):
        tok = self.peek()
        if tok and tok.type == t: self.pos += 1; return tok
        return None
    def parse(self):
        if not self.tokens: return None
        return self.parse_expr()
    def parse_expr(self):
        nodes = [self.parse_term()]
        while self.peek() and self.peek().type == TokenType.OR:
            self.consume(TokenType.OR); nodes.append(self.parse_term())
        nodes = [n for n in nodes if n]
        if not nodes: return None
        if len(nodes) == 1: return nodes[0]
        ops = []
        for n in nodes:
            if isinstance(n, dict) and n.get('type') == 'OR': ops.extend(n['operands'])
            else: ops.append(n)
        return {"type": "OR", "operands": ops}
    def parse_term(self):
        nodes = [self.parse_factor()]
        while self.peek() and self.peek().type == TokenType.AND:
            self.consume(TokenType.AND); nodes.append(self.parse_factor())
        while self.peek() and self.peek().type in (TokenType.COURSE, TokenType.LPAREN):
            nodes.append(self.parse_factor())
        nodes = [n for n in nodes if n]
        if not nodes: return None
        if len(nodes) == 1: return nodes[0]
        ops = []
        for n in nodes:
            if isinstance(n, dict) and n.get('type') == 'AND': ops.extend(n['operands'])
            else: ops.append(n)
        return {"type": "AND", "operands": ops}
    def parse_factor(self):
        tok = self.peek()
        if not tok: return None
        if tok.type == TokenType.COURSE:
            self.consume(TokenType.COURSE); return {"type": "COURSE", "code": tok.value}
        if tok.type == TokenType.LPAREN:
            self.consume(TokenType.LPAREN); node = self.parse_expr(); self.consume(TokenType.RPAREN); return node
        self.pos += 1; return None

def build_ast(raw_text, flat_codes):
    if not flat_codes: return []
    tokens = tokenize(raw_text)
    ast = Parser(tokens).parse()
    if ast: return ast
    return {"type": "RAW", "codes": flat_codes}

def infer_credits(code):
    return 1.0 if re.search(r'Y\d+$', code) else 0.5

# ─── Individual page parser ───────────────────────────────────────────────────

def field_text(soup, field_name):
    """Extract text from a field--name-field-{field_name} div."""
    tag = soup.find('div', class_=re.compile(rf'field--name-field-{field_name}'))
    if not tag: return ''
    # Remove the label span (field__label)
    for label in tag.find_all(class_='field__label'):
        label.decompose()
    return tag.get_text(separator=' ', strip=True)

def field_links(soup, field_name):
    """Extract (utm_codes, raw_text) from a field with course links."""
    tag = soup.find('div', class_=re.compile(rf'field--name-field-{field_name}'))
    if not tag: return [], ''
    for label in tag.find_all(class_='field__label'):
        label.decompose()
    raw = tag.get_text(separator=' ', strip=True)
    utm_codes = []
    for a in tag.find_all('a'):
        href = a.get('href', '')
        if href.startswith('/course/'):
            utm_codes.append(href.split('/course/')[-1].upper())
    return utm_codes, raw

def fetch_and_parse(session, code):
    """Fetch an individual course page and parse it. Returns dict or None."""
    url = f"{BASE_URL}/course/{code.lower()}"
    try:
        r = session.get(url, headers=HEADERS, timeout=20)
    except Exception:
        return None

    if r.status_code != 200:
        return None

    soup = BeautifulSoup(r.text, 'html.parser')

    # Confirm the page is for a real course (not 404)
    title_tag = soup.find('title')
    if not title_tag or 'Page not found' in title_tag.get_text():
        return None

    # Extract course code + title from <title> or h1
    page_title = title_tag.get_text(strip=True).replace(' | Academic Calendar', '')
    m = re.match(r'^([A-Z]{3}\d{3}[HY]\d)\s*[•\-]\s*(.+)$', page_title)
    if not m:
        # Try h1
        h1 = soup.find('h1', class_=re.compile('page-title|node-title|title'))
        if h1:
            m = re.match(r'^([A-Z]{3}\d{3}[HY]\d)\s*[•\-]\s*(.+)$', h1.get_text(strip=True))
    if not m:
        return None

    actual_code = m.group(1).strip()
    title = m.group(2).strip()

    # Description (strip the "Description" label that Drupal prepends)
    desc = field_text(soup, 'desc')
    desc = re.sub(r'^Description\s*', '', desc, flags=re.IGNORECASE).strip()

    # Prerequisites
    prereq_codes, prereq_raw = field_links(soup, 'prerequisite')
    prereq_raw = re.sub(r'^Prerequisites?\s*', '', prereq_raw, flags=re.IGNORECASE).strip()
    prereq_ast = build_ast(prereq_raw, prereq_codes) if prereq_raw else []

    # Exclusions
    excl_codes, excl_raw = field_links(soup, 'exclusion')
    excl_raw = re.sub(r'^Exclusions?\s*', '', excl_raw, flags=re.IGNORECASE).strip()

    # Recommended preparation
    prep_codes, prep_raw = field_links(soup, 'recommended-preparation')
    prep_raw = re.sub(r'^Recommended Preparation\s*', '', prep_raw, flags=re.IGNORECASE).strip()

    # Distribution
    dist = field_text(soup, 'distribution-requirements')
    dist = re.sub(r'^Distribution Requirement\s*', '', dist, flags=re.IGNORECASE).strip()

    # Hours
    hours = field_text(soup, 'hours')
    hours = re.sub(r'^Total Instructional Hours\s*', '', hours, flags=re.IGNORECASE).strip()

    # Delivery
    delivery = field_text(soup, 'mode-of-delivery')
    delivery = re.sub(r'^Mode of Delivery\s*', '', delivery, flags=re.IGNORECASE).strip()

    return {
        "code": actual_code,
        "title": title,
        "description": desc,
        "credits": infer_credits(actual_code),
        "prerequisites": prereq_ast,
        "prerequisites_raw": prereq_raw,
        "exclusions": excl_codes,
        "exclusions_raw": excl_raw,
        "recommended_preparation": prep_codes,
        "recommended_preparation_raw": prep_raw,
        "distribution": dist,
        "hours": hours,
        "delivery": delivery,
        "note": "",
        "has_experiential": False,
        "has_international": False,
    }

# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    with open(DATA_DIR / 'courses.json') as f:
        courses = json.load(f)
    existing = {c['code'] for c in courses}

    from collections import defaultdict
    subject_nums = defaultdict(set)
    for code in existing:
        m = re.match(r'^([A-Z]{3})(\d{3})([HY]\d)$', code)
        if m:
            subject_nums[m.group(1)].add(int(m.group(2)))

    # Generate candidates: 100-level gaps + within-range gaps
    candidates = set()
    for subj, nums in subject_nums.items():
        mn = min(nums)
        mx = max(nums)
        for lvl in range(100, mn):
            candidates.add(f"{subj}{lvl:03d}H5")
            candidates.add(f"{subj}{lvl:03d}Y5")
        for lvl in range(mn, mx + 1):
            if lvl not in nums:
                candidates.add(f"{subj}{lvl:03d}H5")
                candidates.add(f"{subj}{lvl:03d}Y5")
    candidates -= existing
    candidates = sorted(candidates)

    print(f"Probing {len(candidates)} candidate course codes...")

    session = requests.Session()
    found = []

    for i, code in enumerate(candidates):
        result = fetch_and_parse(session, code)
        if result:
            found.append(result)
            print(f"  FOUND [{i+1}/{len(candidates)}]: {result['code']} - {result['title'][:60]}")
        elif (i + 1) % 100 == 0:
            print(f"  ... {i+1}/{len(candidates)} checked, {len(found)} found")
        time.sleep(0.35)

    print(f"\nFound {len(found)} missing courses.")

    if not found:
        print("Nothing to add.")
        return

    # Merge into courses list
    existing_map = {c['code']: c for c in courses}
    added = 0
    for c in found:
        if c['code'] not in existing_map:
            courses.append(c)
            added += 1
            print(f"  + {c['code']}: {c['title']}")

    # Re-sort
    courses.sort(key=lambda c: c['code'])

    # Write both locations
    for path in [DATA_DIR / 'courses.json', DATA_DIR.parent / 'app' / 'public' / 'data' / 'courses.json']:
        with open(path, 'w') as f:
            json.dump(courses, f)
    print(f"\nAdded {added} courses. Total: {len(courses)}. Saved to data/courses.json and app/public/data/courses.json")

if __name__ == '__main__':
    main()
