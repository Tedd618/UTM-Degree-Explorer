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
}

// Flat set of user planned courses for quick lookup
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
      const earnedCredits = children.reduce((sum, c) => sum + c.value, 0)
      const totalCredits = children.reduce((sum, c) => sum + c.max, 0)
      return { met: anyMet, value: earnedCredits, max: totalCredits, label: 'One of:', children }
    }
    case 'n_from': {
      const children = (node.items || []).map(child => evaluateNode(child, userCodes, courseMap))
      const target = node.n || 1
      const earned = children.reduce((sum, c) => sum + c.value, 0)
      return { met: earned >= target, value: earned, max: target, label: `Choose ${target} credit(s) from:`, children }
    }
    case 'limit': {
      const children = (node.items || []).map(child => evaluateNode(child, userCodes, courseMap))
      const cap = node.limit || 0
      const earned = Math.min(children.reduce((sum, c) => sum + c.value, 0), cap)
      return { met: earned >= cap, value: earned, max: cap, label: `Up to ${cap} credit(s) from:`, children }
    }
    case 'open_pool': {
      // open_pool is usually credit-based
      const targetCredits = node.n || 0
      let collected = 0

      // Simplistic greedy matching: iterate all user codes and see if they match the pool logic.
      // This allows overlap but correctly calculates credit totals assuming the user is fulfilling it.
      for (const code of userCodes) {
        if (node.excluding && node.excluding.includes(code)) continue
        if (node.specific_courses && node.specific_courses.includes(code)) {
          const c = courseMap.get(code)
          collected += c?.credits ?? 0.5
          continue
        }

        const matchLevel = node.min_level || node.max_level
        if (matchLevel) {
          const numLevelMatch = code.match(/\d{3}/)
          if (numLevelMatch) {
            const numLevel = parseInt(numLevelMatch[0], 10)
            if (node.min_level && numLevel < node.min_level) continue
            if (node.max_level && numLevel > node.max_level) continue
          } else {
            continue
          }
        }

        if (node.subject) {
          if (!code.startsWith(node.subject)) continue
        }

        const c = courseMap.get(code)
        collected += c?.credits ?? 0.5
      }

      const met = collected >= targetCredits
      return { met, value: collected, max: targetCredits, label: node.description || `Pool: ${targetCredits} credits` }
    }
    case 'text': {
      return { met: false, value: 0, max: 0, label: node.text || 'Requirement notation (Check manually)' }
    }
    default:
      return { met: false, value: 0, max: 0, label: `Unknown requirement type: ${node.type}` }
  }
}

export function evaluateProgram(program: ProgramStructure, semesters: Semester[], courseMap: Map<string, Course>) {
  const userCodes = getUniqueCourses(semesters)
  
  const groupsEval = program.completion.groups.map(group => {
    const children = group.items.map(child => evaluateNode(child, userCodes, courseMap))
    const earnedCredits = children.reduce((sum, c) => sum + c.value, 0)
    const totalCredits = children.reduce((sum, c) => sum + c.max, 0)

    return {
      label: group.label || 'Core Requirements',
      met: children.every(c => c.met),
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
