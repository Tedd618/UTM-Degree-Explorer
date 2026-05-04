/**
 * Comprehensive unit tests for app/src/utils/prereq.ts
 *
 * Run: cd app && npx vitest run
 */

import { describe, it, expect } from 'vitest'
import {
  evaluatePrereq,
  buildCodesBefore,
  getCourseStatus,
  formatPrereq,
  getMissingPrereqsStrings,
} from '../prereq'
import type { Course, Semester, PrereqNode } from '../../types'

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeCourse(code: string, credits = 0.5, overrides: Partial<Course> = {}): Course {
  return {
    code,
    title: code,
    description: '',
    credits,
    prerequisites: [],
    exclusions: [],
    recommended_preparation: [],
    distribution: '',
    hours: '',
    delivery: '',
    note: '',
    has_experiential: false,
    has_international: false,
    ...overrides,
  }
}

function makeSemester(id: string, year: number, season: 'Fall' | 'Winter' | 'Summer', courses: string[]): Semester {
  return { id, year, season, courses }
}

function makeCourseMap(courses: Course[]): Map<string, Course> {
  return new Map(courses.map(c => [c.code, c]))
}

// ── Helper nodes ──────────────────────────────────────────────────────────────

const courseNode = (code: string): PrereqNode => ({ type: 'COURSE', code })
const andNode = (...operands: PrereqNode[]): PrereqNode => ({ type: 'AND', operands })
const orNode = (...operands: PrereqNode[]): PrereqNode => ({ type: 'OR', operands })
const rawNode = (...codes: string[]): PrereqNode => ({ type: 'RAW', codes })
const creditsNode = (minimum: number): PrereqNode => ({ type: 'CREDITS', minimum })
const levelPoolNode = (
  n: number,
  subjects: string[] | null = null,
  min_level: number | null = null,
  max_level: number | null = null,
  specific_courses: string[] = [],
): PrereqNode => ({ type: 'LEVEL_POOL', n, subjects, min_level, max_level, specific_courses })


// ── evaluatePrereq ─────────────────────────────────────────────────────────────

describe('evaluatePrereq', () => {
  describe('COURSE node', () => {
    it('returns true when course is in codesBefore', () => {
      const before = new Set(['CSC108H5'])
      expect(evaluatePrereq(courseNode('CSC108H5'), before)).toBe(true)
    })

    it('returns false when course is not in codesBefore', () => {
      const before = new Set(['CSC148H5'])
      expect(evaluatePrereq(courseNode('CSC108H5'), before)).toBe(false)
    })

    it('returns false for empty codesBefore', () => {
      expect(evaluatePrereq(courseNode('CSC108H5'), new Set())).toBe(false)
    })
  })

  describe('AND node', () => {
    it('returns true when all operands are satisfied', () => {
      const before = new Set(['CSC108H5', 'CSC148H5'])
      const node = andNode(courseNode('CSC108H5'), courseNode('CSC148H5'))
      expect(evaluatePrereq(node, before)).toBe(true)
    })

    it('returns false when any operand is not satisfied', () => {
      const before = new Set(['CSC108H5'])
      const node = andNode(courseNode('CSC108H5'), courseNode('CSC148H5'))
      expect(evaluatePrereq(node, before)).toBe(false)
    })

    it('returns false for empty codesBefore', () => {
      const node = andNode(courseNode('CSC108H5'), courseNode('CSC148H5'))
      expect(evaluatePrereq(node, new Set())).toBe(false)
    })

    it('handles nested AND inside AND', () => {
      const before = new Set(['A', 'B', 'C'])
      const node = andNode(courseNode('A'), andNode(courseNode('B'), courseNode('C')))
      expect(evaluatePrereq(node, before)).toBe(true)
    })
  })

  describe('OR node', () => {
    it('returns true when any operand is satisfied', () => {
      const before = new Set(['CSC207H5'])
      const node = orNode(courseNode('CSC207H5'), courseNode('CSC209H5'))
      expect(evaluatePrereq(node, before)).toBe(true)
    })

    it('returns false when no operand is satisfied', () => {
      const before = new Set(['CSC108H5'])
      const node = orNode(courseNode('CSC207H5'), courseNode('CSC209H5'))
      expect(evaluatePrereq(node, before)).toBe(false)
    })

    it('returns true for second option', () => {
      const before = new Set(['CSC209H5'])
      const node = orNode(courseNode('CSC207H5'), courseNode('CSC209H5'))
      expect(evaluatePrereq(node, before)).toBe(true)
    })
  })

  describe('nested AND + OR', () => {
    it('AND(A, OR(B, C)) — satisfied with A and B', () => {
      const before = new Set(['CSC108H5', 'MAT132H5'])
      const node = andNode(courseNode('CSC108H5'), orNode(courseNode('MAT132H5'), courseNode('MAT135H5')))
      expect(evaluatePrereq(node, before)).toBe(true)
    })

    it('AND(A, OR(B, C)) — satisfied with A and C', () => {
      const before = new Set(['CSC108H5', 'MAT135H5'])
      const node = andNode(courseNode('CSC108H5'), orNode(courseNode('MAT132H5'), courseNode('MAT135H5')))
      expect(evaluatePrereq(node, before)).toBe(true)
    })

    it('AND(A, OR(B, C)) — fails without A', () => {
      const before = new Set(['MAT132H5'])
      const node = andNode(courseNode('CSC108H5'), orNode(courseNode('MAT132H5'), courseNode('MAT135H5')))
      expect(evaluatePrereq(node, before)).toBe(false)
    })

    it('AND(A, OR(B, C)) — fails without B or C', () => {
      const before = new Set(['CSC108H5'])
      const node = andNode(courseNode('CSC108H5'), orNode(courseNode('MAT132H5'), courseNode('MAT135H5')))
      expect(evaluatePrereq(node, before)).toBe(false)
    })
  })

  describe('RAW node', () => {
    it('returns true when all codes are in codesBefore (ALL semantics)', () => {
      const before = new Set(['CSC108H5', 'CSC148H5'])
      expect(evaluatePrereq(rawNode('CSC108H5', 'CSC148H5'), before)).toBe(true)
    })

    it('returns false when any code is missing', () => {
      const before = new Set(['CSC108H5'])
      expect(evaluatePrereq(rawNode('CSC108H5', 'CSC148H5'), before)).toBe(false)
    })

    it('returns true for empty codes array', () => {
      expect(evaluatePrereq(rawNode(), new Set())).toBe(true)
    })
  })

  describe('CREDITS node', () => {
    it('returns true when enough credits completed', () => {
      const courses = [
        makeCourse('CSC108H5', 0.5),
        makeCourse('CSC148H5', 0.5),
        makeCourse('MAT135H5', 0.5),
        makeCourse('MAT136H5', 0.5),
        makeCourse('CSC207H5', 0.5),
        makeCourse('CSC209H5', 0.5),
        makeCourse('CSC236H5', 0.5),
        makeCourse('CSC258H5', 0.5),
      ]
      const courseMap = makeCourseMap(courses)
      const before = new Set(courses.map(c => c.code))
      expect(evaluatePrereq(creditsNode(4.0), before, courseMap)).toBe(true)
    })

    it('returns false when not enough credits', () => {
      const courses = [makeCourse('CSC108H5', 0.5), makeCourse('CSC148H5', 0.5)]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['CSC108H5', 'CSC148H5'])
      expect(evaluatePrereq(creditsNode(4.0), before, courseMap)).toBe(false)
    })

    it('counts only courses in codesBefore', () => {
      const courses = [makeCourse('CSC108H5', 0.5), makeCourse('CSC148H5', 0.5)]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['CSC108H5']) // only one completed
      expect(evaluatePrereq(creditsNode(0.5), before, courseMap)).toBe(true)
      expect(evaluatePrereq(creditsNode(1.0), before, courseMap)).toBe(false)
    })

    it('returns true when courseMap is undefined (lenient)', () => {
      expect(evaluatePrereq(creditsNode(4.0), new Set())).toBe(true)
    })

    it('handles Y5 courses worth 1.0 credit', () => {
      const courses = [makeCourse('PSY100Y5', 1.0)]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['PSY100Y5'])
      expect(evaluatePrereq(creditsNode(1.0), before, courseMap)).toBe(true)
    })
  })

  describe('LEVEL_POOL node', () => {
    it('counts matching courses with correct level and subject', () => {
      const courses = [
        makeCourse('LIN201H5', 0.5),
        makeCourse('LIN202H5', 0.5),
        makeCourse('CSC108H5', 0.5),
      ]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['LIN201H5', 'LIN202H5', 'CSC108H5'])
      const node = levelPoolNode(1.0, ['LIN'], 200, 299)
      expect(evaluatePrereq(node, before, courseMap)).toBe(true)
    })

    it('excludes wrong-level courses', () => {
      const courses = [
        makeCourse('LIN301H5', 0.5),  // 300-level, not 200-level
        makeCourse('LIN201H5', 0.5),
      ]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['LIN301H5'])
      const node = levelPoolNode(1.0, ['LIN'], 200, 299)
      expect(evaluatePrereq(node, before, courseMap)).toBe(false)
    })

    it('excludes wrong-subject courses', () => {
      const courses = [makeCourse('CSC201H5', 0.5)]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['CSC201H5'])
      const node = levelPoolNode(0.5, ['LIN'], 200, 299)
      expect(evaluatePrereq(node, before, courseMap)).toBe(false)
    })

    it('uses specific_courses when provided', () => {
      const courses = [
        makeCourse('ANT200H5', 0.5),
        makeCourse('ANT201H5', 0.5),
        makeCourse('ANT999H5', 0.5),  // not in specific list
      ]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['ANT200H5', 'ANT999H5'])
      const node = levelPoolNode(0.5, null, null, null, ['ANT200H5', 'ANT201H5'])
      expect(evaluatePrereq(node, before, courseMap)).toBe(true)
    })

    it('specific_courses: fails when none in list completed', () => {
      const courses = [makeCourse('ANT200H5', 0.5)]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['ANT999H5'])
      const node = levelPoolNode(0.5, null, null, null, ['ANT200H5', 'ANT201H5'])
      expect(evaluatePrereq(node, before, courseMap)).toBe(false)
    })

    it('no subject filter matches any subject at right level', () => {
      const courses = [makeCourse('BIO201H5', 0.5)]
      const courseMap = makeCourseMap(courses)
      const before = new Set(['BIO201H5'])
      const node = levelPoolNode(0.5, null, 200, 299)
      expect(evaluatePrereq(node, before, courseMap)).toBe(true)
    })

    it('returns true when courseMap is undefined (lenient)', () => {
      expect(evaluatePrereq(levelPoolNode(1.0, ['LIN'], 200, 299), new Set())).toBe(true)
    })
  })

  describe('empty / null node', () => {
    it('returns true for undefined', () => {
      expect(evaluatePrereq(undefined, new Set())).toBe(true)
    })

    it('returns true for empty array', () => {
      expect(evaluatePrereq([] as any, new Set())).toBe(true)
    })
  })
})


// ── buildCodesBefore ──────────────────────────────────────────────────────────

describe('buildCodesBefore', () => {
  const fall24 = makeSemester('s1', 2024, 'Fall', ['CSC108H5'])
  const winter25 = makeSemester('s2', 2025, 'Winter', ['CSC148H5'])
  const summer25 = makeSemester('s3', 2025, 'Summer', ['MAT135H5', 'MAT136H5'])
  const fall25 = makeSemester('s4', 2025, 'Fall', ['CSC207H5'])

  const allSemesters = [fall24, winter25, summer25, fall25]

  it('includes only strictly earlier semesters for non-Summer', () => {
    const before = buildCodesBefore('CSC207H5', fall25, allSemesters)
    expect(before.has('CSC108H5')).toBe(true)  // Fall 2024
    expect(before.has('CSC148H5')).toBe(true)  // Winter 2025
    expect(before.has('MAT135H5')).toBe(true)  // Summer 2025
    expect(before.has('CSC207H5')).toBe(false) // same semester
  })

  it('excludes courses from same Fall semester', () => {
    const before = buildCodesBefore('CSC207H5', fall25, allSemesters)
    expect(before.has('CSC207H5')).toBe(false)
  })

  it('Summer co-enrollment: includes other courses in same Summer semester', () => {
    const before = buildCodesBefore('MAT135H5', summer25, allSemesters)
    // MAT136H5 is in same Summer — should be included (co-enrollment rule)
    expect(before.has('MAT136H5')).toBe(true)
    // But not MAT135H5 itself
    expect(before.has('MAT135H5')).toBe(false)
  })

  it('Summer co-enrollment: includes courses from earlier semesters', () => {
    const before = buildCodesBefore('MAT135H5', summer25, allSemesters)
    expect(before.has('CSC108H5')).toBe(true)
    expect(before.has('CSC148H5')).toBe(true)
  })

  it('Summer co-enrollment: excludes courses from later semesters', () => {
    const before = buildCodesBefore('MAT135H5', summer25, allSemesters)
    expect(before.has('CSC207H5')).toBe(false)
  })

  it('first semester has no codes before', () => {
    const before = buildCodesBefore('CSC108H5', fall24, allSemesters)
    expect(before.size).toBe(0)
  })

  it('second semester only sees first semester courses', () => {
    const before = buildCodesBefore('CSC148H5', winter25, allSemesters)
    expect(before.has('CSC108H5')).toBe(true)
    expect(before.has('CSC148H5')).toBe(false)
    expect(before.has('CSC207H5')).toBe(false)
  })
})


// ── getCourseStatus ────────────────────────────────────────────────────────────

describe('getCourseStatus', () => {
  // Use a future year to avoid "completed"/"in-progress" status from date-based logic
  const futureYear = 2099
  const sem1 = makeSemester('s1', futureYear, 'Fall', ['CSC108H5'])
  const sem2 = makeSemester('s2', futureYear + 1, 'Winter', ['CSC148H5'])
  const sem3 = makeSemester('s3', futureYear + 1, 'Summer', ['CSC207H5'])

  const allSemesters = [sem1, sem2, sem3]

  const csc108 = makeCourse('CSC108H5', 0.5)
  const csc148 = makeCourse('CSC148H5', 0.5, {
    prerequisites: courseNode('CSC108H5'),
  })
  const csc207 = makeCourse('CSC207H5', 0.5, {
    prerequisites: courseNode('CSC148H5'),
  })
  const courseMap = makeCourseMap([csc108, csc148, csc207])

  it('returns no-issues when prerequisites are met', () => {
    const status = getCourseStatus('CSC148H5', sem2, allSemesters, courseMap)
    expect(status).toBe('no-issues')
  })

  it('returns issues when prerequisites are not met', () => {
    // CSC207H5 needs CSC148H5, which is in sem2 — but CSC207H5 is also in sem2-equivalent context
    // Set up: CSC207H5 in sem2 (without CSC148H5 completed first)
    const semA = makeSemester('a1', futureYear, 'Fall', [])
    const semB = makeSemester('a2', futureYear + 1, 'Winter', ['CSC207H5'])
    const status = getCourseStatus('CSC207H5', semB, [semA, semB], courseMap)
    expect(status).toBe('issues')
  })

  it('returns no-issues when course has no prerequisites', () => {
    const status = getCourseStatus('CSC108H5', sem1, allSemesters, courseMap)
    expect(status).toBe('no-issues')
  })

  it('returns issues for duplicate placement in same semester', () => {
    const dupSem1 = makeSemester('d1', futureYear, 'Fall', ['CSC108H5'])
    const dupSem2 = makeSemester('d2', futureYear + 1, 'Winter', ['CSC108H5'])
    const status = getCourseStatus('CSC108H5', dupSem2, [dupSem1, dupSem2], courseMap)
    expect(status).toBe('issues')
  })

  it('returns issues for duplicate placement in earlier semester', () => {
    const dupSem1 = makeSemester('d1', futureYear, 'Fall', ['CSC108H5'])
    const dupSem2 = makeSemester('d2', futureYear + 1, 'Winter', ['CSC108H5'])
    // CSC108H5 is in both sem1 and sem2; checking sem2 placement → duplicate
    const status = getCourseStatus('CSC108H5', dupSem2, [dupSem1, dupSem2], courseMap)
    expect(status).toBe('issues')
  })

  it('no-issues override suppresses duplicate flag', () => {
    const dupSem1 = makeSemester('d1', futureYear, 'Fall', ['CSC108H5'])
    const dupSem2 = makeSemester('d2', futureYear + 1, 'Winter', ['CSC108H5'])
    const overrides = new Set([`__issue__d2__CSC108H5`])
    const status = getCourseStatus('CSC108H5', dupSem2, [dupSem1, dupSem2], courseMap, overrides)
    expect(status).toBe('no-issues')
  })

  it('returns unknown for unrecognized course code', () => {
    const sem = makeSemester('x1', futureYear, 'Fall', ['ZZZ999H5'])
    const status = getCourseStatus('ZZZ999H5', sem, [sem], courseMap)
    expect(status).toBe('unknown')
  })
})


// ── Exclusion logic ───────────────────────────────────────────────────────────

describe('getCourseStatus — exclusion logic', () => {
  const futureYear = 2099

  const csc207 = makeCourse('CSC207H5', 0.5, { exclusions: ['CSC209H5'] })
  const csc209 = makeCourse('CSC209H5', 0.5, { exclusions: ['CSC207H5'] })
  const courseMap = makeCourseMap([csc207, csc209])

  it('flags issues when exclusion is in earlier semester', () => {
    const sem1 = makeSemester('e1', futureYear, 'Fall', ['CSC209H5'])
    const sem2 = makeSemester('e2', futureYear + 1, 'Winter', ['CSC207H5'])
    const status = getCourseStatus('CSC207H5', sem2, [sem1, sem2], courseMap)
    expect(status).toBe('issues')
  })

  it('flags issues when exclusion is in same semester', () => {
    const sem1 = makeSemester('e1', futureYear, 'Fall', ['CSC207H5', 'CSC209H5'])
    const status = getCourseStatus('CSC207H5', sem1, [sem1], courseMap)
    expect(status).toBe('issues')
  })

  it('does not flag when exclusion is in later semester', () => {
    const sem1 = makeSemester('e1', futureYear, 'Fall', ['CSC207H5'])
    const sem2 = makeSemester('e2', futureYear + 1, 'Winter', ['CSC209H5'])
    const status = getCourseStatus('CSC207H5', sem1, [sem1, sem2], courseMap)
    expect(status).toBe('no-issues')
  })

  it('higher-level course supersedes lower-level — no flag', () => {
    // code[3] digit: CSC3xx supersedes CSC2xx
    const csc200 = makeCourse('CSC200H5', 0.5, { exclusions: ['CSC100H5'] })
    const csc100 = makeCourse('CSC100H5', 0.5, { exclusions: ['CSC200H5'] })
    const map = makeCourseMap([csc200, csc100])
    const sem1 = makeSemester('f1', futureYear, 'Fall', ['CSC100H5'])
    const sem2 = makeSemester('f2', futureYear + 1, 'Winter', ['CSC200H5'])
    // CSC200H5 is higher level → no flag
    const status = getCourseStatus('CSC200H5', sem2, [sem1, sem2], map)
    expect(status).toBe('no-issues')
  })
})


// ── formatPrereq ──────────────────────────────────────────────────────────────

describe('formatPrereq', () => {
  it('formats COURSE node', () => {
    expect(formatPrereq(courseNode('CSC108H5'))).toBe('CSC108H5')
  })

  it('formats AND node', () => {
    const node = andNode(courseNode('A'), courseNode('B'))
    expect(formatPrereq(node)).toBe('A and B')
  })

  it('formats OR node with parens', () => {
    const node = orNode(courseNode('A'), courseNode('B'))
    expect(formatPrereq(node)).toBe('(A or B)')
  })

  it('formats nested AND+OR', () => {
    const node = andNode(courseNode('A'), orNode(courseNode('B'), courseNode('C')))
    expect(formatPrereq(node)).toBe('A and (B or C)')
  })

  it('formats CREDITS node', () => {
    expect(formatPrereq(creditsNode(4.0))).toBe('≥4 credits completed')
  })

  it('formats LEVEL_POOL with subjects and level', () => {
    const node = levelPoolNode(1.0, ['LIN'], 200, 299)
    expect(formatPrereq(node)).toContain('1')
    expect(formatPrereq(node)).toContain('LIN')
  })

  it('formats LEVEL_POOL with specific_courses', () => {
    const node = levelPoolNode(0.5, null, null, null, ['ANT200H5', 'ANT201H5'])
    expect(formatPrereq(node)).toContain('ANT200H5')
  })

  it('formats empty array as None', () => {
    expect(formatPrereq([] as any)).toBe('None')
  })

  it('formats undefined as None', () => {
    expect(formatPrereq(undefined)).toBe('None')
  })

  it('formats RAW node', () => {
    expect(formatPrereq(rawNode('CSC108H5', 'CSC148H5'))).toBe('CSC108H5, CSC148H5')
  })
})


// ── getMissingPrereqsStrings ───────────────────────────────────────────────────

describe('getMissingPrereqsStrings', () => {
  it('returns empty when prereqs satisfied', () => {
    const before = new Set(['CSC108H5'])
    const missing = getMissingPrereqsStrings(courseNode('CSC108H5'), before)
    expect(missing).toEqual([])
  })

  it('returns formatted string for unsatisfied COURSE', () => {
    const before = new Set<string>()
    const missing = getMissingPrereqsStrings(courseNode('CSC108H5'), before)
    expect(missing).toContain('CSC108H5')
  })

  it('returns each missing AND operand individually', () => {
    const before = new Set(['CSC108H5'])
    const node = andNode(courseNode('CSC108H5'), courseNode('CSC148H5'), courseNode('MAT135H5'))
    const missing = getMissingPrereqsStrings(node, before)
    expect(missing.length).toBe(2)
    expect(missing.some(m => m.includes('CSC148H5'))).toBe(true)
    expect(missing.some(m => m.includes('MAT135H5'))).toBe(true)
  })

  it('returns the whole OR group when none satisfied', () => {
    const before = new Set<string>()
    const node = orNode(courseNode('CSC207H5'), courseNode('CSC209H5'))
    const missing = getMissingPrereqsStrings(node, before)
    expect(missing.length).toBe(1)
    expect(missing[0]).toContain('CSC207H5')
    expect(missing[0]).toContain('CSC209H5')
  })

  it('returns empty when node is undefined', () => {
    expect(getMissingPrereqsStrings(undefined, new Set())).toEqual([])
  })

  it('returns empty when node is empty array', () => {
    expect(getMissingPrereqsStrings([] as any, new Set())).toEqual([])
  })
})


// ── Integration: realistic prerequisite chains ─────────────────────────────────

describe('integration: realistic prerequisite chains', () => {
  const futureYear = 2099

  it('CSC chain: 108 → 148 → 207 evaluates correctly', () => {
    const csc108 = makeCourse('CSC108H5', 0.5)
    const csc148 = makeCourse('CSC148H5', 0.5, { prerequisites: courseNode('CSC108H5') })
    const csc207 = makeCourse('CSC207H5', 0.5, { prerequisites: courseNode('CSC148H5') })
    const courseMap = makeCourseMap([csc108, csc148, csc207])

    const before148 = new Set(['CSC108H5'])
    const before207 = new Set(['CSC108H5', 'CSC148H5'])

    expect(evaluatePrereq(csc148.prerequisites, before148, courseMap)).toBe(true)
    expect(evaluatePrereq(csc207.prerequisites, before207, courseMap)).toBe(true)
    expect(evaluatePrereq(csc207.prerequisites, before148, courseMap)).toBe(false)
  })

  it('ECO200Y5 prereq: AND(ECO101H5, OR(ECO102H5, ECO100Y5))', () => {
    const eco101 = makeCourse('ECO101H5', 0.5)
    const eco102 = makeCourse('ECO102H5', 0.5)
    const eco100 = makeCourse('ECO100Y5', 1.0)
    const courseMap = makeCourseMap([eco101, eco102, eco100])

    const prereq = andNode(courseNode('ECO101H5'), orNode(courseNode('ECO102H5'), courseNode('ECO100Y5')))

    // Satisfied with ECO101 + ECO102
    expect(evaluatePrereq(prereq, new Set(['ECO101H5', 'ECO102H5']), courseMap)).toBe(true)
    // Satisfied with ECO101 + ECO100Y5
    expect(evaluatePrereq(prereq, new Set(['ECO101H5', 'ECO100Y5']), courseMap)).toBe(true)
    // Not satisfied with only ECO101
    expect(evaluatePrereq(prereq, new Set(['ECO101H5']), courseMap)).toBe(false)
    // Not satisfied with only ECO102
    expect(evaluatePrereq(prereq, new Set(['ECO102H5']), courseMap)).toBe(false)
  })

  it('CHM242H5 prereq: AND(CHM110, CHM120, OR(mat pairs...))', () => {
    const chm110 = makeCourse('CHM110H5', 0.5)
    const chm120 = makeCourse('CHM120H5', 0.5)
    const mat132 = makeCourse('MAT132H5', 0.5)
    const mat134 = makeCourse('MAT134H5', 0.5)
    const mat135 = makeCourse('MAT135H5', 0.5)
    const mat136 = makeCourse('MAT136H5', 0.5)
    const courseMap = makeCourseMap([chm110, chm120, mat132, mat134, mat135, mat136])

    const matPool = orNode(
      andNode(courseNode('MAT132H5'), courseNode('MAT134H5')),
      andNode(courseNode('MAT135H5'), courseNode('MAT136H5')),
    )
    const prereq = andNode(courseNode('CHM110H5'), courseNode('CHM120H5'), matPool)

    // Satisfied: CHM110, CHM120, MAT132+134
    expect(evaluatePrereq(prereq, new Set(['CHM110H5', 'CHM120H5', 'MAT132H5', 'MAT134H5']), courseMap)).toBe(true)
    // Satisfied: CHM110, CHM120, MAT135+136
    expect(evaluatePrereq(prereq, new Set(['CHM110H5', 'CHM120H5', 'MAT135H5', 'MAT136H5']), courseMap)).toBe(true)
    // Not satisfied: missing CHM120
    expect(evaluatePrereq(prereq, new Set(['CHM110H5', 'MAT132H5', 'MAT134H5']), courseMap)).toBe(false)
    // Not satisfied: missing MAT pair (only has one)
    expect(evaluatePrereq(prereq, new Set(['CHM110H5', 'CHM120H5', 'MAT132H5']), courseMap)).toBe(false)
  })

  it('CREDITS prereq: 4.0 credits requires 8 half-credit courses', () => {
    const courses = Array.from({ length: 8 }, (_, i) => makeCourse(`CSC${108 + i}H5`, 0.5))
    const courseMap = makeCourseMap(courses)

    const sevenCodes = new Set(courses.slice(0, 7).map(c => c.code))
    const eightCodes = new Set(courses.map(c => c.code))

    expect(evaluatePrereq(creditsNode(4.0), sevenCodes, courseMap)).toBe(false)
    expect(evaluatePrereq(creditsNode(4.0), eightCodes, courseMap)).toBe(true)
    expect(evaluatePrereq(creditsNode(3.5), sevenCodes, courseMap)).toBe(true)
  })

  it('Summer co-enrollment enables prereq for same-session course', () => {
    const csc108 = makeCourse('CSC108H5', 0.5)
    const csc148 = makeCourse('CSC148H5', 0.5, { prerequisites: courseNode('CSC108H5') })
    const courseMap = makeCourseMap([csc108, csc148])

    const summer = makeSemester('su1', futureYear, 'Summer', ['CSC108H5', 'CSC148H5'])
    const allSemesters = [summer]

    // CSC148H5 needs CSC108H5; both in same Summer → co-enrollment counts
    const codesBefore = buildCodesBefore('CSC148H5', summer, allSemesters)
    expect(codesBefore.has('CSC108H5')).toBe(true)
    expect(evaluatePrereq(csc148.prerequisites, codesBefore, courseMap)).toBe(true)
  })
})
