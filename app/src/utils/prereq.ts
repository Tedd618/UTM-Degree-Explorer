import type { Course, CourseStatus, Semester, PrereqNode, MissingGroup } from '../types'
import { semesterSortKey, isSemPast, isSemCurrent } from './semester'

function creditsBefore(codesBefore: Set<string>, courseMap: Map<string, Course>): number {
  let total = 0
  for (const code of codesBefore) {
    const c = courseMap.get(code)
    if (c) total += c.credits
  }
  return total
}

export function evaluatePrereq(
  node: PrereqNode | never[] | undefined,
  codesBefore: Set<string>,
  courseMap?: Map<string, Course>,
): boolean {
  if (!node) return true
  if (Array.isArray(node)) return node.length === 0
  if (node.type === 'COURSE') return codesBefore.has(node.code)
  if (node.type === 'AND') return (node.operands || []).every((op: any) => evaluatePrereq(op, codesBefore, courseMap))
  if (node.type === 'OR')  return (node.operands || []).some((op: any) => evaluatePrereq(op, codesBefore, courseMap))
  if (node.type === 'RAW') return (node.codes || []).every((c: string) => codesBefore.has(c))
  if (node.type === 'CREDITS') {
    if (!courseMap) return true
    return creditsBefore(codesBefore, courseMap) >= node.minimum
  }
  if (node.type === 'LEVEL_POOL') {
    if (!courseMap) return true
    const { n, subjects, min_level, max_level, specific_courses } = node
    let earned = 0
    for (const code of codesBefore) {
      const c = courseMap.get(code)
      if (!c) continue
      const lvl = parseInt(code.slice(3, 6), 10)
      if (specific_courses.length > 0) {
        if (specific_courses.includes(code)) earned += c.credits
      } else {
        const subjectMatch = !subjects || subjects.includes(code.slice(0, 3))
        const levelMatch = (min_level === null || lvl >= min_level) && (max_level === null || lvl <= max_level)
        if (subjectMatch && levelMatch) earned += c.credits
      }
    }
    return earned >= n
  }
  return true
}

export function formatPrereq(node: PrereqNode | never[] | undefined): string {
  if (!node || (Array.isArray(node) && node.length === 0)) return 'None'
  if (Array.isArray(node)) return 'Unknown'
  if (node.type === 'COURSE') return node.code
  if (node.type === 'AND') return node.operands.map(formatPrereq).join(' and ')
  if (node.type === 'OR') return `(${node.operands.map(formatPrereq).join(' or ')})`
  if (node.type === 'RAW') return node.codes.join(', ')
  if (node.type === 'CREDITS') return `≥${node.minimum} credits completed`
  if (node.type === 'LEVEL_POOL') {
    const { n, subjects, min_level, max_level, specific_courses } = node
    if (specific_courses.length > 0) {
      return `${n} credit(s) from: ${specific_courses.join(', ')}`
    }
    const subj = subjects ? subjects.join('/') : 'any subject'
    const lvl = min_level && max_level ? ` ${min_level}–${max_level}-level` : min_level ? ` ${min_level}+-level` : ''
    return `${n} credit(s) in${lvl} ${subj}`
  }
  return 'Unknown'
}

export function getMissingPrereqsStrings(
  node: PrereqNode | never[] | undefined,
  codesBefore: Set<string>,
  courseMap?: Map<string, Course>,
): string[] {
  if (!node || (Array.isArray(node) && node.length === 0)) return []
  if (evaluatePrereq(node, codesBefore, courseMap)) return []

  if (!Array.isArray(node) && node.type === 'AND') {
    return (node.operands || [])
      .filter((op: any) => !evaluatePrereq(op, codesBefore, courseMap))
      .map((op: any) => formatPrereq(op))
  }

  return [formatPrereq(node)]
}

/**
 * Collect missing prerequisite groups for the Radar panel.
 */
export function collectMissingPrereqGroups(
  node: PrereqNode | never[] | undefined,
  codesBefore: Set<string>,
  courseMap?: Map<string, Course>,
): MissingGroup[] {
  if (!node || (Array.isArray(node) && node.length === 0)) return []
  if (evaluatePrereq(node, codesBefore, courseMap)) return []
  if (Array.isArray(node)) return []

  return [nodeToGroup(node, codesBefore, courseMap)].filter(Boolean) as MissingGroup[]
}

function nodeToGroup(
  node: PrereqNode,
  codesBefore: Set<string>,
  courseMap?: Map<string, Course>,
): MissingGroup | null {
  if (evaluatePrereq(node, codesBefore, courseMap)) return null

  if (node.type === 'COURSE') return { kind: 'single', code: node.code }

  if (node.type === 'CREDITS') return { kind: 'credit', minimum: node.minimum }

  if (node.type === 'LEVEL_POOL') {
    return { kind: 'level_pool', n: node.n, subjects: node.subjects, min_level: node.min_level, max_level: node.max_level, specific_courses: node.specific_courses }
  }

  if (node.type === 'RAW') {
    const missing = node.codes.filter(c => !codesBefore.has(c))
    if (missing.length === 0) return null
    if (missing.length === 1) return { kind: 'single', code: missing[0] }
    return { kind: 'and', parts: missing.map(c => ({ kind: 'single', code: c } as MissingGroup)) }
  }

  if (node.type === 'OR') {
    const options = (node.operands || [])
      .map(op => nodeToGroup(op, codesBefore, courseMap))
      .filter(Boolean) as MissingGroup[]
    if (options.length === 0) return null
    if (options.length === 1) return options[0]
    return { kind: 'or', options }
  }

  if (node.type === 'AND') {
    const parts = (node.operands || [])
      .map(op => nodeToGroup(op, codesBefore, courseMap))
      .filter(Boolean) as MissingGroup[]
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    return { kind: 'and', parts }
  }

  return null
}

/**
 * Build the set of course codes that satisfy prerequisites for `code` in `semester`.
 *
 * Normal rule: only courses from strictly earlier semesters count.
 * Summer exception: Summer has two back-to-back sessions (Summer 1 & 2) but we
 * store them as a single "Summer" semester.  Any other course in the same Summer
 * semester is treated as potentially completable before `code`, so it is included
 * in codesBefore (minus `code` itself to avoid self-satisfaction).
 */
export function buildCodesBefore(
  code: string,
  semester: Semester,
  allSemesters: Semester[],
): Set<string> {
  const semKey = semesterSortKey(semester.year, semester.season)
  const isSummer = semester.season === 'Summer'
  const result = new Set<string>()
  for (const s of allSemesters) {
    const key = semesterSortKey(s.year, s.season)
    if (key < semKey) {
      for (const c of s.courses) result.add(c)
    } else if (isSummer && key === semKey) {
      // Same Summer semester — include co-enrolled courses except this one
      for (const c of s.courses) { if (c !== code) result.add(c) }
    }
  }
  return result
}

/**
 * Compute the display status for a course placed in a given semester.
 */
export function getCourseStatus(
  code: string,
  semester: Semester,
  allSemesters: Semester[],
  courseMap: Map<string, Course>,
  overrides?: Set<string>,
): CourseStatus {
  if (isSemPast(semester))    return 'completed'
  if (isSemCurrent(semester)) return 'in-progress'

  const course = courseMap.get(code)
  if (!course) return 'unknown'

  // Duplicate: same course code in an earlier or concurrent semester
  const semKey = semesterSortKey(semester.year, semester.season)
  const isDuplicate = allSemesters.some(s =>
    s.id !== semester.id &&
    s.courses.includes(code) &&
    semesterSortKey(s.year, s.season) <= semKey
  )
  if (isDuplicate) {
    return overrides?.has(`__issue__${semester.id}__${code}`) ? 'no-issues' : 'issues'
  }

  const codesBefore  = buildCodesBefore(code, semester, allSemesters)
  const codesNonPast = new Set<string>(allSemesters.filter(s => !isSemPast(s)).flatMap(s => s.courses))

  let hasIssues = false

  if (!evaluatePrereq(course.prerequisites, codesBefore, courseMap)) hasIssues = true

  if (!hasIssues) {
    for (const excl of course.exclusions) {
      if (codesNonPast.has(excl) && excl !== code) { hasIssues = true; break }
    }
  }

  if (!hasIssues && course.offerings && course.offerings.length > 0 && !course.offerings.includes(semester.season)) {
    hasIssues = true
  }

  if (hasIssues) {
    // Per-placement issue override
    return overrides?.has(`__issue__${semester.id}__${code}`) ? 'no-issues' : 'issues'
  }

  return 'no-issues'
}

/** Aggregate issue details for a course (for tooltip / panel). */
export function getIssueReasons(
  code: string,
  semester: Semester,
  allSemesters: Semester[],
  courseMap: Map<string, Course>,
  overrides?: Set<string>,
): string[] {
  if (overrides?.has(`__issue__${semester.id}__${code}`)) return []

  const course = courseMap.get(code)
  if (!course) return ['Course not found in catalogue']

  // Duplicate check
  const semKey = semesterSortKey(semester.year, semester.season)
  const dupSem = allSemesters.find(s =>
    s.id !== semester.id &&
    s.courses.includes(code) &&
    semesterSortKey(s.year, s.season) <= semKey
  )
  if (dupSem) {
    return [`Duplicate: already in ${dupSem.season} ${dupSem.year}`]
  }

  const codesBefore   = buildCodesBefore(code, semester, allSemesters)
  const codesNonPast  = new Set<string>(allSemesters.filter(s => !isSemPast(s)).flatMap(s => s.courses))

  const reasons: string[] = []

  const missing = getMissingPrereqsStrings(course.prerequisites, codesBefore, courseMap)
  for (const req of missing) {
    reasons.push(`Missing prerequisite: ${req}`)
  }

  for (const e of course.exclusions) {
    if (codesNonPast.has(e) && e !== code) reasons.push(`Conflicts with: ${e}`)
  }

  if (course.offerings && course.offerings.length > 0 && !course.offerings.includes(semester.season)) {
    reasons.push(`Not offered in ${semester.season}`)
  }

  return reasons
}
