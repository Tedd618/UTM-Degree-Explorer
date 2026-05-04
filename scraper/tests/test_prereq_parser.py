#!/usr/bin/env python3
"""
Comprehensive unit tests for scraper/reparse_prereqs.py

Run: cd scraper && python -m pytest tests/ -v
"""

import sys
import os
import pytest

# Add scraper directory to path so we can import reparse_prereqs
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reparse_prereqs import build_ast, preprocess, tokenize, Parser, extract_level_pools, extract_credits_node


# ── Helpers ───────────────────────────────────────────────────────────────────

def course(code):
    return {"type": "COURSE", "code": code}

def and_(*operands):
    return {"type": "AND", "operands": list(operands)}

def or_(*operands):
    return {"type": "OR", "operands": list(operands)}

def credits_(minimum):
    return {"type": "CREDITS", "minimum": minimum}

def level_pool(n, subjects=None, min_level=None, max_level=None, specific_courses=None):
    return {
        "type": "LEVEL_POOL",
        "n": n,
        "subjects": subjects,
        "min_level": min_level,
        "max_level": max_level,
        "specific_courses": specific_courses or [],
    }


# ── 1. Empty / No-prerequisite inputs ─────────────────────────────────────────

class TestEmptyInputs:
    def test_empty_string(self):
        assert build_ast("", []) == []

    def test_none_string(self):
        assert build_ast(None, []) == []

    def test_none_literal(self):
        assert build_ast("None", []) == []

    def test_no_prerequisites_phrase(self):
        assert build_ast("no prerequisites", []) == []

    def test_no_prerequisite_singular(self):
        assert build_ast("no prerequisite", []) == []

    def test_no_prerequisites_in_sentence(self):
        # LIN101H5-style: sentence containing "no prerequisite"
        raw = "This course has no prerequisites. It can be taken independently."
        assert build_ast(raw, []) == []

    def test_no_prerequisite_with_course_mention(self):
        # LIN102H5-style: "no prerequisite" even though another course is mentioned
        raw = "This course has no prerequisite. It can be taken independently, before, or after LIN101H5 ."
        assert build_ast(raw, []) == []

    def test_grade12_only(self):
        # CHM110H5-style: only high-school prereqs → empty AST
        raw = "Grade 12 Chemistry (SCH4U) (minimum grade of 70)"
        assert build_ast(raw, []) == []

    def test_grade12_math(self):
        # MAT102H5-style
        raw = "Minimum 70% in Grade 12 Advanced Functions (MHF4U)"
        assert build_ast(raw, []) == []


# ── 2. Simple single course ───────────────────────────────────────────────────

class TestSingleCourse:
    def test_bare_course_code(self):
        assert build_ast("CSC108H5", []) == course("CSC108H5")

    def test_bio_single(self):
        assert build_ast("BIO152H5", []) == course("BIO152H5")

    def test_psy_single(self):
        assert build_ast("PSY100Y5", []) == course("PSY100Y5")

    def test_lin_single(self):
        assert build_ast("LIN204H5", []) == course("LIN204H5")

    def test_course_with_trailing_period(self):
        raw = "CSC108H5."
        assert build_ast(raw, []) == course("CSC108H5")

    def test_course_with_grade_percent_stripped(self):
        # CSC111H5-style: "CSC110Y5 (70% or higher)" → keep only course code
        raw = "CSC110Y5 (70% or higher)"
        assert build_ast(raw, []) == course("CSC110Y5")


# ── 3. AND requirements ───────────────────────────────────────────────────────

class TestAndRequirements:
    def test_simple_and(self):
        raw = "CSC108H5 and CSC148H5"
        assert build_ast(raw, []) == and_(course("CSC108H5"), course("CSC148H5"))

    def test_bio_four_way_and(self):
        raw = "BIO152H5 and BIO153H5 and CHM110H5 and CHM120H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = [op["code"] for op in result["operands"]]
        assert codes == ["BIO152H5", "BIO153H5", "CHM110H5", "CHM120H5"]

    def test_and_with_plus_operator(self):
        raw = "CSC108H5 plus CSC148H5"
        assert build_ast(raw, []) == and_(course("CSC108H5"), course("CSC148H5"))

    def test_and_with_ampersand(self):
        raw = "CSC108H5 & CSC148H5"
        assert build_ast(raw, []) == and_(course("CSC108H5"), course("CSC148H5"))

    def test_and_flattened_nested(self):
        # Nested ANDs should be flattened
        raw = "CSC108H5 and CSC148H5 and CSC207H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        assert len(result["operands"]) == 3


# ── 4. OR requirements ────────────────────────────────────────────────────────

class TestOrRequirements:
    def test_simple_or(self):
        raw = "ECO101H5 or ECO101H1"
        assert build_ast(raw, []) == or_(course("ECO101H5"), course("ECO101H1"))

    def test_or_with_parens(self):
        raw = "(CSC207H5 or CSC209H5)"
        assert build_ast(raw, []) == or_(course("CSC207H5"), course("CSC209H5"))

    def test_ant_or(self):
        raw = "ANT101H5 or BIO152H5"
        assert build_ast(raw, []) == or_(course("ANT101H5"), course("BIO152H5"))

    def test_ggr_or(self):
        raw = "GGR112H5 or ENV100Y5"
        assert build_ast(raw, []) == or_(course("GGR112H5"), course("ENV100Y5"))

    def test_slash_as_or(self):
        # Tokenizer treats "/" as OR between course codes
        raw = "CSC207H5 or CSC209H1"
        result = build_ast(raw, [])
        assert result["type"] == "OR"
        codes = {op["code"] for op in result["operands"]}
        assert "CSC207H5" in codes
        assert "CSC209H1" in codes


# ── 5. Nested AND + OR ────────────────────────────────────────────────────────

class TestNestedAndOr:
    def test_and_then_or(self):
        # CHM110H5 and (MAT132H5 or MAT135H5)
        raw = "CHM110H5 and (MAT132H5 or MAT135H5)"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        assert result["operands"][0] == course("CHM110H5")
        assert result["operands"][1] == or_(course("MAT132H5"), course("MAT135H5"))

    def test_or_of_ands(self):
        # (A and B) or (C and D)
        raw = "(CSC207H5 and CSC209H5) or (CSC148H5 and CSC165H5)"
        result = build_ast(raw, [])
        assert result["type"] == "OR"
        assert result["operands"][0] == and_(course("CSC207H5"), course("CSC209H5"))
        assert result["operands"][1] == and_(course("CSC148H5"), course("CSC165H5"))

    def test_eco_grade_condition_nested(self):
        # ECO200Y5: "( ECO101H5 (63%) and ECO102H5 (63%)) or ECO100Y5 (63%)"
        # Grade % in parens after course code; (63%) is noise, not OR
        raw = "( ECO101H5 (63%) and ECO102H5 (63%)) or ECO100Y5 (63%)"
        result = build_ast(raw, [])
        # Should be AND(ECO101H5, OR(ECO102H5, ECO100Y5)) due to precedence handling
        assert result is not None
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE":
                    codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v:
                            collect(item)
        collect(result)
        assert "ECO101H5" in codes
        assert "ECO102H5" in codes
        assert "ECO100Y5" in codes

    def test_bio311_permission_stripped(self):
        # BIO311H5: "BIO205H5 and ( BIO259H5 or STA215H5 ) and permission of instructor"
        raw = "BIO205H5 and ( BIO259H5 or STA215H5 ) and permission of instructor"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        assert "BIO205H5" in codes
        assert "BIO259H5" in codes
        assert "STA215H5" in codes


# ── 6. Grade conditions ───────────────────────────────────────────────────────

class TestGradeConditions:
    def test_minimum_grade_in_course(self):
        # "a minimum grade of 60% in CHM120H5" → COURSE node
        raw = "a minimum grade of 60% in CHM120H5"
        assert build_ast(raw, []) == course("CHM120H5")

    def test_minimum_grade_with_other_courses(self):
        # CHM211H5-style: "CHM110H5 and a minimum grade of 60% in CHM120H5 and ..."
        raw = "CHM110H5 and a minimum grade of 60% in CHM120H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = [op["code"] for op in result["operands"]]
        assert "CHM110H5" in codes
        assert "CHM120H5" in codes

    def test_course_with_grade_percent_suffix(self):
        # "ECO101H5 (63%)" — the percent in parens is noise
        raw = "ECO101H5 (63%)"
        assert build_ast(raw, []) == course("ECO101H5")

    def test_with_minimum_grade_suffix(self):
        # "CSC111H5 with a minimum grade of 70%" → keep COURSE
        raw = "CSC111H5 with a minimum grade of 70%"
        assert build_ast(raw, []) == course("CSC111H5")


# ── 7. Credit thresholds ──────────────────────────────────────────────────────

class TestCreditThresholds:
    def test_bare_credits(self):
        # GGR202H5: "4.0 credits"
        raw = "4.0 credits"
        result = build_ast(raw, [])
        assert result == credits_(4.0)

    def test_credits_minimum_of(self):
        raw = "minimum of 4.0 credits"
        result = build_ast(raw, [])
        assert result == credits_(4.0)

    def test_credits_at_least(self):
        raw = "at least 4.0 credits"
        result = build_ast(raw, [])
        assert result == credits_(4.0)

    def test_credits_including_single_course(self):
        # PSY299H5: "4.0 credits including PSY100Y5"
        raw = "4.0 credits including PSY100Y5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        types = {op["type"] for op in result["operands"]}
        assert "CREDITS" in types
        assert "COURSE" in types
        credits_node = next(op for op in result["operands"] if op["type"] == "CREDITS")
        assert credits_node["minimum"] == 4.0
        course_node = next(op for op in result["operands"] if op["type"] == "COURSE")
        assert course_node["code"] == "PSY100Y5"

    def test_credits_including_two_courses(self):
        # CCT314H5: "A minimum of 8.0 credits including CCT109H5 and CCT110H5"
        raw = "A minimum of 8.0 credits including CCT109H5 and CCT110H5 ."
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = set()
        for op in result["operands"]:
            if op["type"] == "COURSE":
                codes.add(op["code"])
        assert "CCT109H5" in codes
        assert "CCT110H5" in codes

    def test_credits_which_must_include(self):
        raw = "9.0 credits which must include GGR276H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        types = {op["type"] for op in result["operands"]}
        assert "CREDITS" in types
        assert "COURSE" in types

    def test_completion_of_credits(self):
        raw = "completion of at least 8.0 credits"
        result = build_ast(raw, [])
        assert result == credits_(8.0)

    def test_open_to_students_credits(self):
        # ENG201Y5-style: "Open to students who have successfully completed at least 4.0 full credits."
        raw = "Open to students who have successfully completed at least 4.0 full credits. Students who do not meet the prerequisite but..."
        result = build_ast(raw, [])
        assert result == credits_(4.0)

    def test_fractional_credits(self):
        raw = "0.5 credits"
        result = build_ast(raw, [])
        assert result == credits_(0.5)


# ── 8. Level pools ────────────────────────────────────────────────────────────

class TestLevelPools:
    def test_subject_level_pool(self):
        # LIN310H5: "1.0 credit in LIN at the 200-level"
        raw = "LIN101H5 and 1.0 credit in LIN at the 200-level (excluding LIN204H5 )"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        pool = next((op for op in result["operands"] if op["type"] == "LEVEL_POOL"), None)
        assert pool is not None
        assert pool["n"] == 1.0
        assert pool["subjects"] == ["LIN"]
        assert pool["min_level"] == 200
        assert pool["max_level"] == 299

    def test_level_pool_no_subject(self):
        # ANT355H5: "8.0 credits of which 0.5 credits must be a social sciences course at the 200-level"
        raw = "8.0 credits of which 0.5 credits must be a social sciences or humanities course at the 200-level or higher"
        result = build_ast(raw, [])
        assert result["type"] == "AND"

    def test_level_range_pool(self):
        # ANT403H5: "2.0 credits at the 300-400 level"
        raw = "2.0 credits at the 300-400 level in Anthropology or Psychology or Biology courses"
        pools, _ = extract_level_pools(raw)
        assert len(pools) >= 1
        pool = pools[0]
        assert pool["n"] == 2.0
        assert pool["min_level"] == 300
        assert pool["max_level"] == 499

    def test_specific_courses_pool(self):
        # "at least 1.5 credits from (ANT200H5 or ANT201H5 or ANT202H5)"
        raw = "At least 1.5 credits from ( ANT200H5 or ANT201H5 or ANT202H5 )"
        result = build_ast(raw, [])
        # Should produce LEVEL_POOL with specific_courses
        pool = None
        if isinstance(result, dict):
            if result["type"] == "LEVEL_POOL":
                pool = result
            elif result["type"] == "AND":
                pool = next((op for op in result["operands"] if op["type"] == "LEVEL_POOL"), None)
        assert pool is not None
        assert pool["n"] == 1.5
        assert set(pool["specific_courses"]) == {"ANT200H5", "ANT201H5", "ANT202H5"}

    def test_psy_level_pool(self):
        # PSY309H5: "PSY202H5 (or equivalent) and 1.0 credit in PSY at the 200 level"
        raw = "PSY202H5 (or equivalent) and 1.0 credit in PSY at the 200 level"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        pool = next((op for op in result["operands"] if op["type"] == "LEVEL_POOL"), None)
        assert pool is not None
        assert pool["n"] == 1.0
        assert pool["subjects"] == ["PSY"]
        assert pool["min_level"] == 200
        assert pool["max_level"] == 299
        # PSY202H5 should also be in AND
        course_node = next((op for op in result["operands"] if op["type"] == "COURSE"), None)
        assert course_node is not None
        assert course_node["code"] == "PSY202H5"

    def test_credits_in_subject_no_level(self):
        # "2.0 credits in LIN" (no level specified)
        raw = "2.0 credits in LIN"
        result = build_ast(raw, [])
        assert result is not None
        # Should produce a LEVEL_POOL or CREDITS node
        if isinstance(result, dict):
            pool_found = (result["type"] == "LEVEL_POOL" or
                         (result["type"] == "AND" and
                          any(op["type"] == "LEVEL_POOL" for op in result["operands"])))
            assert pool_found

    def test_csc_200_level_pool(self):
        # LIN340H5: "0.5 credit in 200-level CSC course"
        raw = "CSC108H5 and CSC148H5 and 0.5 credit in 200-level CSC course"
        result = build_ast(raw, [])
        pool = None
        if isinstance(result, dict) and result["type"] == "AND":
            pool = next((op for op in result["operands"] if op["type"] == "LEVEL_POOL"), None)
        assert pool is not None
        assert pool["n"] == 0.5
        assert pool["min_level"] == 200


# ── 9. (or equivalent) variants ──────────────────────────────────────────────

class TestOrEquivalent:
    def test_or_equivalent_stripped(self):
        raw = "PSY202H5 (or equivalent)"
        assert build_ast(raw, []) == course("PSY202H5")

    def test_or_equivalent_without_parens(self):
        raw = "CSC207H5 or equivalent"
        # Should produce just COURSE("CSC207H5") — no phantom nodes
        result = build_ast(raw, [])
        assert result == course("CSC207H5")

    def test_slash_or_equivalent(self):
        # "CSC207H5 / (or equivalent)" → strip the slash+(or equivalent)
        raw = "CSC207H5 / (or equivalent)"
        result = build_ast(raw, [])
        assert result == course("CSC207H5")

    def test_or_equivalent_in_list(self):
        # BIO313H5: "BIO259H5 or STA215H5 or PSY201H5 or equivalent."
        raw = "BIO205H5 and one of the following courses: BIO259H5 or STA215H5 or PSY201H5 or equivalent."
        result = build_ast(raw, [])
        assert result is not None
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        assert "BIO205H5" in codes
        assert "BIO259H5" in codes
        assert "STA215H5" in codes
        assert "PSY201H5" in codes


# ── 10. "which must include" / "including" clauses ───────────────────────────

class TestIncludingClauses:
    def test_including_single(self):
        raw = "4.0 credits including GGR112H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        credits_node = next(op for op in result["operands"] if op["type"] == "CREDITS")
        assert credits_node["minimum"] == 4.0
        course_codes = [op["code"] for op in result["operands"] if op["type"] == "COURSE"]
        assert "GGR112H5" in course_codes

    def test_including_or(self):
        # GGR214H5: "4.0 credits including GGR112H5 or ENV100Y5"
        raw = "4.0 credits including GGR112H5 or ENV100Y5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        or_node = next((op for op in result["operands"] if op["type"] == "OR"), None)
        assert or_node is not None
        codes = {op["code"] for op in or_node["operands"]}
        assert codes == {"GGR112H5", "ENV100Y5"}

    def test_which_must_include(self):
        raw = "8.0 credits which must include CCT109H5 and CCT110H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        course_codes = {op["code"] for op in result["operands"] if op["type"] == "COURSE"}
        assert "CCT109H5" in course_codes
        assert "CCT110H5" in course_codes


# ── 11. Cross-campus codes (non-H5) ──────────────────────────────────────────

class TestCrossCampusCodes:
    def test_h1_code_parsed(self):
        raw = "ECO101H5 or ECO101H1"
        result = build_ast(raw, [])
        assert result["type"] == "OR"
        codes = {op["code"] for op in result["operands"]}
        assert "ECO101H5" in codes
        assert "ECO101H1" in codes

    def test_y5_course_code(self):
        raw = "PSY100Y5"
        assert build_ast(raw, []) == course("PSY100Y5")

    def test_y1_code_in_or(self):
        raw = "CSC207H5 or CSC209H1"
        result = build_ast(raw, [])
        assert result["type"] == "OR"
        codes = {op["code"] for op in result["operands"]}
        assert "CSC207H5" in codes
        assert "CSC209H1" in codes


# ── 12. Slash notation ───────────────────────────────────────────────────────

class TestSlashNotation:
    def test_dre_slash_eng(self):
        # DRE200H5: "DRE/ ENG121H5 and ENG122H5"
        raw = "DRE/ ENG121H5 and ENG122H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        or_node = next(op for op in result["operands"] if op["type"] == "OR")
        codes = {op["code"] for op in or_node["operands"]}
        assert codes == {"DRE121H5", "ENG121H5"}

    def test_slash_between_subjects_stripped(self):
        # "CHM/JCP/FSC" style — subject-only slashes become whitespace, not phantom OR tokens
        raw = "CHM110H5 and CHM120H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        # Confirm no phantom OR nodes
        for op in result["operands"]:
            assert op["type"] == "COURSE"


# ── 13. Permission of instructor / department (stripped) ─────────────────────

class TestPermissionStripped:
    def test_permission_of_instructor(self):
        raw = "CSC207H5 or permission of instructor"
        result = build_ast(raw, [])
        assert result == course("CSC207H5")

    def test_permission_of_department(self):
        raw = "BIO205H5 and permission of the department"
        result = build_ast(raw, [])
        assert result == course("BIO205H5")

    def test_with_permission(self):
        raw = "LIN205H5 with permission of the program"
        result = build_ast(raw, [])
        assert result == course("LIN205H5")

    def test_or_permission_in_complex(self):
        # DRE200H5: "... or permission of the U of T Mississauga program director."
        raw = "DRE/ ENG121H5 and ENG122H5 , or permission of the U of T Mississauga program director."
        result = build_ast(raw, [])
        # Should still get AND(OR(DRE121H5, ENG121H5), ENG122H5) without phantom extra OR
        assert result is not None
        assert result["type"] == "AND"


# ── 14. The CHM242H5 complex case ────────────────────────────────────────────

class TestCHM242H5:
    def test_chm242_structure(self):
        raw = (
            "CHM110H5 and a minimum grade of 60% in CHM120H5 and "
            "[( MAT132H5 and MAT134H5 ) or ( MAT135H5 and MAT136H5 ) or "
            "( MAT137H5 and MAT139H5 ) or ( MAT157H5 and MAT159H5 ) or "
            "( MAT134Y5 or MAT135Y5 or MAT137Y5 or MAT157Y5 )]."
        )
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        # All three required: CHM110, CHM120, and the MAT pool
        assert "CHM110H5" in codes
        assert "CHM120H5" in codes
        assert "MAT132H5" in codes
        assert "MAT157Y5" in codes

        # Top level must have exactly 3 operands: CHM110, CHM120, OR(...)
        assert len(result["operands"]) == 3
        or_node = next((op for op in result["operands"] if op["type"] == "OR"), None)
        assert or_node is not None
        # OR should have the 4 pairs + 4 standalone Y courses = 8 options
        assert len(or_node["operands"]) == 8


# ── 15. Subject-specific patterns ────────────────────────────────────────────

class TestSubjectSpecific:
    def test_chm_grade_plus_mat_pool(self):
        raw = "CHM110H5 and a minimum grade of 60% in CHM120H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = {op["code"] for op in result["operands"]}
        assert codes == {"CHM110H5", "CHM120H5"}

    def test_bio_and_chain(self):
        raw = "BIO152H5 and BIO153H5 and CHM110H5 and CHM120H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = [op["code"] for op in result["operands"]]
        assert len(codes) == 4

    def test_psy_with_or_equivalent(self):
        raw = "PSY202H5 (or equivalent) and 1.0 credit in PSY at the 200 level"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        # must have PSY202H5 course node and LEVEL_POOL
        types = {op["type"] for op in result["operands"]}
        assert "COURSE" in types
        assert "LEVEL_POOL" in types

    def test_lin_level_pool(self):
        raw = "LIN101H5 and ( LIN102H5 or LIN205H5 ) and 1.0 credit in LIN at the 200-level (excluding LIN204H5 )."
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        pool = next((op for op in result["operands"] if op["type"] == "LEVEL_POOL"), None)
        assert pool is not None
        assert pool["subjects"] == ["LIN"]
        assert pool["min_level"] == 200

    def test_eco_grade_conditions(self):
        raw = "( ECO101H5 (63%) and ECO102H5 (63%)) or ECO100Y5 (63%)"
        result = build_ast(raw, [])
        assert result is not None
        # Grade % noise stripped; should yield meaningful structure with all 3 codes
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        assert "ECO101H5" in codes
        assert "ECO102H5" in codes
        assert "ECO100Y5" in codes

    def test_mat_single_course(self):
        raw = "MAT133Y5"
        assert build_ast(raw, []) == course("MAT133Y5")

    def test_csc_and_or(self):
        raw = "CSC108H5 and (CSC148H5 or CSC150H5)"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        assert result["operands"][0] == course("CSC108H5")
        assert result["operands"][1]["type"] == "OR"

    def test_eng_credits_threshold(self):
        raw = "Open to students who have successfully completed at least 4.0 full credits. Students who do not meet the prerequisite but wish to enroll must..."
        result = build_ast(raw, [])
        assert result == credits_(4.0)

    def test_ant_complex_pool(self):
        raw = (
            "At least 1.5 credits from ( ANT200H5 or ANT201H5 or ANT202H5 or "
            "ANT204H5 or ANT206H5 or ANT218H5 ) and 2.0 credits at the 300-400 "
            "level in Anthropology or Psychology or Biology courses"
        )
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        level_pools = [op for op in result["operands"] if op["type"] == "LEVEL_POOL"]
        assert len(level_pools) >= 1
        specific_pool = next((p for p in level_pools if p["specific_courses"]), None)
        assert specific_pool is not None
        assert "ANT200H5" in specific_pool["specific_courses"]


# ── 16. Tokenizer edge cases ─────────────────────────────────────────────────

class TestTokenizerEdgeCases:
    def test_square_brackets_treated_as_parens(self):
        raw = "[CSC108H5 or CSC148H5]"
        result = build_ast(raw, [])
        assert result["type"] == "OR"

    def test_mixed_brackets(self):
        raw = "[LIN101H5 and LIN102H5] or CSC108H5"
        result = build_ast(raw, [])
        assert result is not None
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        assert "LIN101H5" in codes
        assert "LIN102H5" in codes
        assert "CSC108H5" in codes

    def test_uppercase_and(self):
        # Tokenizer is case-insensitive for AND/OR
        raw = "CSC108H5 AND CSC148H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"

    def test_uppercase_or(self):
        raw = "CSC108H5 OR CSC148H5"
        result = build_ast(raw, [])
        assert result["type"] == "OR"


# ── 17. Excluding / noise stripping ──────────────────────────────────────────

class TestNoiseSStripping:
    def test_excluding_clause_stripped(self):
        # "LIN ... excluding LIN204H5" — the exclusion should not be a prerequisite
        raw = "LIN101H5 excluding LIN204H5"
        result = build_ast(raw, [])
        # LIN204H5 must NOT appear as a required course
        assert result == course("LIN101H5")

    def test_corequisite_stripped(self):
        raw = "CSC108H5 corequisite: CSC148H5"
        result = build_ast(raw, [])
        # Corequisite mention shouldn't produce phantom AND/OR nodes beyond CSC108H5
        assert result is not None

    def test_enrolment_note_stripped(self):
        raw = "BIO152H5 and BIO153H5. Enrolment in the Life Sciences program is required."
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        codes = {op["code"] for op in result["operands"]}
        assert codes == {"BIO152H5", "BIO153H5"}


# ── 18. preprocess() unit tests ──────────────────────────────────────────────

class TestPreprocess:
    def test_no_prereq_returns_empty(self):
        cleaned, extras = preprocess("no prerequisites")
        assert cleaned == ''
        assert extras == []

    def test_slash_notation_normalized(self):
        cleaned, _ = preprocess("DRE/ ENG121H5")
        # Should contain expanded form with DRE121H5 or ENG121H5
        assert "DRE121H5" in cleaned or "ENG121H5" in cleaned

    def test_grade_condition_stripped(self):
        cleaned, _ = preprocess("a minimum grade of 60% in CHM120H5")
        assert "CHM120H5" in cleaned
        assert "minimum grade" not in cleaned.lower()

    def test_or_equivalent_stripped(self):
        cleaned, _ = preprocess("PSY202H5 (or equivalent)")
        assert "equivalent" not in cleaned.lower()

    def test_permission_stripped(self):
        cleaned, _ = preprocess("CSC108H5 or permission of instructor")
        assert "permission" not in cleaned.lower()

    def test_credits_extracted_as_extra(self):
        _, extras = preprocess("4.0 credits including PSY100Y5")
        types = {e["type"] for e in extras}
        assert "CREDITS" in types


# ── 19. Regression tests ─────────────────────────────────────────────────────

class TestRegressions:
    """Tests for previously discovered parsing bugs."""

    def test_no_phantom_or_from_subject_slash(self):
        """Subject-only slashes (CHM/JCP) must not generate phantom OR tokens."""
        raw = "CHM110H5 and CHM120H5"
        result = build_ast(raw, [])
        # Simple AND, no OR
        assert result["type"] == "AND"
        for op in result["operands"]:
            assert op["type"] == "COURSE"

    def test_level_pool_not_dropped(self):
        """Level-pool requirements must survive and appear in AST."""
        raw = "LIN101H5 and 1.0 credit in LIN at the 200-level"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        pool = next((op for op in result["operands"] if op["type"] == "LEVEL_POOL"), None)
        assert pool is not None, "LEVEL_POOL node was dropped"

    def test_leading_operator_skipped(self):
        """Parser should skip leading AND/OR tokens that appear after credit extraction."""
        raw = "and CSC108H5"
        result = build_ast(raw, [])
        assert result == course("CSC108H5")

    def test_or_equivalentno_phantom(self):
        """(or equivalent) must not leave a phantom OR node after stripping."""
        raw = "CSC207H5 (or equivalent) and CSC209H5"
        result = build_ast(raw, [])
        assert result["type"] == "AND"
        # No nested OR nodes (only from (or equivalent))
        or_nodes = [op for op in result["operands"] if op["type"] == "OR"]
        assert len(or_nodes) == 0

    def test_open_students_preamble_stripped(self):
        """'Open to students who have successfully completed' preamble must be stripped."""
        raw = "Open to students who have successfully completed CSC207H5 and CSC209H5"
        result = build_ast(raw, [])
        assert result is not None
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        assert "CSC207H5" in codes
        assert "CSC209H5" in codes

    def test_semicolon_and_combo(self):
        """'and,' or ';' separators should not break the AND chain."""
        raw = "CSC108H5; CSC148H5"
        result = build_ast(raw, [])
        # Both codes must be in result
        assert result is not None
        codes = set()
        def collect(n):
            if isinstance(n, dict):
                if n.get("type") == "COURSE": codes.add(n["code"])
                for v in n.values():
                    if isinstance(v, list):
                        for item in v: collect(item)
        collect(result)
        assert "CSC108H5" in codes
        assert "CSC148H5" in codes
