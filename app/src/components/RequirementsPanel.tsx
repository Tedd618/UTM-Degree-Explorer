import React from 'react'
import type { Semester, Course } from '../types'
import { getCourseStatus } from '../utils/prereq'

interface Props {
  semesters: Semester[]
  courseMap: Map<string, Course>
}

interface CreditSummary {
  total: number
  completed: number
  inProgress: number
  planned: number
  issues: number
}

function computeSummary(semesters: Semester[], courseMap: Map<string, Course>): CreditSummary {
  let total = 0, completed = 0, inProgress = 0, planned = 0, issues = 0

  for (const sem of semesters) {
    for (const code of sem.courses) {
      const course = courseMap.get(code)
      const credits = course?.credits ?? 0.5
      const status = getCourseStatus(code, sem, semesters, courseMap)
      total += credits
      if (status === 'completed')    completed  += credits
      else if (status === 'in-progress') inProgress += credits
      else if (status === 'issues')  issues  += credits
      else                           planned += credits
    }
  }

  return { total, completed, inProgress, planned, issues }
}

interface BarSegmentProps {
  value: number
  max: number
  color: string
  title: string
}

function BarSegment({ value, max, color, title }: BarSegmentProps) {
  const pct = max > 0 ? (value / max) * 100 : 0
  if (pct === 0) return null
  return (
    <div
      title={title}
      className={`h-full ${color} first:rounded-l-full last:rounded-r-full transition-all`}
      style={{ width: `${pct}%` }}
    />
  )
}

interface StatRowProps { label: string; value: number; color: string }
function StatRow({ label, value, color }: StatRowProps) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-gray-600">
        <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
        {label}
      </span>
      <span className="font-medium text-gray-800 tabular-nums">{value.toFixed(1)}</span>
    </div>
  )
}

const DEGREE_CREDIT_TARGET = 20 // typical UTM degree

export default function RequirementsPanel({ semesters, courseMap }: Props) {
  const s = computeSummary(semesters, courseMap)
  const target = DEGREE_CREDIT_TARGET
  const remaining = Math.max(0, target - s.total)

  return (
    <aside className="w-56 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-gray-100">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Credit Summary</h2>

        {/* Progress bar */}
        <div className="flex h-3 w-full rounded-full bg-gray-100 overflow-hidden mb-2">
          <BarSegment value={s.completed}  max={target} color="bg-emerald-500" title="Completed" />
          <BarSegment value={s.inProgress} max={target} color="bg-blue-500"    title="In Progress" />
          <BarSegment value={s.planned}    max={target} color="bg-violet-400"  title="Planned" />
          <BarSegment value={s.issues}     max={target} color="bg-red-400"     title="Has Issues" />
        </div>

        <div className="flex justify-between text-[10px] text-gray-400 mb-3">
          <span>{s.total.toFixed(1)} / {target} credits</span>
          <span>{remaining > 0 ? `${remaining.toFixed(1)} remaining` : 'Target met!'}</span>
        </div>

        <div className="space-y-1.5">
          <StatRow label="Completed"   value={s.completed}  color="bg-emerald-500" />
          <StatRow label="In Progress" value={s.inProgress} color="bg-blue-500"    />
          <StatRow label="Planned"     value={s.planned}    color="bg-violet-400"  />
          {s.issues > 0 && <StatRow label="Has Issues" value={s.issues} color="bg-red-400" />}
        </div>
      </div>

      <div className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Legend</h2>
        <div className="space-y-1.5 text-xs text-gray-500">
          {[
            { color: 'bg-emerald-500', label: 'Completed — past semester' },
            { color: 'bg-blue-500',    label: 'In Progress — current term' },
            { color: 'bg-violet-500',  label: 'Planned — no issues' },
            { color: 'bg-red-500',     label: 'Issues — prereq missing / exclusion conflict' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-start gap-2">
              <span className={`shrink-0 inline-block w-2 h-2 rounded-full mt-0.5 ${color}`} />
              <span className="leading-snug">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
