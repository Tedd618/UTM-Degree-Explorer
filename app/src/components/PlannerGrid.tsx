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
      </div>

      {/* Right panel */}
      <RequirementsPanel semesters={plan.semesters} courseMap={courseMap} />
    </div>
  )
}
