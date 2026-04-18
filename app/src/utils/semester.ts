import type { Season, Semester } from '../types'

/**
 * Chronological sort key for a semester.
 *
 * Academic calendar: Fall N → Winter N+1 → Summer N+1 → Fall N+1 → …
 *   Fall   N  → key = N*3
 *   Winter N  → key = (N-1)*3 + 1  (comes after Fall N-1)
 *   Summer N  → key = (N-1)*3 + 2  (comes after Winter N)
 *
 * Example:
 *   Fall 2025   → 6075
 *   Winter 2026 → 6076
 *   Summer 2026 → 6077
 *   Fall 2026   → 6078
 */
export function semesterSortKey(year: number, season: Season): number {
  if (season === 'Fall')   return year * 3
  if (season === 'Winter') return (year - 1) * 3 + 1
  return (year - 1) * 3 + 2 // Summer
}

export function semLabel(sem: Semester): string {
  return `${sem.season} ${sem.year}`
}

/** Sort key for the real-world current semester (based on today's date). */
export function currentSemesterKey(): number {
  const now   = new Date()
  const month = now.getMonth() + 1  // 1-12
  const year  = now.getFullYear()

  let season: Season
  if (month >= 9)           season = 'Fall'
  else if (month >= 5)      season = 'Summer'
  else                      season = 'Winter'

  return semesterSortKey(year, season)
}

export function isSemPast(sem: Semester): boolean {
  return semesterSortKey(sem.year, sem.season) < currentSemesterKey()
}

export function isSemCurrent(sem: Semester): boolean {
  return semesterSortKey(sem.year, sem.season) === currentSemesterKey()
}

/** Return the next {year, season} after the given one. */
export function nextSem(year: number, season: Season): { year: number; season: Season } {
  if (season === 'Fall')   return { year: year + 1, season: 'Winter' }
  if (season === 'Winter') return { year,           season: 'Summer' }
  return                          { year: year + 1, season: 'Fall'   }
}

/** Build the default semester list: Fall 2024 → Winter 2029. */
export function buildDefaultSemesters(): Semester[] {
  const entries: Array<{ year: number; season: Season }> = [
    { year: 2024, season: 'Fall'   },
    { year: 2025, season: 'Winter' },
    { year: 2025, season: 'Summer' },
    { year: 2025, season: 'Fall'   },
    { year: 2026, season: 'Winter' },
    { year: 2026, season: 'Summer' },
    { year: 2026, season: 'Fall'   },
    { year: 2027, season: 'Winter' },
    { year: 2027, season: 'Summer' },
    { year: 2027, season: 'Fall'   },
    { year: 2028, season: 'Winter' },
    { year: 2028, season: 'Summer' },
    { year: 2028, season: 'Fall'   },
    { year: 2029, season: 'Winter' },
  ]
  return entries.map((e, i) => ({
    id: `sem-default-${i}`,
    year: e.year,
    season: e.season,
    courses: [],
  }))
}
