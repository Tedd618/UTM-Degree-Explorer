import type { Semester, Course, RequirementNode, RequirementGroup, ProgramStructure } from '../types'

export interface GeneralDegreeProgress {
  total: { value: number; max: number; met: boolean }
  level200: { value: number; max: number; met: boolean }
  level300: { value: number; max: number; met: boolean }
  humanities: { value: number; max: number; met: boolean }
  sciences: { value: number; max: number; met: boolean }
  socialSciences: { value: number; max: number; met: boolean }
}

export function evaluateGeneralRequirements(semesters: Semester[], courseMap: Map<string, Course>): GeneralDegreeProgress {
  let total = 0, level200 = 0, level300 = 0
  let hum = 0, sci = 0, ssc = 0

  const processed = new Set<string>()

  for (const sem of semesters) {
    for (const code of sem.courses) {
      if (processed.has(code)) continue
      processed.add(code)

      const c = courseMap.get(code)
      if (!c) continue

      const credits = c.credits ?? 0.5

      total += credits

      const numLevelMatch = code.match(/\d{3}/)
      if (numLevelMatch) {
        const numLevel = parseInt(numLevelMatch[0], 10)
        if (numLevel >= 200) {
          level200 += credits
          if (numLevel >= 300) {
            level300 += credits
          }
        }
      }

      const dist = c.distribution?.toLowerCase() || ''
      if (dist.includes('humanities')) hum += credits
      if (dist.includes('science') && !dist.includes('social')) sci += credits
      if (dist.includes('social science')) ssc += credits
    }
  }

  return {
    total: { value: total, max: 20, met: total >= 20 },
    level200: { value: level200, max: 13, met: level200 >= 13 },
    level300: { value: level300, max: 6, met: level300 >= 6 },
    humanities: { value: hum, max: 1, met: hum >= 1 },
    sciences: { value: sci, max: 1, met: sci >= 1 },
    socialSciences: { value: ssc, max: 1, met: ssc >= 1 }
  }
}

export interface NodeEvalResult {
  met: boolean
  value: number
  max: number
  label?: string
  children?: NodeEvalResult[]
  /** For open_pool nodes: sorted list of all course codes that satisfy the pool constraints */
  poolCourses?: string[]
  /** For open_pool nodes: subset of poolCourses the user has already taken */
  takenFromPool?: string[]
}

/** Normalize a raw course-level number to its century (367→300, 490→400, 215→200). */
function centuryLevel(n: number): number {
  return Math.floor(n / 100) * 100
}

function getUniqueCourses(semesters: Semester[]): Set<string> {
  const set = new Set<string>()
  for (const sem of semesters) {
    for (const code of sem.courses) {
      set.add(code)
    }
  }
  return set
}

// Greedy AST engine
export function evaluateNode(node: RequirementNode, userCodes: Set<string>, courseMap: Map<string, Course>): NodeEvalResult {
  switch (node.type) {
    case 'course': {
      const code = node.code || ''
      const meets = userCodes.has(code)
      const credits = courseMap.get(code)?.credits ?? 0.5
      return { met: meets, value: meets ? credits : 0, max: credits, label: code }
    }
    case 'all_of': {
      const children = (node.items || []).map(child => evaluateNode(child, userCodes, courseMap))
      const earnedCredits = children.reduce((sum, c) => sum + c.value, 0)
      const totalCredits = children.reduce((sum, c) => sum + c.max, 0)
      return { met: children.every(c => c.met), value: earnedCredits, max: totalCredits, label: 'All of:', children }
    }
    case 'one_of': {
      const children = (node.items || []).map(child => evaluateNode(child, userCodes, courseMap))
      const anyMet = children.some(c => c.met)
      // max = minimum path cost (fewest credits needed to satisfy any one branch)
      const minMax = children.length > 0 ? Math.min(...children.map(c => c.max)) : 0
      // value = credits earned toward the best-progress branch
      const bestValue = children.length > 0 ? Math.max(...children.map(c => c.value)) : 0
      return { met: anyMet, value: Math.min(bestValue, minMax), max: minMax, label: 'One of:', children }
    }
    case 'n_from': {
      const children = (node.items || []).map(child => evaluateNode(child, userCodes, courseMap))
      const target = node.n || 1
      const earned = children.reduce((sum, c) => sum + c.value, 0)
      return { met: earned >= target, value: Math.min(earned, target), max: target, label: `Choose ${target} credit(s) from:`, children }
    }
    case 'limit': {
      // "Up to N credits from ..." is a cap, not a requirement — always satisfied; value is capped.
      const children = (node.items || []).map(child => evaluateNode(child, userCodes, courseMap))
      const cap = node.limit || 0
      const earned = Math.min(children.reduce((sum, c) => sum + c.value, 0), cap)
      return { met: true, value: earned, max: cap, label: `Up to ${cap} credit(s) from:`, children }
    }
    case 'open_pool': {
      const targetCredits = node.n || 0

      // ── Determine evaluation mode based on specific_courses content ───────────
      //
      // RESTRICTION mode: specific_courses is non-empty and every entry shares the
      // same subject prefix as node.subject.  This means the parser captured a
      // hand-picked list (e.g. French FRE180H5/FRE181H5, Financial Economics ECO
      // sublist, Economics MGT sublist).  The pool is *exactly* those courses —
      // the broader subject+level filter would include too many extras.
      //
      // ADDITION mode: specific_courses includes at least one course whose subject
      // differs from node.subject (e.g. CS Major has GGR courses alongside CSC).
      // Pool = subject+level filter UNION non-subject specific_courses.
      //
      // PURE_POOL mode: no specific_courses — ordinary subject+level or unrestricted.
      //
      // Level comparison always uses the *century* (490→400) so "max_level:400"
      // correctly includes all 400-series courses (e.g. CSC490H5).

      const sc = node.specific_courses ?? []
      const hasNonSubjectSC = sc.some(c => !node.subject || !c.startsWith(node.subject))
      // RESTRICTION: sc non-empty AND all entries share the same subject → exact list only
      const isRestriction = sc.length > 0 && !hasNonSubjectSC

      const poolCodes = new Set<string>()

      for (const [code] of courseMap) {
        if (node.excluding?.includes(code)) continue

        let valid = false

        if (isRestriction) {
          // Pool is exactly the listed specific_courses — no subject/level broadening
          if (sc.includes(code)) valid = true
        } else {
          // Primary pool: subject + level range
          if (node.subject && code.startsWith(node.subject)) {
            if (node.min_level || node.max_level) {
              const m = code.match(/\d{3}/)
              if (m) {
                const c = centuryLevel(parseInt(m[0], 10))
                if ((!node.min_level || c >= node.min_level) && (!node.max_level || c <= node.max_level)) {
                  valid = true
                }
              }
            } else {
              valid = true // subject matches, no level constraint
            }
          }

          // ADDITION: add specific_courses that come from a *different* subject.
          // Same-subject entries are either already in the pool (level passed) or
          // are parser artifacts below the level threshold — don't force-include them.
          if (!valid && sc.includes(code)) {
            if (!node.subject || !code.startsWith(node.subject)) valid = true
          }

          // No subject AND no specific list → level-only pool (or unrestricted)
          if (!valid && !node.subject && sc.length === 0) {
            if (node.min_level || node.max_level) {
              const m = code.match(/\d{3}/)
              if (m) {
                const c = centuryLevel(parseInt(m[0], 10))
                if ((!node.min_level || c >= node.min_level) && (!node.max_level || c <= node.max_level)) {
                  valid = true
                }
              }
            } else {
              valid = true
            }
          }
        }

        if (valid) poolCodes.add(code)
      }

      // ── Count user credits that fall in the pool ───────────────────────────────
      let collected = 0
      for (const code of userCodes) {
        if (poolCodes.has(code)) collected += courseMap.get(code)?.credits ?? 0.5
      }

      const poolCourses = [...poolCodes].sort()
      const takenFromPool = poolCourses.filter(c => userCodes.has(c))
      const met = collected >= targetCredits
      return {
        met,
        value: Math.min(collected, targetCredits),
        max: targetCredits,
        label: node.description || `Pool: ${targetCredits} credits`,
        poolCourses,
        takenFromPool,
      }
    }
    case 'text': {
      return { met: false, value: 0, max: 0, label: node.text || 'Requirement notation (Check manually)' }
    }
    default:
      return { met: false, value: 0, max: 0, label: 'Unknown requirement' }
  }
}

// Collect course codes from all n_from siblings in the group
function collectNFromCodes(group: RequirementGroup): string[] {
  const codes: string[] = []
  for (const item of group.items) {
    if (item.type === 'n_from') {
      for (const child of item.items || []) {
        if (child.type === 'course' && child.code) codes.push(child.code)
      }
    }
  }
  return codes
}

// Collect explicitly required course codes from group (courses inside `course` and `all_of` nodes only)
function collectRequiredCoursesFromGroup(group: RequirementGroup): Set<string> {
  const codes = new Set<string>()
  function collect(node: RequirementNode) {
    if (node.type === 'course' && node.code) codes.add(node.code)
    if (node.type === 'all_of') (node.items || []).forEach(collect)
    // n_from / one_of are optional choices — don't mark as "required"
  }
  for (const item of group.items) {
    if (item.type !== 'text') collect(item)
  }
  return codes
}

interface SubjectPoolSpec {
  n: number
  subjects: string[]
  minLevel: number | null
  maxLevel: number | null
}

// Parse "N additional [SUBJ] credits [at X level]" into a structured spec.
// Returns null for patterns we can't reliably parse (clusters, Italian categories, etc.)
function parseSubjectPoolText(text: string): SubjectPoolSpec | null {
  if (!/^\d/.test(text)) return null
  if (!/additional/i.test(text)) return null

  const nMatch = text.match(/^(\d+(?:\.\d+)?)/)
  if (!nMatch) return null
  const n = parseFloat(nMatch[1])

  // English subject name → course prefix
  const nameToCode: Record<string, string> = {
    biology: 'BIO',
    psychology: 'PSY',
  }

  const subjects: string[] = []

  // "N additional [UTM] CODE credits" — code directly before "credits"
  const preCredits = text.match(/additional(?:\s+UTM)?\s+([A-Z]{3})\s+credits?/i)
  if (preCredits) subjects.push(preCredits[1].toUpperCase())

  // "N additional credits in CODE" — code after "in"
  const inCode = text.match(/additional\s+credits?\s+in\s+([A-Z]{3})\b/i)
  if (inCode) {
    const c = inCode[1].toUpperCase()
    if (!subjects.includes(c)) subjects.push(c)
  }

  // "N additional credit of CODE [or CODE]" — after "of"
  const ofCode = text.match(/additional\s+credits?\s+of\s+([A-Z]{3}(?:\s+or\s+[A-Z]{3})*)/i)
  if (ofCode) {
    for (const m of (ofCode[1].match(/[A-Z]{3}/g) || [])) {
      if (!subjects.includes(m)) subjects.push(m)
    }
  }

  // Also: "N additional credits of HIS at …"
  const creditsOf = text.match(/additional\s+credits?\s+of\s+([A-Z]{3})\s+at/i)
  if (creditsOf) {
    const c = creditsOf[1].toUpperCase()
    if (!subjects.includes(c)) subjects.push(c)
  }

  // English names fallback
  if (subjects.length === 0) {
    for (const [name, code] of Object.entries(nameToCode)) {
      if (text.toLowerCase().includes(name)) subjects.push(code)
    }
  }

  // Filter tokens that are not course prefixes
  const SKIP = new Set(['UTM', 'AND', 'ANY', 'ROP', 'THE', 'ALL', 'FOR', 'NOT', 'DRE'])
  // "DRE" is kept only if it comes from the "of CODE" pattern (handled above via ofCode)
  const filtered = subjects.filter(s => !SKIP.has(s) || ofCode?.includes(s))
  if (filtered.length === 0) return null

  // Parse level constraint
  let minLevel: number | null = null
  let maxLevel: number | null = null

  if (/300[/\-]400|300\+|300.*and.*400/i.test(text)) {
    minLevel = 300
  } else if (/\b400[-+]?level|\bat\s+(?:the\s+)?400/i.test(text)) {
    minLevel = 400; maxLevel = 499
  } else if (/(\d{3})\+\s*level/i.test(text)) {
    const m = text.match(/(\d{3})\+/)
    if (m) minLevel = parseInt(m[1])
  } else if (/at\s+(?:the\s+)?(\d{3})\s*level/i.test(text)) {
    const m = text.match(/at\s+(?:the\s+)?(\d{3})\s*level/i)
    if (m) { minLevel = parseInt(m[1]); maxLevel = parseInt(m[1]) + 99 }
  }

  return { n, subjects: filtered, minLevel, maxLevel }
}

export function evaluateProgram(program: ProgramStructure, semesters: Semester[], courseMap: Map<string, Course>) {
  const userCodes = getUniqueCourses(semesters)

  const groupsEval = program.completion.groups.map(group => {
    // Collect pools needed for "additional credits" text-node resolution
    const nFromCodes = collectNFromCodes(group)
    const requiredCodesInGroup = collectRequiredCoursesFromGroup(group)

    // Total credits already required by n_from siblings — consumed before "additional" pool starts
    const siblingNFromConsumption = group.items.reduce(
      (sum, item) => item.type === 'n_from' ? sum + (item.n || 0) : sum,
      0,
    )

    const children = group.items.map(child => {
      if (child.type === 'text') {
        const text = child.text || ''

        // ── Pattern 1: "N additional credits from [nFromCodes pool]" ─────────────────
        // Matches: "1.0 additional credit from the ENG and CCT courses listed above"
        if (nFromCodes.length > 0) {
          const m = text.match(/^(\d+(?:\.\d+)?)\s+additional\s+credits?\s+from/i)
          if (m) {
            const n = parseFloat(m[1])
            let poolCredits = 0
            for (const code of userCodes) {
              if (nFromCodes.includes(code)) {
                poolCredits += courseMap.get(code)?.credits ?? 0.5
              }
            }
            const available = Math.max(0, poolCredits - siblingNFromConsumption)
            return { met: available >= n, value: Math.min(available, n), max: n, label: text }
          }
        }

        // ── Pattern 2: "N additional [SUBJ] credits [at level]" ──────────────────────
        // Matches: "2.5 additional credits in PHL", "1.0 additional RLG credits at any level",
        //          "0.5 additional credits in MAT at the 400 level", "1.0 additional credit of ENG or DRE", etc.
        const spec = parseSubjectPoolText(text)
        if (spec) {
          const { n, subjects, minLevel, maxLevel } = spec

          // Sum user credits that match subject + level filter
          // Use century-level comparison so max_level:400 correctly includes CSC490H5, etc.
          let userSubjectCredits = 0
          for (const code of userCodes) {
            if (!subjects.some(s => code.startsWith(s))) continue
            const levelMatch = code.match(/\d{3}/)
            if (levelMatch) {
              const c = centuryLevel(parseInt(levelMatch[0], 10))
              if (minLevel !== null && c < minLevel) continue
              if (maxLevel !== null && c > maxLevel) continue
            }
            userSubjectCredits += courseMap.get(code)?.credits ?? 0.5
          }

          // Subtract credits of explicitly required siblings that match the subject
          // (e.g., required course CSC108H5 should not also count toward "additional CSC credits")
          let requiredInSubject = 0
          for (const code of requiredCodesInGroup) {
            if (!userCodes.has(code)) continue
            if (!subjects.some(s => code.startsWith(s))) continue
            requiredInSubject += courseMap.get(code)?.credits ?? 0.5
          }

          // Subtract n_from consumption proportional to same-subject items
          let nFromSubjectConsumption = 0
          for (const item of group.items) {
            if (item.type !== 'n_from') continue
            const items = item.items || []
            if (items.length === 0) continue
            const subjectCount = items.filter(
              c => c.type === 'course' && c.code && subjects.some(s => c.code!.startsWith(s))
            ).length
            if (subjectCount === 0) continue
            nFromSubjectConsumption += (item.n || 0) * (subjectCount / items.length)
          }

          const available = Math.max(0, userSubjectCredits - requiredInSubject - nFromSubjectConsumption)
          return { met: available >= n, value: Math.min(available, n), max: n, label: text }
        }

        // ── Pattern 3: text node with scraped courses list ──────────────────────────
        // The scraper preserved course codes from the text in a `courses` field.
        // Count credits the user has from those courses vs the stated credit target.
        const coursesList = child.courses
        if (coursesList && coursesList.length > 0) {
          const inParens = text.match(/\((\d+(?:\.\d+)?)\s+credits?\)/i)
          const leading  = text.match(/^(\d+(?:\.\d+)?)\s+credits?/i)
          const n = inParens ? parseFloat(inParens[1]) : leading ? parseFloat(leading[1]) : null

          let earned = 0
          for (const code of coursesList) {
            if (userCodes.has(code)) earned += courseMap.get(code)?.credits ?? 0.5
          }

          const max = n ?? coursesList.reduce((s, code) => s + (courseMap.get(code)?.credits ?? 0.5), 0)
          return { met: earned >= max, value: Math.min(earned, max), max, label: text }
        }
      }

      return evaluateNode(child, userCodes, courseMap)
    })

    const earnedCredits = children.reduce((sum, c) => sum + c.value, 0)
    const totalCredits = children.reduce((sum, c) => sum + c.max, 0)

    // Text nodes with max=0 are section headers — don't block group completion
    const evaluatableChildren = children.filter(c => c.max > 0)
    return {
      label: group.label || 'Core Requirements',
      met: evaluatableChildren.length > 0 ? evaluatableChildren.every(c => c.met) : true,
      value: earnedCredits,
      max: totalCredits,
      children
    }
  })

  const programMetCount = groupsEval.filter(g => g.met).length
  const programTotalCount = groupsEval.length

  return {
    met: programMetCount === programTotalCount,
    value: programMetCount,
    max: programTotalCount,
    groups: groupsEval
  }
}
