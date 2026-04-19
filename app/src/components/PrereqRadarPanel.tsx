import React, { useState, useMemo } from 'react'
import type { Course, MissingGroup } from '../types'
import { usePlanStore } from '../store/planStore'
import { collectMissingPrereqGroups, evaluatePrereq } from '../utils/prereq'
import { semesterSortKey, isSemPast } from '../utils/semester'

// ---------------------------------------------------------------------------
// Drag source ID used to identify drags originating from the Radar panel
// ---------------------------------------------------------------------------
export const RADAR_DRAG_PREFIX = '__radar__'

interface Props {
  planId: string
  courseMap: Map<string, Course>
}

// ---------------------------------------------------------------------------
// Helper: render a MissingGroup as text
// ---------------------------------------------------------------------------
function groupLabel(g: MissingGroup): string {
  if (g.kind === 'single') return g.code
  if (g.kind === 'or') return g.options.join(' or ')
  if (g.kind === 'and') return g.parts.map(groupLabel).join(' and ')
  return ''
}

// ---------------------------------------------------------------------------
// A single draggable chip for one course code option
// ---------------------------------------------------------------------------
interface ChipProps {
  code: string
  courseMap: Map<string, Course>
}
function CourseChip({ code, courseMap }: ChipProps) {
  const course = courseMap.get(code)
  const [dragging, setDragging] = useState(false)

  function onDragStart(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'copy'
    // Encode a special payload so SemesterRow knows this is from the Radar
    e.dataTransfer.setData('text/plain', `${RADAR_DRAG_PREFIX}${code}`)
    setDragging(true)
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      title={course ? `${code} — ${course.title}` : code}
      className={`
        inline-flex flex-col gap-0 px-2 py-1 rounded-md border cursor-grab active:cursor-grabbing select-none
        transition-all text-left
        ${dragging
          ? 'opacity-40 border-utm-blue bg-utm-blue/5'
          : 'border-gray-200 bg-white hover:border-utm-blue hover:shadow-sm'
        }
      `}
    >
      <span className="text-[11px] font-mono font-semibold text-utm-navy leading-tight">{code}</span>
      {course && (
        <span className="text-[9px] text-gray-400 leading-tight truncate max-w-[120px]">{course.title}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One missing prereq item row
// ---------------------------------------------------------------------------
interface ItemProps {
  neededBy: string
  group: MissingGroup
  planId: string
  courseMap: Map<string, Course>
}

function RadarItem({ neededBy, group, planId, courseMap }: ItemProps) {
  const ignorePrereq = usePlanStore(s => s.ignorePrereq)

  function renderGroup(g: MissingGroup): React.ReactNode {
    if (g.kind === 'single') {
      return <CourseChip key={g.code} code={g.code} courseMap={courseMap} />
    }
    if (g.kind === 'or') {
      return (
        <div className="flex flex-wrap gap-1 items-center rounded border border-dashed border-gray-400 p-1.5 bg-white/50">
          {g.options.map((code, i) => (
            <React.Fragment key={code}>
              {i > 0 && <span className="text-[10px] text-gray-400 font-medium">or</span>}
              <CourseChip code={code} courseMap={courseMap} />
            </React.Fragment>
          ))}
        </div>
      )
    }
    if (g.kind === 'and') {
      return (
        <div className="flex flex-col gap-1 rounded border border-dashed border-gray-400 p-1.5 bg-white/50">
          {g.parts.map((part, i) => (
            <div key={i} className="flex flex-wrap gap-1 items-center">
              {i > 0 && <span className="text-[10px] text-gray-400 font-medium">and</span>}
              {renderGroup(part)}
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  // Collect all codes that can be ignored (leaf codes of this group)
  function ignoreKeys(g: MissingGroup): string[] {
    if (g.kind === 'single') return [g.code]
    if (g.kind === 'or') return g.options
    if (g.kind === 'and') return g.parts.flatMap(ignoreKeys)
    return []
  }

  function handleIgnore() {
    for (const code of ignoreKeys(group)) {
      ignorePrereq(planId, code)
    }
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-2">
      {/* Needed by */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-gray-400 font-medium">
          needed by <span className="font-mono text-gray-600">{neededBy}</span>
        </span>
        <button
          onClick={handleIgnore}
          title="Dismiss from radar"
          className="text-[10px] text-gray-300 hover:text-red-400 transition-colors flex items-center gap-0.5 cursor-pointer"
        >
          <span>✕</span>
        </button>
      </div>

      {/* The missing group (draggable chips) */}
      {renderGroup(group)}

      {/* Drag hint */}
      <p className="text-[9px] text-gray-300 leading-tight">drag into any semester</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function PrereqRadarPanel({ planId, courseMap }: Props) {
  const plans        = usePlanStore(s => s.plans)
  const ignoredPrereqs = usePlanStore(s => s.ignoredPrereqs)
  const clearIgnoredPrereqs = usePlanStore(s => s.clearIgnoredPrereqs)
  const [collapsed, setCollapsed] = useState(false)

  const plan = plans.find(p => p.id === planId)
  const ignored = new Set(ignoredPrereqs[planId] ?? [])

  // Compute missing prereqs for every non-past course in the plan
  const missingItems = useMemo(() => {
    if (!plan) return []

    const items: Array<{ neededBy: string; group: MissingGroup }> = []

    // Sort semesters chronologically
    const sorted = [...plan.semesters].sort(
      (a, b) => semesterSortKey(a.year, a.season) - semesterSortKey(b.year, b.season)
    )

    for (const sem of sorted) {
      const semKey = semesterSortKey(sem.year, sem.season)
      const codesBefore = new Set<string>(
        sorted
          .filter(s => semesterSortKey(s.year, s.season) < semKey)
          .flatMap(s => s.courses)
      )

      for (const code of sem.courses) {
        const course = courseMap.get(code)
        if (!course) continue
        if (evaluatePrereq(course.prerequisites, codesBefore)) continue

        const groups = collectMissingPrereqGroups(course.prerequisites, codesBefore)
        for (const g of groups) {
          // Filter out ignored codes — if all leaf codes are ignored, skip group
          const filtered = filterIgnored(g, ignored)
          if (filtered) {
            items.push({ neededBy: code, group: filtered })
          }
        }
      }
    }

    return items
  }, [plan, courseMap, ignoredPrereqs])

  const count = missingItems.length

  return (
    <aside
      className={`
        shrink-0 flex flex-col border-l border-gray-200 bg-white transition-all duration-200
        ${collapsed ? 'w-10' : 'w-56'}
      `}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-2 py-2 border-b border-gray-100 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        {!collapsed && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Prereq Radar</span>
            {count > 0 && (
              <span className="text-[10px] font-bold bg-red-100 text-red-600 rounded-full px-1.5 py-0.5 leading-none">
                {count}
              </span>
            )}
          </div>
        )}
        <button
          className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-gray-500 transition-colors shrink-0 ml-auto cursor-pointer"
          title={collapsed ? 'Expand radar' : 'Collapse radar'}
        >
          {collapsed ? '◀' : '▶'}
        </button>
      </div>

      {/* Panel body */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="text-2xl">✅</span>
              <p className="text-xs text-gray-400 leading-snug">All prerequisites met!</p>
            </div>
          ) : (
            <>
              {missingItems.map((item, i) => (
                <RadarItem
                  key={`${item.neededBy}-${i}`}
                  neededBy={item.neededBy}
                  group={item.group}
                  planId={planId}
                  courseMap={courseMap}
                />
              ))}

              {/* Clear ignored */}
              {(ignoredPrereqs[planId]?.length ?? 0) > 0 && (
                <button
                  onClick={() => clearIgnoredPrereqs(planId)}
                  className="w-full text-[10px] text-gray-300 hover:text-gray-500 transition-colors py-1 cursor-pointer"
                >
                  Reset ignored prereqs
                </button>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Filter out any leaf codes that are ignored; return null if group is fully ignored
// ---------------------------------------------------------------------------
function filterIgnored(group: MissingGroup, ignored: Set<string>): MissingGroup | null {
  if (group.kind === 'single') {
    return ignored.has(group.code) ? null : group
  }
  if (group.kind === 'or') {
    const opts = group.options.filter(c => !ignored.has(c))
    if (opts.length === 0) return null
    if (opts.length === 1) return { kind: 'single', code: opts[0] }
    return { kind: 'or', options: opts }
  }
  if (group.kind === 'and') {
    const parts = group.parts.map(p => filterIgnored(p, ignored)).filter(Boolean) as MissingGroup[]
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    return { kind: 'and', parts }
  }
  return null
}
