import React from 'react'
import type { Plan, Course } from '../types'
import { usePlanStore } from '../store/planStore'
import { semesterSortKey } from '../utils/semester'
import SemesterRow from './SemesterRow'
import RequirementsPanel from './RequirementsPanel'

interface Props {
  plan: Plan
  courseMap: Map<string, Course>
}

export default function PlannerGrid({ plan, courseMap }: Props) {
  const hideSummers = usePlanStore(s => s.hideSummers)
  const addSemester = usePlanStore(s => s.addSemester)

  const visibleSemesters = hideSummers
    ? plan.semesters.filter(s => s.season !== 'Summer')
    : plan.semesters

  const sorted = [...visibleSemesters].sort(
    (a, b) => semesterSortKey(a.year, a.season) - semesterSortKey(b.year, b.season),
  )

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main grid area */}
      <div className="flex-1 overflow-auto p-5 space-y-3">
        {/* Plan title bar */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-utm-navy">{plan.name}</h1>
          <span className="text-xs text-gray-400">
            {plan.semesters.reduce((n, s) => n + s.courses.length, 0)} courses across {plan.semesters.length} semesters
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-300">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">No semesters to display.</p>
            <p className="text-xs mt-1">Uncheck "Hide summer semesters" to see all.</p>
          </div>
        ) : (
          sorted.map(sem => (
            <SemesterRow
              key={sem.id}
              planId={plan.id}
              semester={sem}
              allSemesters={plan.semesters}
              courseMap={courseMap}
            />
          ))
        )}

        <div className="flex justify-center mt-6 mb-4">
          <button
            onClick={() => {
              const fallYears = plan.semesters.filter(s => s.season === 'Fall').map(s => s.year)
              const maxFall = fallYears.length > 0 ? Math.max(...fallYears) : new Date().getFullYear()
              const nextYear = maxFall + 1
              addSemester(plan.id, nextYear, 'Fall')
              addSemester(plan.id, nextYear + 1, 'Winter')
              addSemester(plan.id, nextYear + 1, 'Summer')
            }}
            className="px-4 py-1.5 text-sm font-medium rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-utm-blue hover:border-utm-blue hover:bg-utm-blue/5 transition-all w-full max-w-sm flex items-center justify-center gap-2"
          >
            <span className="text-lg leading-none">+</span> Add Academic Year
          </button>
        </div>
      </div>

      {/* Right panel */}
      <RequirementsPanel plan={plan} courseMap={courseMap} />
    </div>
  )
}
