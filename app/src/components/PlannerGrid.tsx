import React, { useState, useRef, useCallback } from 'react'
import type { Plan, Course, Season } from '../types'
import { usePlanStore } from '../store/planStore'
import { semesterSortKey } from '../utils/semester'
import SemesterRow from './SemesterRow'
import RequirementsPanel from './RequirementsPanel'

const MIN_PANEL_W = 200
const MAX_PANEL_W = 520
const DEFAULT_PANEL_W = 256

interface Props {
  plan: Plan
  courseMap: Map<string, Course>
}

export default function PlannerGrid({ plan, courseMap }: Props) {
  const hideSummers    = usePlanStore(s => s.hideSummers)
  const addSemester    = usePlanStore(s => s.addSemester)
  const removeSemester = usePlanStore(s => s.removeSemester)
  const setStartYear   = usePlanStore(s => s.setStartYear)

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_W)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: panelWidth }

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX   // dragging left = wider
      const next = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, dragRef.current.startW + delta))
      setPanelWidth(next)
    }

    function onUp() {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth])

  const visibleSemesters = hideSummers
    ? plan.semesters.filter(s => s.season !== 'Summer')
    : plan.semesters

  const sorted = [...visibleSemesters].sort(
    (a, b) => semesterSortKey(b.year, b.season) - semesterSortKey(a.year, a.season),
  )

  const startYear = plan.startYear ?? new Date().getFullYear()
  const yearOptions = Array.from({ length: 10 }, (_, i) => startYear - 4 + i)

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main grid area */}
      <div className="flex-1 overflow-auto p-5 space-y-2">
        {/* Plan title bar */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-utm-navy">{plan.name}</h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <span>First Year</span>
              <select
                value={startYear}
                onChange={e => setStartYear(plan.id, Number(e.target.value))}
                className="text-xs text-gray-600 border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-utm-blue"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>Fall {y}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-gray-400">
              {plan.semesters.reduce((n, s) => n + s.courses.length, 0)} courses · {plan.semesters.length} semesters
            </span>
          </div>
        </div>

        {/* Add / Remove Year at top */}
        <div className="flex justify-center gap-2 mb-1">
          <button
            onClick={() => {
              const fallYears = plan.semesters.filter(s => s.season === 'Fall').map(s => s.year)
              const maxFall = fallYears.length > 0 ? Math.max(...fallYears) : new Date().getFullYear()
              const nextYear = maxFall + 1
              // Academic year: Fall N → Winter N+1 → Summer N+1
              // Also fill the bridging Summer N that the previous year left out
              const hasSem = (yr: number, season: Season) =>
                plan.semesters.some(s => s.year === yr && s.season === season)
              if (!hasSem(nextYear, 'Summer')) addSemester(plan.id, nextYear, 'Summer')
              addSemester(plan.id, nextYear, 'Fall')
              addSemester(plan.id, nextYear + 1, 'Winter')
              addSemester(plan.id, nextYear + 1, 'Summer')
            }}
            className="px-4 py-1 text-sm font-medium rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-utm-blue hover:border-utm-blue hover:bg-utm-blue/5 transition-all flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> Add Academic Year
          </button>

          {plan.semesters.some(s => s.season === 'Fall') && (
            <button
              onClick={() => {
                const fallYears = plan.semesters.filter(s => s.season === 'Fall').map(s => s.year)
                const maxFall = Math.max(...fallYears)
                // The last academic year = Fall maxFall + Winter maxFall+1 + Summer maxFall+1
                const toRemove = plan.semesters.filter(s =>
                  (s.season === 'Fall'   && s.year === maxFall) ||
                  (s.season === 'Winter' && s.year === maxFall + 1) ||
                  (s.season === 'Summer' && s.year === maxFall + 1)
                )
                const hasCourses = toRemove.some(s => s.courses.length > 0)
                if (hasCourses && !window.confirm(
                  `Fall ${maxFall} – Summer ${maxFall + 1} has courses. Remove anyway?`
                )) return
                toRemove.forEach(s => removeSemester(plan.id, s.id))
              }}
              className="px-4 py-1 text-sm font-medium rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-red-500 hover:border-red-400 hover:bg-red-50/40 transition-all flex items-center gap-1.5"
            >
              <span className="text-base leading-none">−</span> Remove Academic Year
            </button>
          )}
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

      {/* Drag divider */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-utm-blue/40 active:bg-utm-blue/60 transition-colors select-none"
        onMouseDown={onDividerMouseDown}
        title="Drag to resize"
      />

      {/* Right panel */}
      <RequirementsPanel plan={plan} courseMap={courseMap} width={panelWidth} />
    </div>
  )
}
