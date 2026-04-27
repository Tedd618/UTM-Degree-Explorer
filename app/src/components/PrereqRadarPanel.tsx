import React, { useState, useMemo } from 'react'
import type { Course, MissingGroup } from '../types'
import { usePlanStore } from '../store/planStore'
import { collectMissingPrereqGroups, evaluatePrereq } from '../utils/prereq'
import { semesterSortKey, isSemPast } from '../utils/semester'

export const RADAR_DRAG_PREFIX = '__radar__'

interface Props {
  planId: string
  courseMap: Map<string, Course>
}

function groupLabel(g: MissingGroup): string {
  if (g.kind === 'single') return g.code
  if (g.kind === 'or')     return g.options.map(groupLabel).join(' or ')
  if (g.kind === 'and')    return g.parts.map(groupLabel).join(' and ')
  if (g.kind === 'credit') return `≥${g.minimum} credits`
  if (g.kind === 'level_pool') {
    if (g.specific_courses.length > 0) return `${g.n} cr from ${g.specific_courses.join('/')}`
    const subj = g.subjects ? g.subjects.join('/') : 'any'
    const lvl = g.min_level ? ` ${g.min_level}-level` : ''
    return `${g.n} cr${lvl} ${subj}`
  }
  return ''
}

interface ChipProps {
  code: string
  courseMap: Map<string, Course>
}
function CourseChip({ code, courseMap }: ChipProps) {
  const course = courseMap.get(code)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', `${RADAR_DRAG_PREFIX}${code}`)
        setDragging(true)
      }}
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

/** Non-draggable badge for credit-count requirements */
function CreditBadge({ minimum }: { minimum: number }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-200 bg-amber-50 select-none">
      <span className="text-[10px] text-amber-700 font-semibold leading-tight">≥{minimum} credits completed</span>
    </div>
  )
}

interface ItemProps {
  neededBy: string
  group: MissingGroup
  planId: string
  courseMap: Map<string, Course>
}

function RadarItem({ neededBy, group, planId, courseMap }: ItemProps) {
  const ignorePrereq = usePlanStore(s => s.ignorePrereq)

  function renderGroup(g: MissingGroup): React.ReactNode {
    if (g.kind === 'single') return <CourseChip key={g.code} code={g.code} courseMap={courseMap} />
    if (g.kind === 'credit') return <CreditBadge minimum={g.minimum} />
    if (g.kind === 'level_pool') {
      const label = g.specific_courses.length > 0
        ? `${g.n} cr from: ${g.specific_courses.join(', ')}`
        : (() => {
            const subj = g.subjects ? g.subjects.join('/') : 'any subject'
            const lvl = g.min_level && g.max_level ? ` ${g.min_level}–${g.max_level}-level` : g.min_level ? ` ${g.min_level}+-level` : ''
            return `${g.n} credit(s) in${lvl} ${subj}`
          })()
      return (
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-purple-200 bg-purple-50 select-none">
          <span className="text-[10px] text-purple-700 font-semibold leading-tight">{label}</span>
        </div>
      )
    }
    if (g.kind === 'or') {
      return (
        <div className="flex flex-wrap gap-1 items-center rounded border border-dashed border-gray-400 p-1.5 bg-white/50">
          {g.options.map((opt, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-[10px] text-gray-400 font-medium">or</span>}
              {renderGroup(opt)}
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

  function ignoreKeys(g: MissingGroup): string[] {
    if (g.kind === 'single') return [g.code]
    if (g.kind === 'or')     return g.options.flatMap(ignoreKeys)
    if (g.kind === 'and')    return g.parts.flatMap(ignoreKeys)
    if (g.kind === 'credit') return [`__credit_${g.minimum}`]
    if (g.kind === 'level_pool') return [`__pool_${g.n}_${(g.subjects || []).join('_')}_${g.min_level}_${g.max_level}`]
    return []
  }

  function handleIgnore() {
    for (const key of ignoreKeys(group)) {
      ignorePrereq(planId, key)
    }
  }

  const hasDraggable = hasDraggableLeaf(group)

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-2">
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

      {renderGroup(group)}

      {hasDraggable && (
        <p className="text-[9px] text-gray-300 leading-tight">drag into any semester</p>
      )}
    </div>
  )
}

function hasDraggableLeaf(g: MissingGroup): boolean {
  if (g.kind === 'single') return true
  if (g.kind === 'credit') return false
  if (g.kind === 'level_pool') return false
  if (g.kind === 'or')  return g.options.some(hasDraggableLeaf)
  if (g.kind === 'and') return g.parts.some(hasDraggableLeaf)
  return false
}

export default function PrereqRadarPanel({ planId, courseMap }: Props) {
  const plans             = usePlanStore(s => s.plans)
  const ignoredPrereqs    = usePlanStore(s => s.ignoredPrereqs)
  const clearIgnoredPrereqs = usePlanStore(s => s.clearIgnoredPrereqs)
  const [collapsed, setCollapsed] = useState(false)

  const plan    = plans.find(p => p.id === planId)
  const ignored = new Set(ignoredPrereqs[planId] ?? [])

  const missingItems = useMemo(() => {
    if (!plan) return []

    const items: Array<{ neededBy: string; group: MissingGroup }> = []

    const sorted = [...plan.semesters].sort(
      (a, b) => semesterSortKey(a.year, a.season) - semesterSortKey(b.year, b.season)
    )

    for (const sem of sorted) {
      if (isSemPast(sem)) continue
      const semKey = semesterSortKey(sem.year, sem.season)
      const codesBefore = new Set<string>(
        sorted
          .filter(s => semesterSortKey(s.year, s.season) < semKey)
          .flatMap(s => s.courses)
      )

      for (const code of sem.courses) {
        const course = courseMap.get(code)
        if (!course) continue
        if (evaluatePrereq(course.prerequisites, codesBefore, courseMap)) continue

        const groups = collectMissingPrereqGroups(course.prerequisites, codesBefore, courseMap)
        for (const g of groups) {
          const filtered = filterIgnored(g, ignored)
          if (filtered) items.push({ neededBy: code, group: filtered })
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
        <div className="relative shrink-0 ml-auto">
          <button
            className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-gray-500 transition-colors cursor-pointer"
            title={collapsed ? 'Expand radar' : 'Collapse radar'}
          >
            {collapsed ? '◀' : '▶'}
          </button>
          {/* Pulsing badge when collapsed and there are issues */}
          {collapsed && count > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center">
              <span className="absolute inline-flex w-3.5 h-3.5 rounded-full bg-red-400 opacity-75 animate-ping" />
              <span className="relative inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[7px] font-bold leading-none">
                {count > 9 ? '9+' : count}
              </span>
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="text-2xl">✓</span>
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

function filterIgnored(group: MissingGroup, ignored: Set<string>): MissingGroup | null {
  if (group.kind === 'single') return ignored.has(group.code) ? null : group
  if (group.kind === 'credit') return ignored.has(`__credit_${group.minimum}`) ? null : group
  if (group.kind === 'level_pool') {
    const key = `__pool_${group.n}_${(group.subjects || []).join('_')}_${group.min_level}_${group.max_level}`
    return ignored.has(key) ? null : group
  }
  if (group.kind === 'or') {
    const opts = group.options.map(o => filterIgnored(o, ignored)).filter(Boolean) as MissingGroup[]
    if (opts.length === 0) return null
    if (opts.length === 1) return opts[0]
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
