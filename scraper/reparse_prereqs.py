#!/usr/bin/env python3
"""
Re-parse prerequisites_raw for all courses using an improved parser.

Fixes:
  1. "no prerequisite" text → []
  2. Strip "excluding ..." clauses (codes there are exclusions, not requirements)
  3. Strip "(or equivalent)", "permission of instructor/department", "minimum grade X%" noise
  4. Parse "X.X credit(s) in SUBJ at the N-level" → LEVEL_POOL nodes
  5. Parse "at least X.X credits from (A or B or C)" → LEVEL_POOL with specific_courses

Run: python3 scraper/reparse_prereqs.py
"""

import json, re
from pathlib import Path
from collections import defaultdict

DATA_DIR = Path(__file__).parent.parent / "data"

# ── Subject name → code mapping ───────────────────────────────────────────────
SUBJECT_NAME_MAP = {
    'anthropology': 'ANT', 'biology': 'BIO', 'chemistry': 'CHM',
    'cinema': 'CIN', 'economics': 'ECO', 'english': 'ENG',
    'environment': 'ENV', 'earth science': 'ERS', 'geography': 'GGR',
    'history': 'HIS', 'linguistics': 'LIN', 'mathematics': 'MAT',
    'management': 'MGT', 'philosophy': 'PHL', 'physics': 'PHY',
    'political science': 'POL', 'psychology': 'PSY', 'religion': 'RLG',
    'sociology': 'SOC', 'statistics': 'STA', 'french': 'FRE',
    'italian': 'ITA', 'art history': 'FAH', 'visual culture': 'VCC',
    'communication': 'CCT', 'women and gender': 'WGS', 'writing': 'WRI',
    'forensic science': 'FSC', 'archaeology': 'ANT',
}

# ── Tokenizer / Parser (same as before) ──────────────────────────────────────

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
            self.consume(TokenType.LPAREN)
            node = self.parse_expr()
            self.consume(TokenType.RPAREN)
            return node  # may be None if empty parens — that's fine, caller filters
        self.pos += 1; return None

# ── Level-pool extraction ─────────────────────────────────────────────────────

def parse_level_range(level_str):
    """'300' → (300,399), '300-400' → (300,499), '300/400' → (300,499), '200' → (200,299)"""
    level_str = level_str.strip()
    m = re.match(r'(\d)00\s*[-/]\s*(\d)00', level_str)
    if m:
        return int(m.group(1)) * 100, int(m.group(2)) * 100 + 99
    m = re.match(r'(\d)00', level_str)
    if m:
        base = int(m.group(1)) * 100
        return base, base + 99
    return None, None

def extract_subjects_from_text(text):
    """Extract UTM subject codes from text like 'LIN' or 'Anthropology or Psychology'."""
    codes = re.findall(r'\b([A-Z]{2,4})\b', text)
    valid = [c for c in codes if 2 <= len(c) <= 4 and c.isupper() and c not in ('AND','OR','AT','IN','OF','THE')]
    if valid:
        return valid
    # Try name mapping
    found = []
    lower = text.lower()
    for name, code in SUBJECT_NAME_MAP.items():
        if name in lower and code not in found:
            found.append(code)
    return found or None

def extract_level_pools(text):
    """
    Find all "X.X credit(s) [at|in|from] [subjects] at the N[00]-level" patterns.
    Returns list of LEVEL_POOL nodes and the text with those patterns removed.
    """
    pools = []

    # Pattern: "X.X credit(s) [at|in|from] [optional subject] at the N[00][-N[00]] level"
    # Also: "at least X.X credit(s) from (...)"
    patterns = [
        # "1.0 credit in LIN at the 200-level"
        # "2.0 credits in 300-400 level Anthropology or Psychology courses"
        # "0.5 credit at a 300-level archaeology course"
        r'(?:at least\s+)?(\d+\.?\d*)\s+credits?\s+(?:at\s+(?:a\s+)?|in\s+|from\s+)?'
        r'(?:([A-Za-z,/ ]+?)\s+)?'
        r'(?:at\s+the\s+|at\s+a\s+)?'
        r'((?:\d00\s*[-/]\s*\d00|\d00))\s*[-/]?\s*(?:level|Level)',
    ]

    # Also: "X.X credits from (specific course list)" — treat as LEVEL_POOL with specific_courses
    # Pattern: "at least X.X credits from ( A or B or C )"
    specific_pattern = re.compile(
        r'(?:at least\s+)?(\d+\.?\d*)\s+credits?\s+from\s+\(([^)]+)\)',
        re.IGNORECASE
    )

    remaining = text
    for m in specific_pattern.finditer(text):
        n = float(m.group(1))
        inner = m.group(2)
        codes = re.findall(r'[A-Z]{3}\d{3}[HY]\d', inner.upper())
        if codes:
            pools.append({
                "type": "LEVEL_POOL",
                "n": n,
                "subjects": None,
                "min_level": None,
                "max_level": None,
                "specific_courses": codes,
            })
            remaining = remaining.replace(m.group(0), ' ')

    for pat in patterns:
        for m in re.finditer(pat, remaining, re.IGNORECASE):
            n = float(m.group(1))
            subj_text = (m.group(2) or '').strip().rstrip('at in from'.split()[0])
            level_text = m.group(3)
            min_lvl, max_lvl = parse_level_range(level_text)
            subjects = extract_subjects_from_text(subj_text) if subj_text else None
            if min_lvl:
                pools.append({
                    "type": "LEVEL_POOL",
                    "n": n,
                    "subjects": subjects,
                    "min_level": min_lvl,
                    "max_level": max_lvl,
                    "specific_courses": [],
                })
                remaining = remaining.replace(m.group(0), ' ')

    # "at least N credits in SUBJ" with no level specified → LEVEL_POOL with no level filter
    no_level_pattern = re.compile(
        r'(?:at\s+least\s+)?(\d+\.?\d*)\s+credits?\s+in\s+([A-Z]{2,4}(?:\s*/\s*[A-Z]{2,4})*)\b(?!\s+at\s+the)',
        re.IGNORECASE
    )
    for m in no_level_pattern.finditer(remaining):
        n = float(m.group(1))
        subj_text = m.group(2)
        subjects = [s.strip() for s in re.split(r'[/,]', subj_text) if s.strip()]
        pools.append({
            "type": "LEVEL_POOL",
            "n": n,
            "subjects": subjects if subjects else None,
            "min_level": None,
            "max_level": None,
            "specific_courses": [],
        })
        remaining = remaining.replace(m.group(0), ' ')

    return pools, remaining

# ── Credit node injection ─────────────────────────────────────────────────────

def extract_credits_node(text):
    """Extract any 'N credits' threshold requirement, return (node, remaining_text)."""
    patterns = [
        r'(?:minimum\s+of\s+|minimum\s+)([\d.]+)\s+(?:full\s+)?credits?',
        r'(?:at\s+least\s+)([\d.]+)(?:\s+and\s+not\s+more\s+than\s+[\d.]+)?\s+(?:full\s+)?credits?',
        r'(?:completion\s+of\s+(?:at\s+least\s+)?)([\d.]+)(?:\s+and\s+not\s+more\s+than\s+[\d.]+)?\s+(?:full\s+)?credits?',
        r'(?:successfully\s+completed\s+(?:at\s+least\s+)?)([\d.]+)\s+(?:full\s+)?credits?',
        r'\bany\s+([\d.]+)\s+(?:full\s+)?credits?',
        r'^([\d.]+)\s+(?:full\s+)?credits?',  # "4.0 full credits, including..."
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return {"type": "CREDITS", "minimum": float(m.group(1))}
    return None

def extract_including_courses(text):
    """
    For 'N credits including X and Y' patterns, return the required course nodes
    that come after 'including'. These must be AND-ed with the CREDITS node.
    """
    m = re.search(
        r'(?:credits?)\s*,?\s*including\s+([^.;]+)',
        text, re.IGNORECASE
    )
    if not m:
        return []
    including_text = m.group(1)
    codes = re.findall(r'[A-Z]{3}\d{3}[HY]\d', including_text.upper())
    if not codes:
        return []
    # If "or" separates them → OR node; if "and" (or just listing) → individual AND operands
    if re.search(r'\bor\b', including_text, re.IGNORECASE) and len(codes) > 1:
        return [{"type": "OR", "operands": [{"type": "COURSE", "code": c} for c in codes]}]
    return [{"type": "COURSE", "code": c} for c in codes]

def extract_embedded_pools(text):
    """
    Find '(N.N credit from X, Y, Z)' or 'N.N credit from X or Y or Z' patterns
    embedded mid-expression. Returns (pool_nodes, cleaned_text).
    """
    pools = []
    # Match "N.N credit[s] from X , Y , Z" or "N.N credit[s] from X or Y or Z"
    pat = re.compile(
        r'(\d+\.?\d*)\s+credits?\s+from\s+((?:[A-Z]{3}\d{3}[HY]\d[\s,or]*)+)',
        re.IGNORECASE
    )
    remaining = text
    for m in pat.finditer(text):
        n = float(m.group(1))
        codes = re.findall(r'[A-Z]{3}\d{3}[HY]\d', m.group(2).upper())
        if codes:
            pools.append({
                "type": "LEVEL_POOL",
                "n": n,
                "subjects": None,
                "min_level": None,
                "max_level": None,
                "specific_courses": codes,
            })
            remaining = remaining.replace(m.group(0), ' ')
    return pools, remaining

# ── Main preprocessing ────────────────────────────────────────────────────────

def preprocess(raw):
    """
    Clean up raw prerequisite text before tokenizing.
    Returns (cleaned_text, extra_nodes) where extra_nodes are LEVEL_POOL/CREDITS
    nodes that should be AND-ed with the parsed result.
    """
    if not raw:
        return '', []

    extra_nodes = []

    # 1. "no prerequisite[s]" anywhere → no requirements
    if re.search(r'\bno prerequisites?\b', raw, re.IGNORECASE):
        return '', []

    # 1b. Normalize grade conditions: drop the threshold, keep the course code.
    # "a minimum grade of 60% in CHM120H5" → "CHM120H5"
    raw = re.sub(
        r'(?:a\s+)?minimum\s+grade\s+of\s+[\d.]+%?\s+in\s+(?=[A-Z]{3}\d{3}[HY]\d)',
        '', raw, flags=re.IGNORECASE
    )

    # 2. Extract credit threshold + any "including X and Y" required courses
    credits_node = extract_credits_node(raw)
    if credits_node:
        extra_nodes.append(credits_node)
        including_nodes = extract_including_courses(raw)
        extra_nodes.extend(including_nodes)

    # 3a. Extract embedded "(N.N credit from X, Y, Z)" pools before level-pool extraction
    embedded_pools, raw = extract_embedded_pools(raw)
    extra_nodes.extend(embedded_pools)

    # 3b. Extract level-pool requirements
    pools, raw = extract_level_pools(raw)
    extra_nodes.extend(pools)

    # 4. Strip petition/exception sentences (e.g. ENG "Students who do not meet the prerequisite...")
    raw = re.sub(
        r'[Ss]tudents?\s+who\s+do\s+not\s+meet[^.]*\.?',
        ' ', raw, flags=re.IGNORECASE
    )
    raw = re.sub(
        r'[Oo]pen\s+to\s+students?\s+who\s+have\s+successfully\s+completed[^.]*\.',
        ' ', raw, flags=re.IGNORECASE
    )

    # 4b. Strip "excluding ..." clauses (they belong in exclusions, not prereqs)
    raw = re.sub(r'\bexcluding\b[^.;()]*', ' ', raw, flags=re.IGNORECASE)

    # 5. Strip advisory/noise phrases
    noise = [
        r'\bor\s+permission\s+of\s+(?:the\s+)?(?:instructor|department|program)[^,;.()]*',
        r'\bwith\s+permission\s+of[^,;.()]*',
        r'\b\(?or\s+equivalent\)?',
        r'\bminimum\s+grade\s+of\s+\d+%[^,;.()]*',
        r'\bwith\s+a\s+minimum\s+grade\s+of[^,;.()]*',
        r'\bminimum\s+of\s+[\d.]+\s+(?:full\s+)?credits?(?:\s*,?\s*including[^.;()]*)?',
        r'\bat\s+least\s+[\d.]+(?:\s+and\s+not\s+more\s+than\s+[\d.]+)?\s+(?:full\s+)?credits?(?:\s*,?\s*including[^.;()]*)?',
        r'\bcompletion\s+of\s+(?:at\s+least\s+)?[\d.]+(?:\s+and\s+not\s+more\s+than\s+[\d.]+)?\s+(?:full\s+)?credits?[^,;.()\[\]]*',
        r'\bsuccessfully\s+completed\s+(?:at\s+least\s+)?[\d.]+\s+(?:full\s+)?credits?[^,;.()\[\]]*',
        r'\bany\s+[\d.]+\s+(?:full\s+)?credits?[^,;.()\[\]]*',
        r'^[\d.]+\s+(?:full\s+)?credits?(?:\s*,?\s*including[^.;()]*)?',
        r'\b[\d.]+\s+(?:full\s+)?credits?(?:\s*,?\s*including[^.;()]*)?',  # remaining credit phrases
        r'\bor\s+equivalent\b[^,;.()]*',
        r'\bdepartmental\s+approval\b[^,;.()]*',
        r'\bco-?requisite[^.;]*',
    ]
    for pat in noise:
        raw = re.sub(pat, ' ', raw, flags=re.IGNORECASE)

    # 6. Clean up leftover punctuation artifacts
    raw = re.sub(r'\band\s*[,;]\s*', 'and ', raw)
    raw = re.sub(r'[,;]\s*and\b', ' and', raw)
    raw = re.sub(r'\s+', ' ', raw).strip()
    raw = raw.strip('., ;')

    return raw, extra_nodes

def build_ast(raw_text, extra_nodes):
    cleaned, extra = preprocess(raw_text)
    extra_nodes = extra  # replace with what preprocess found

    tokens = tokenize(cleaned)
    ast = Parser(tokens).parse() if tokens else None

    all_nodes = []
    if extra_nodes:
        all_nodes.extend(extra_nodes)
    if ast:
        all_nodes.append(ast)

    if not all_nodes:
        return []
    if len(all_nodes) == 1:
        return all_nodes[0]
    # Flatten nested ANDs
    flat = []
    for n in all_nodes:
        if isinstance(n, dict) and n.get('type') == 'AND':
            flat.extend(n['operands'])
        else:
            flat.append(n)
    return {"type": "AND", "operands": flat}

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    courses = json.load(open(DATA_DIR / 'courses.json'))

    changed = 0
    unfixable = []  # codes where result still seems wrong

    for c in courses:
        raw = c.get('prerequisites_raw', '')
        if not raw:
            continue

        new_ast = build_ast(raw, [])
        old_ast = c.get('prerequisites')

        # Detect if anything changed
        if json.dumps(new_ast, sort_keys=True) != json.dumps(old_ast, sort_keys=True):
            c['prerequisites'] = new_ast
            changed += 1

        # Flag for manual review: raw has content but AST is empty, or vice versa
        has_codes = bool(re.findall(r'[A-Z]{3}\d{3}[HY]\d', raw))
        ast_is_empty = not new_ast or new_ast == []
        if has_codes and ast_is_empty and not re.search(r'\bno prerequisites?\b', raw, re.IGNORECASE):
            unfixable.append((c['code'], raw[:120]))

    print(f"Updated {changed} courses.")
    print(f"Flagged {len(unfixable)} for manual review:")
    for code, raw in unfixable[:30]:
        print(f"  {code}: {raw}")

    courses.sort(key=lambda c: c['code'])

    paths = [
        DATA_DIR / 'courses.json',
        DATA_DIR.parent / 'app' / 'public' / 'data' / 'courses.json',
        DATA_DIR.parent / '.claude' / 'worktrees' / 'relaxed-shannon-73ac30' / 'data' / 'courses.json',
        DATA_DIR.parent / '.claude' / 'worktrees' / 'relaxed-shannon-73ac30' / 'app' / 'public' / 'data' / 'courses.json',
    ]
    for path in paths:
        if path.parent.exists():
            with open(path, 'w') as f:
                json.dump(courses, f)
            print(f"Saved {path}")

if __name__ == '__main__':
    main()
