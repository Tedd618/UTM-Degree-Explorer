import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Plan, Semester, Season } from '../types'
import { buildDefaultSemesters } from '../utils/semester'

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function createDefaultPlan(): Plan {
  return {
    id: newId(),
    name: 'My Plan',
    semesters: buildDefaultSemesters(),
  }
}

interface PlanStore {
  plans: Plan[]
  activePlanId: string
  hideSummers: boolean

  // plan CRUD
  addPlan: () => void
  removePlan: (id: string) => void
  renamePlan: (id: string, name: string) => void
  setActivePlan: (id: string) => void
  toggleHideSummers: () => void

  // semester management
  addSemester: (planId: string, year: number, season: Season) => void
  removeSemester: (planId: string, semId: string) => void

  // course management
  addCourse: (planId: string, semId: string, code: string) => void
  removeCourse: (planId: string, semId: string, code: string) => void
  moveCourse: (planId: string, fromSemId: string, toSemId: string, code: string, toIndex: number) => void

  // bulk import — replace courses in each semester by season/year
  importCourses: (planId: string, entries: Array<{ year: number; season: Season; courses: string[] }>) => void

  // derived helpers
  activePlan: () => Plan | undefined
}

const defaultPlan = createDefaultPlan()

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      plans: [defaultPlan],
      activePlanId: defaultPlan.id,
      hideSummers: false,

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

      renamePlan: (id, name) =>
        set(state => ({
          plans: state.plans.map(p => p.id === id ? { ...p, name } : p),
        })),

      setActivePlan: (id) => set({ activePlanId: id }),

      toggleHideSummers: () => set(state => ({ hideSummers: !state.hideSummers })),

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
            const sems = p.semesters.map(s => {
              const entry = entries.find(e => e.year === s.year && e.season === s.season)
              // Only update semesters present in the import; leave others untouched
              if (!entry) return s
              return { ...s, courses: entry.courses }
            })
            return { ...p, semesters: sems }
          }),
        })),
    }),
    {
      name: 'utm-degree-explorer-v1',
    },
  ),
)
