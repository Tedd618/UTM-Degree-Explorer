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
        # Skip leading AND/OR/orphan-RP operators (can appear when credit/level-pool
        # text is removed, or when the raw text has mismatched brackets like
        # "[ A and B ) and [ C and D ]" — common in user-authored prereq strings).
        nodes = []
        while self.peek():
            # Skip orphan operators / unmatched RPAREN at top level
            while self.peek() and self.peek().type in (TokenType.AND, TokenType.OR, TokenType.RPAREN):
                self.pos += 1
            if not self.peek(): break
            n = self.parse_expr()
            if n: nodes.append(n)
        if not nodes: return None
        if len(nodes) == 1: return nodes[0]
        # Multiple top-level expressions — AND them together
        ops = []
        for n in nodes:
            if isinstance(n, dict) and n.get('type') == 'AND': ops.extend(n['operands'])
            else: ops.append(n)
        return {"type": "AND", "operands": ops}
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

# ── Phantom code pruning ─────────────────────────────────────────────────────

def prune_phantom_codes(node, valid_codes):
    """
    Recursively remove COURSE nodes whose code is not in valid_codes.
    - In an OR node: drop phantom operands (if all are phantom, return None)
    - In an AND node: drop phantom operands (they were retired alternatives;
      if all are phantom, return None)
    - In LEVEL_POOL specific_courses: remove phantom entries
    Returns the pruned node, or None if the entire node should be removed.
    """
    if node is None or node == []:
        return node
    if isinstance(node, list):
        pruned = [prune_phantom_codes(n, valid_codes) for n in node]
        pruned = [n for n in pruned if n is not None]
        return pruned if pruned else []
    if not isinstance(node, dict):
        return node

    t = node.get('type')
    if t == 'COURSE':
        return node if node['code'] in valid_codes else None

    if t in ('AND', 'OR'):
        pruned_ops = []
        for op in node.get('operands', []):
            pruned = prune_phantom_codes(op, valid_codes)
            if pruned is not None:
                pruned_ops.append(pruned)
        if not pruned_ops:
            return None
        if len(pruned_ops) == 1:
            return pruned_ops[0]
        return {**node, 'operands': pruned_ops}

    if t == 'LEVEL_POOL':
        sc = node.get('specific_courses') or []
        pruned_sc = [c for c in sc if c in valid_codes]
        return {**node, 'specific_courses': pruned_sc}

    return node  # CREDITS, RAW — pass through


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

    # "N.N SUBJ credits" — subject code before the word credits (e.g. "1.5 RLG credits")
    subj_first_pattern = re.compile(
        r'(\d+\.?\d*)\s+([A-Z]{2,4})\s+credits?\b',
        re.IGNORECASE
    )
    # Words that are not subject codes but could appear before "credits"
    _NOT_SUBJECTS = {'AND', 'OR', 'AT', 'IN', 'OF', 'THE', 'ANY', 'FULL', 'ADDITIONAL',
                     'MORE', 'HALF', 'FAH', 'VCC', 'NEW', 'ALL', 'HIS'}
    for m in subj_first_pattern.finditer(remaining):
        subj = m.group(2).upper()
        if subj in _NOT_SUBJECTS:
            continue
        n = float(m.group(1))
        pools.append({
            "type": "LEVEL_POOL",
            "n": n,
            "subjects": [subj],
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
    For 'N credits including X and Y' or 'N credits, which must include X and Y' patterns,
    return the required course nodes that come after 'including'. AND-ed with the CREDITS node.
    """
    m = re.search(
        r'(?:credits?)\s*[,;]?\s*(?:including|which\s+must\s+include)\s+([^.;]+)',
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
    Find '(N.N credit from X, Y, Z)' or 'N.N credit from X or Y or Z' or
    'N.N credit from X and Y and Z' patterns embedded mid-expression.
    Returns (pool_nodes, cleaned_text).
    """
    pools = []
    # Match "N.N credit[s] from X , Y , Z" or "N.N credit[s] from X or Y or Z" or "from X and Y"
    pat = re.compile(
        r'(\d+\.?\d*)\s+credits?\s+from\s+((?:[A-Z]{3}\d{3}[HY]\d[\s,]*(?:and|or)?[\s,]*)+)',
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

    # 1a. Normalize cross-listed slash notation: "DRE/ ENG121H5" → "(DRE121H5 or ENG121H5)"
    # Only when followed by a course code (not subject-only slashes like CHM/JCP/FSC)
    raw = re.sub(
        r'([A-Z]{2,4})/\s*([A-Z]{3})(\d{3}[HY]\d)',
        r'(\1\3 or \2\3)',
        raw
    )
    # Strip "COURSE / (or equivalent)" — the "/" before "(or equivalent)" becomes a phantom OR token
    raw = re.sub(r'/\s*\(\s*or\s+equivalent\s*\)', ' ', raw, flags=re.IGNORECASE)
    # Strip remaining subject-only slashes like CHM/JCP/JBC that produce phantom OR tokens
    # Pattern: consecutive subject codes (2-4 caps) separated by "/" with no following digit
    raw = re.sub(r'(?:[A-Z]{2,4}/)+[A-Z]{2,4}(?=\s|$)', ' ', raw)

    # 1b. Normalize grade conditions: drop the threshold, keep the course code.
    # "a minimum grade of 60% in CHM120H5" → "CHM120H5"
    raw = re.sub(
        r'(?:a\s+)?minimum\s+grade\s+of\s+[\d.]+%?\s+in\s+(?=[A-Z]{3}\d{3}[HY]\d)',
        '', raw, flags=re.IGNORECASE
    )
    # Also handle "COURSE with a minimum grade of X%" → keep just COURSE
    raw = re.sub(
        r'(\b[A-Z]{3}\d{3}[HY]\d)\s+with\s+a\s+minimum\s+grade\s+of\s+[\d.]+%?',
        r'\1', raw, flags=re.IGNORECASE
    )

    # 1c. Strip "Open to students who have successfully completed" preamble ONLY
    # (keep what follows — the actual prereqs)
    raw = re.sub(
        r'Open\s+to\s+students?\s+who\s+have\s+successfully\s+completed\s*',
        '', raw, flags=re.IGNORECASE
    )

    # 1d. Strip asterisk note lines: "* COURSE will no longer be accepted..." advisory notes
    # These appear inline or on new lines and contain course codes that pollute the AST.
    # Pattern: "* TEXT" until end of line or end of string
    raw = re.sub(r'\*[^\n]*', ' ', raw)
    # Also strip newlines (they sometimes separate the note from the prereq)
    raw = raw.replace('\n', ' ')

    # 1f. Handle "Completion of X" clauses at the start of a sentence/clause.
    # Only strip "Completion of" when it precedes a paren group (course list) or single course,
    # but NOT when it's "Completion of N credits" (that's a credit threshold, handled above).
    # Insert "and" between consecutive "Completion of (...)" clauses.
    raw = re.sub(
        r'(\([^)]*\)|\b[A-Z]{3}\d{3}[HY]\d)\s+([Cc]ompletion\s+of\s+\()',
        r'\1 and \2',
        raw
    )
    # Strip "Completion of " only before "(" (paren group), not before credit numbers
    raw = re.sub(r'[Cc]ompletion\s+of\s+(?=\()', '', raw)

    # 1e. Normalize ", and" (comma-and) → " and" at sentence boundaries to help
    # patterns like "A or B, and C or D" → "A or B and C or D" (handled by parse_term)

    # 2. Extract credit threshold + any "including X and Y" or "which must include X" required courses
    credits_node = extract_credits_node(raw)
    if credits_node:
        extra_nodes.append(credits_node)
    # Extract "including X" courses regardless of whether there's a credits threshold
    # (handles "9.0 credits including GGR276H5 or STA256H5" where the threshold pattern doesn't match)
    including_nodes = extract_including_courses(raw)
    extra_nodes.extend(including_nodes)

    # 3a. Extract embedded "(N.N credit from X, Y, Z)" pools before level-pool extraction
    embedded_pools, raw = extract_embedded_pools(raw)
    extra_nodes.extend(embedded_pools)

    # 3b. Extract level-pool requirements
    pools, raw = extract_level_pools(raw)
    extra_nodes.extend(pools)

    # 3c. Rewrite "and one of the following [courses]: A or B or C" →
    # "and ( A or B or C )" so the parser correctly groups the OR under AND.
    # The "one of" is a disambiguating phrase that the parser doesn't see.
    def wrap_one_of(m):
        # m.group(1) is everything after the colon/phrase until end or next AND
        # We wrap it in parens so the parser sees "and ( A or B or C )"
        rest = m.group(1).strip().rstrip('.')
        return f' and ( {rest} )'
    raw = re.sub(
        r'\band\s+one\s+of\s+the\s+following(?:\s+courses?)?:\s*([^.]+)',
        wrap_one_of, raw, flags=re.IGNORECASE
    )
    raw = re.sub(
        r'\band\s+any\s+one\s+of(?:\s+the\s+following(?:\s+courses?)?)?\s*:?\s*([^.]+)',
        wrap_one_of, raw, flags=re.IGNORECASE
    )
    # Also handle standalone "one of the following:" without leading "and"
    raw = re.sub(r'\bone\s+of\s+the\s+following(?:\s+courses?)?:\s*', ' ', raw, flags=re.IGNORECASE)

    # 4. Strip petition/exception sentences
    raw = re.sub(
        r'[Ss]tudents?\s+who\s+do\s+not\s+meet[^.]*\.?',
        ' ', raw, flags=re.IGNORECASE
    )
    # Strip "Students seeking ... must (also) have completed COURSE" sentences
    raw = re.sub(
        r'[Ss]tudents?\s+seeking[^.]*\.',
        ' ', raw, flags=re.IGNORECASE
    )
    # Strip "Enrolment in ... Program" administrative notes
    raw = re.sub(
        r'[Ee]nrolment\s+in[^.]*\.',
        ' ', raw, flags=re.IGNORECASE
    )

    # 4b. Strip "excluding ..." clauses (they belong in exclusions, not prereqs)
    raw = re.sub(r'\bexcluding\b[^.;()]*', ' ', raw, flags=re.IGNORECASE)

    # 5. Strip advisory/noise phrases
    # Fix: strip "(or equivalent)" WITH the surrounding parens first, so no dangling "(" is left
    raw = re.sub(r'\(\s*or\s+equivalent\s*\)', ' ', raw, flags=re.IGNORECASE)
    noise = [
        r'\bor\s+permission\s+of\s+(?:the\s+)?(?:instructor|department|program)[^,;.()]*',
        r'\bpermission\s+of\s+(?:the\s+)?(?:instructor|department|program|[Uu]niversity)[^,;.()]*',
        r'\bwith\s+permission\s+of[^,;.()]*',
        r'\b\(?or\s+equivalent\)?',
        r'\bminimum\s+grade\s+of\s+\d+%[^,;.()]*',
        r'\bwith\s+a\s+minimum\s+grade\s+of[^,;.()]*',
        r'\bminimum\s+of\s+[\d.]+\s+(?:full\s+)?credits?(?:\s*[,;]?\s*(?:including|which\s+must\s+include)[^.;()]*)?',
        r'\bat\s+least\s+[\d.]+(?:\s+and\s+not\s+more\s+than\s+[\d.]+)?\s+(?:full\s+)?credits?(?:\s*[,;]?\s*(?:including|which\s+must\s+include)[^.;()]*)?',
        r'\bcompletion\s+of\s+(?:at\s+least\s+)?[\d.]+(?:\s+and\s+not\s+more\s+than\s+[\d.]+)?\s+(?:full\s+)?credits?[^,;.()\[\]]*',
        r'\bsuccessfully\s+completed\s+(?:at\s+least\s+)?[\d.]+\s+(?:full\s+)?credits?[^,;.()\[\]]*',
        r'\bany\s+[\d.]+\s+(?:full\s+)?credits?[^,;.()\[\]]*',
        r'^[\d.]+\s+(?:full\s+)?credits?(?:\s*[,;]?\s*(?:including|which\s+must\s+include)[^.;()]*)?',
        r'\b[\d.]+\s+(?:full\s+)?credits?(?:\s*[,;]?\s*(?:including|which\s+must\s+include)[^.;()]*)?',  # remaining
        r'\bor\s+equivalent\b[^,;.()]*',
        r'\bdepartmental\s+approval\b[^,;.()]*',
        r'\bco-?requisite[^.;]*',
        r'\bCourse\s+application\s+is\s+required[^.]*\.',
        r'\bSee\s+the\s+[^.]*website[^.]*\.',
    ]
    for pat in noise:
        raw = re.sub(pat, ' ', raw, flags=re.IGNORECASE)

    # 5b. Strip "from any ... level courses" text left after level-pool extraction
    # e.g. "from any 300 or 400 level PHY/JCP courses" generates spurious OR tokens
    raw = re.sub(r'\bfrom\s+any\b[^.;()\[\]]*', ' ', raw, flags=re.IGNORECASE)

    # 5c. Strip all remaining "/" that are not between digit characters
    # (level ranges "300/400" are already extracted; leftover slashes in "Science/Geology" etc.
    #  generate spurious OR tokens in the tokenizer)
    raw = re.sub(r'(?<!\d)/(?!\d)', ' ', raw)

    # 6. Clean up leftover punctuation artifacts
    raw = re.sub(r'\band\s*[,;]\s*', 'and ', raw)
    raw = re.sub(r'[,;]\s*and\b', ' and', raw)
    raw = re.sub(r'\s+', ' ', raw).strip()
    raw = raw.strip('., ;')

    # 7. Strip leading/trailing "and" or "or" operators left after credit extraction
    # These cause the parser to misassociate subsequent tokens
    raw = re.sub(r'^(?:and|or)\s+', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\s+(?:and|or)$', '', raw, flags=re.IGNORECASE)

    return raw, extra_nodes

def build_ast(raw_text, extra_nodes, valid_codes=None):
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
        result = all_nodes[0]
    else:
        # Flatten nested ANDs
        flat = []
        for n in all_nodes:
            if isinstance(n, dict) and n.get('type') == 'AND':
                flat.extend(n['operands'])
            else:
                flat.append(n)
        result = {"type": "AND", "operands": flat}

    # Prune phantom codes (retired/UTSG courses not in our DB)
    if valid_codes is not None:
        result = prune_phantom_codes(result, valid_codes)
        if result is None:
            return []

    return result

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    courses = json.load(open(DATA_DIR / 'courses.json'))
    valid_codes = {c['code'] for c in courses}

    changed = 0
    unfixable = []  # codes where result still seems wrong

    for c in courses:
        raw = c.get('prerequisites_raw', '')
        if not raw:
            continue

        new_ast = build_ast(raw, [], valid_codes=valid_codes)
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
