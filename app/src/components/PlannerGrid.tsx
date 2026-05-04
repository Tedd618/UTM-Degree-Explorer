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

  const startKey = semesterSortKey(plan.startYear ?? 2022, 'Fall')

  const visibleSemesters = plan.semesters.filter(s => {
    if (semesterSortKey(s.year, s.season) < startKey) return false
    if (hideSummers && s.season === 'Summer') return false
    return true
  })

  const sorted = [...visibleSemesters].sort(
    (a, b) => semesterSortKey(b.year, b.season) - semesterSortKey(a.year, a.season),
  )

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Main grid area */}
      <div className="flex-1 overflow-auto p-5 space-y-2">
        {/* Plan title bar */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-utm-navy">{plan.name}</h1>
          <span className="text-xs text-gray-400">
            {plan.semesters.reduce((n, s) => n + s.courses.length, 0)} courses · {plan.semesters.length} semesters
          </span>
        </div>

        {/* Academic year controls — single paired control */}
        {(() => {
          const fallYears = plan.semesters.filter(s => s.season === 'Fall').map(s => s.year)
          const maxFall = fallYears.length > 0 ? Math.max(...fallYears) : null
          const canRemove = maxFall !== null

          function handleAdd() {
            const base = maxFall ?? new Date().getFullYear()
            const nextYear = base + 1
            const hasSem = (yr: number, season: Season) =>
              plan.semesters.some(s => s.year === yr && s.season === season)
            if (!hasSem(nextYear, 'Summer')) addSemester(plan.id, nextYear, 'Summer')
            addSemester(plan.id, nextYear, 'Fall')
            addSemester(plan.id, nextYear + 1, 'Winter')
            addSemester(plan.id, nextYear + 1, 'Summer')
          }

          function handleRemove() {
            if (!maxFall) return
            const toRemove = plan.semesters.filter(s =>
              (s.season === 'Fall'   && s.year === maxFall) ||
              (s.season === 'Winter' && s.year === maxFall + 1) ||
              (s.season === 'Summer' && s.year === maxFall + 1)
            )
            if (toRemove.some(s => s.courses.length > 0) &&
                !window.confirm(`Fall ${maxFall} – Summer ${maxFall + 1} has courses. Remove anyway?`)) return
            toRemove.forEach(s => removeSemester(plan.id, s.id))
          }

          return (
            <div className="flex justify-center mb-1">
              <div className="inline-flex items-center rounded-full border border-gray-200 bg-white shadow-sm overflow-hidden">
                {/* Remove */}
                <button
                  onClick={handleRemove}
                  disabled={!canRemove}
                  title="Remove last academic year"
                  className="px-3 py-1 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-25 disabled:pointer-events-none transition-colors text-sm font-medium border-r border-gray-200"
                >
                  −
                </button>
                {/* Label */}
                <span className="px-3 py-1 text-[11px] font-medium text-gray-400 tracking-wide select-none">
                  Academic Year
                </span>
                {/* Add */}
                <button
                  onClick={handleAdd}
                  title="Add academic year"
                  className="px-3 py-1 text-gray-400 hover:text-utm-blue hover:bg-utm-blue/5 transition-colors text-sm font-medium border-l border-gray-200"
                >
                  +
                </button>
              </div>
            </div>
          )
        })()}

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

        {/* Starting year picker */}
        <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-100 mt-2">
          <span className="text-[11px] text-gray-400">Starting year</span>
          <select
            value={plan.startYear ?? new Date().getFullYear()}
            onChange={e => {
              const newYear = parseInt(e.target.value)
              setStartYear(plan.id, newYear)
              // Auto-create missing semesters from newYear up to the first existing Fall
              const firstFall = Math.min(...plan.semesters.filter(s => s.season === 'Fall').map(s => s.year).filter(y => y >= newYear))
              const limit = isFinite(firstFall) ? firstFall : newYear
              const hasSem = (yr: number, season: Season) => plan.semesters.some(s => s.year === yr && s.season === season)
              for (let y = newYear; y < limit; y++) {
                if (!hasSem(y, 'Fall'))        addSemester(plan.id, y, 'Fall')
                if (!hasSem(y + 1, 'Winter'))  addSemester(plan.id, y + 1, 'Winter')
                if (!hasSem(y + 1, 'Summer'))  addSemester(plan.id, y + 1, 'Summer')
              }
              // Also add Fall for newYear itself if missing
              if (!hasSem(newYear, 'Fall')) addSemester(plan.id, newYear, 'Fall')
            }}
            className="text-[11px] text-gray-600 border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-utm-blue cursor-pointer"
          >
            {Array.from({ length: Math.max(new Date().getFullYear(), plan.startYear ?? 0) + 8 - 2022 + 1 }, (_, i) => 2022 + i).map(yr => (
              <option key={yr} value={yr}>{yr}</option>
            ))}
          </select>
        </div>
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
