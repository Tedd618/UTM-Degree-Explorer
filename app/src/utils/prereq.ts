import type { Course, CourseStatus, Semester, PrereqNode } from '../types'
import { semesterSortKey, currentSemesterKey, isSemPast, isSemCurrent } from './semester'

export function evaluatePrereq(node: PrereqNode | never[] | undefined, codesBefore: Set<string>): boolean {
  if (!node) return true
  if (Array.isArray(node)) return node.length === 0
  if (node.type === 'COURSE') return codesBefore.has(node.code)
  if (node.type === 'AND') return (node.operands || []).every((op: any) => evaluatePrereq(op, codesBefore))
  if (node.type === 'OR') return (node.operands || []).some((op: any) => evaluatePrereq(op, codesBefore))
  if (node.type === 'RAW') return (node.codes || []).every((c: string) => codesBefore.has(c))
  return true
}

export function formatPrereq(node: PrereqNode | never[] | undefined): string {
  if (!node || (Array.isArray(node) && node.length === 0)) return 'None'
  if (Array.isArray(node)) return 'Unknown' // unexpected array format
  if (node.type === 'COURSE') return node.code
  if (node.type === 'AND') {
    return node.operands.map(formatPrereq).join(' and ')
  }
  if (node.type === 'OR') {
    const joined = node.operands.map(formatPrereq).join(' or ')
    // Add parens if nested
    return `(${joined})`
  }
  if (node.type === 'RAW') {
    return node.codes.join(', ')
  }
  return 'Unknown'
}

export function getMissingPrereqsStrings(node: PrereqNode | never[] | undefined, codesBefore: Set<string>): string[] {
  if (!node || (Array.isArray(node) && node.length === 0)) return []
  if (evaluatePrereq(node, codesBefore)) return []
  
  // If it's missing, let's just return the top level requirement that's missing
  if (!Array.isArray(node) && node.type === 'AND') {
    return (node.operands || [])
      .filter((op: any) => !evaluatePrereq(op, codesBefore))
      .map((op: any) => formatPrereq(op))
  }
  
  // For OR, RAW, COURSE, just return the whole formatted string
  return [formatPrereq(node)]
}

/**
 * Compute the display status for a course placed in a given semester.
 *
 * Rules (in priority order):
 *  1. Semester is in the past      → 'completed'
 *  2. Semester is current          → 'in-progress'
 *  3. Any prerequisite is missing from ALL earlier semesters → 'issues'
 *  4. Course appears in exclusions of another planned course → 'issues'
 *  5. Otherwise                    → 'no-issues'
 */
export function getCourseStatus(
  code: string,
  semester: Semester,
  allSemesters: Semester[],
  courseMap: Map<string, Course>,
): CourseStatus {
  if (isSemPast(semester))    return 'completed'
  if (isSemCurrent(semester)) return 'in-progress'

  const course = courseMap.get(code)
  if (!course) return 'unknown'

  const semKey = semesterSortKey(semester.year, semester.season)

  // All codes present in semesters strictly before this one
  const codesBefore = new Set<string>(
    allSemesters
      .filter(s => semesterSortKey(s.year, s.season) < semKey)
      .flatMap(s => s.courses),
  )

  // All codes present anywhere in the plan
  const codesAnywhere = new Set<string>(allSemesters.flatMap(s => s.courses))

  if (!evaluatePrereq(course.prerequisites, codesBefore)) {
    return 'issues'
  }

  for (const excl of course.exclusions) {
    if (codesAnywhere.has(excl) && excl !== code) return 'issues'
  }

  return 'no-issues'
}

/** Aggregate issue details for a course (for tooltip / panel). */
export function getIssueReasons(
  code: string,
  semester: Semester,
  allSemesters: Semester[],
  courseMap: Map<string, Course>,
): string[] {
  const course = courseMap.get(code)
  if (!course) return ['Course not found in catalogue']

  const semKey = semesterSortKey(semester.year, semester.season)
  const codesBefore = new Set<string>(
    allSemesters
      .filter(s => semesterSortKey(s.year, s.season) < semKey)
      .flatMap(s => s.courses),
  )
  const codesAnywhere = new Set<string>(allSemesters.flatMap(s => s.courses))

  const reasons: string[] = []
  
  const missing = getMissingPrereqsStrings(course.prerequisites, codesBefore)
  for (const req of missing) {
    reasons.push(`Missing prerequisite: ${req}`)
  }

  for (const e of course.exclusions) {
    if (codesAnywhere.has(e) && e !== code) reasons.push(`Conflicts with: ${e}`)
  }
  return reasons
}
