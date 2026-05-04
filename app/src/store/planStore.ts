import { create } from 'zustand'
import { supabase } from '../utils/supabase'
import type { Plan, Semester, Season } from '../types'
import { buildDefaultSemesters, semesterSortKey, currentSemesterKey, currentAcademicStartYear } from '../utils/semester'

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function createDefaultPlan(startYear?: number): Plan {
  const y = startYear ?? currentAcademicStartYear()
  return {
    id: newId(),
    name: 'My Plan',
    semesters: buildDefaultSemesters(y),
    programs: [],
    startYear: y,
  }
}

interface PlanStore {
  plans: Plan[]
  activePlanId: string
  hideSummers: boolean

  /** Per-plan set of course codes the user has dismissed from the radar. */
  ignoredPrereqs: Record<string, string[]>

  // cloud sync override
  setStoreData: (plans: Plan[], ignored: Record<string, string[]>, activeId?: string) => void

  // plan CRUD
  addPlan: () => void
  removePlan: (id: string) => void
  duplicatePlan: (id: string) => void
  renamePlan: (id: string, name: string) => void
  setActivePlan: (id: string) => void
  toggleHideSummers: () => void

  // program management
  addProgram: (planId: string, code: string) => void
  removeProgram: (planId: string, code: string) => void

  setStartYear: (planId: string, year: number) => void

  // semester management
  addSemester: (planId: string, year: number, season: Season) => void
  removeSemester: (planId: string, semId: string) => void

  // course management
  addCourse: (planId: string, semId: string, code: string) => void
  removeCourse: (planId: string, semId: string, code: string) => void
  moveCourse: (planId: string, fromSemId: string, toSemId: string, code: string, toIndex: number) => void

  // bulk import — replace courses in each semester by season/year
  importCourses: (planId: string, entries: Array<{ year: number; season: Season; courses: string[] }>) => void

  // radar actions
  /**
   * Dismiss a missing prereq from the radar for this plan.
   * code is the missing prereq course code to ignore.
   */
  ignorePrereq: (planId: string, code: string) => void
  /** Reset all ignored prereqs for this plan. */
  clearIgnoredPrereqs: (planId: string) => void

  /** Override a course's "issues" status → treat as no-issues. Key: __issue__semId__code */
  toggleIssueOverride: (planId: string, semId: string, code: string) => void

  // derived helpers
  activePlan: () => Plan | undefined
}

const defaultPlan = createDefaultPlan()

export const usePlanStore = create<PlanStore>()((set, get) => ({
  plans: [defaultPlan],
  activePlanId: defaultPlan.id,
  hideSummers: false,
  ignoredPrereqs: {},

  setStoreData: (plans, ignored, activeId) => {
    set(state => {
      // If no plans provided, create a fresh default plan
      const finalPlans = plans.length > 0 ? plans : [createDefaultPlan()]
      // Preserve the current selection if it still exists in the incoming plans
      const preferredId = activeId ?? state.activePlanId
      const validId = finalPlans.find(p => p.id === preferredId)
        ? preferredId
        : finalPlans[0].id
      return { plans: finalPlans, ignoredPrereqs: ignored, activePlanId: validId }
    })
  },

  activePlan: () => get().plans.find(p => p.id === get().activePlanId),

      addPlan: () =>
        set(state => {
          const plan = createDefaultPlan()
          plan.name = `Plan ${state.plans.length + 1}`
          return { plans: [...state.plans, plan], activePlanId: plan.id }
        }),

      removePlan: (id) =>
        set(state => {
          const remaining = state.plans.filter(p => p.id !== id)
          if (remaining.length === 0) {
            const fresh = createDefaultPlan()
            return { plans: [fresh], activePlanId: fresh.id }
          }
          const activeId = state.activePlanId === id ? remaining[0].id : state.activePlanId
          return { plans: remaining, activePlanId: activeId }
        }),

      duplicatePlan: (id) =>
        set(state => {
          const source = state.plans.find(p => p.id === id)
          if (!source) return state
          const copy: Plan = {
            ...source,
            id: newId(),
            name: `${source.name} (copy)`,
            semesters: source.semesters.map(s => ({ ...s, id: newId(), courses: [...s.courses] })),
            programs: [...(source.programs || [])],
          }
          const idx = state.plans.findIndex(p => p.id === id)
          const plans = [...state.plans]
          plans.splice(idx + 1, 0, copy)
          return { plans, activePlanId: copy.id }
        }),

      renamePlan: (id, name) =>
        set(state => ({
          plans: state.plans.map(p => p.id === id ? { ...p, name } : p),
        })),

      setActivePlan: (id) => set({ activePlanId: id }),

      toggleHideSummers: () => set(state => ({ hideSummers: !state.hideSummers })),

      addProgram: (planId, code) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            const current = p.programs || []
            if (current.includes(code)) return p
            return { ...p, programs: [...current, code] }
          })
        })),

      removeProgram: (planId, code) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            return { ...p, programs: (p.programs || []).filter(c => c !== code) }
          })
        })),

      setStartYear: (planId, year) =>
        set(state => ({
          plans: state.plans.map(p => p.id === planId ? { ...p, startYear: year } : p),
        })),

      addSemester: (planId, year, season) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            const newSem: Semester = { id: newId(), year, season, courses: [] }
            return { ...p, semesters: [...p.semesters, newSem] }
          }),
        })),

      removeSemester: (planId, semId) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            return { ...p, semesters: p.semesters.filter(s => s.id !== semId) }
          }),
        })),

      addCourse: (planId, semId, code) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            return {
              ...p,
              semesters: p.semesters.map(s => {
                if (s.id !== semId) return s
                if (s.courses.includes(code)) return s
                return { ...s, courses: [...s.courses, code] }
              }),
            }
          }),
        })),

      removeCourse: (planId, semId, code) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            return {
              ...p,
              semesters: p.semesters.map(s => {
                if (s.id !== semId) return s
                return { ...s, courses: s.courses.filter(c => c !== code) }
              }),
            }
          }),
        })),

      moveCourse: (planId, fromSemId, toSemId, code, toIndex) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p
            const sems = p.semesters.map(s => {
              if (s.id === fromSemId) {
                return { ...s, courses: s.courses.filter(c => c !== code) }
              }
              return s
            }).map(s => {
              if (s.id === toSemId) {
                if (s.courses.includes(code)) return s
                const courses = [...s.courses]
                courses.splice(toIndex, 0, code)
                return { ...s, courses }
              }
              return s
            })
            return { ...p, semesters: sems }
          }),
        })),

      importCourses: (planId, entries) =>
        set(state => ({
          plans: state.plans.map(p => {
            if (p.id !== planId) return p

            // Update existing semesters that appear in the import
            let sems = p.semesters.map(s => {
              const entry = entries.find(e => e.year === s.year && e.season === s.season)
              if (!entry) return s
              return { ...s, courses: entry.courses }
            })

            // Auto-create semesters from the import that don't exist yet
            for (const entry of entries) {
              const exists = sems.some(s => s.year === entry.year && s.season === entry.season)
              if (!exists) {
                sems = [...sems, { id: newId(), year: entry.year, season: entry.season, courses: entry.courses }]
              }
            }

            // Re-sort semesters chronologically
            sems = [...sems].sort((a, b) => semesterSortKey(a.year, a.season) - semesterSortKey(b.year, b.season))

            // Insert missing Summer semesters before any Fall that has no preceding Summer of the same year
            const hasSummer = (yr: number) => sems.some(s => s.season === 'Summer' && s.year === yr)
            const filled: Semester[] = []
            for (let i = 0; i < sems.length; i++) {
              if (sems[i].season === 'Fall' && !hasSummer(sems[i].year)) {
                filled.push({ id: newId(), year: sems[i].year, season: 'Summer', courses: [] })
              }
              filled.push(sems[i])
            }
            sems = filled

            return { ...p, semesters: sems }
          }),
        })),

      ignorePrereq: (planId, code) =>
        set(state => {
          const existing = state.ignoredPrereqs[planId] ?? []
          if (existing.includes(code)) return state
          return {
            ignoredPrereqs: {
              ...state.ignoredPrereqs,
              [planId]: [...existing, code],
            },
          }
        }),

      toggleIssueOverride: (planId, semId, code) =>
        set(state => {
          const key = `__issue__${semId}__${code}`
          const existing = state.ignoredPrereqs[planId] ?? []
          const has = existing.includes(key)
          return {
            ignoredPrereqs: {
              ...state.ignoredPrereqs,
              [planId]: has ? existing.filter(k => k !== key) : [...existing, key],
            },
          }
        }),


      clearIgnoredPrereqs: (planId) =>
        set(state => ({
          ignoredPrereqs: { ...state.ignoredPrereqs, [planId]: [] },
        })),
}))

// Auto-save to cloud
let saveTimeout: ReturnType<typeof setTimeout> | null = null

usePlanStore.subscribe((state, prevState) => {
  if (state.plans === prevState.plans && state.ignoredPrereqs === prevState.ignoredPrereqs) return

  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return

    // Delete plans that were removed
    const removedIds = prevState.plans
      .map(p => p.id)
      .filter(id => !state.plans.some(p => p.id === id))
    if (removedIds.length > 0) {
      const { error } = await supabase.from('plans').delete().in('id', removedIds).eq('user_id', session.user.id)
      if (error) console.error('Failed to delete plans:', error)
    }

    // Upsert remaining plans
    if (state.plans.length > 0) {
      const rows = state.plans.map(p => ({
        id: p.id,
        user_id: session.user.id,
        name: p.name,
        semesters: p.semesters,
        programs: p.programs || [],
        ignored_prereqs: state.ignoredPrereqs[p.id] || []
      }))
      const { error } = await supabase.from('plans').upsert(rows)
      if (error) console.error('Failed to sync plans:', error)
    }
  }, 1000)
})
