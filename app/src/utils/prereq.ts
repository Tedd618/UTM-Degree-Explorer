import type { Course, CourseStatus, Semester } from '../types'
import { semesterSortKey, currentSemesterKey, isSemPast, isSemCurrent } from './semester'

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

  for (const prereq of course.prerequisites) {
    if (!codesBefore.has(prereq)) return 'issues'
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
  for (const p of course.prerequisites) {
    if (!codesBefore.has(p)) reasons.push(`Missing prerequisite: ${p}`)
  }
  for (const e of course.exclusions) {
    if (codesAnywhere.has(e) && e !== code) reasons.push(`Conflicts with: ${e}`)
  }
  return reasons
}
