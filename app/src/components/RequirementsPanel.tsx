import React, { useState } from 'react'
import type { Plan, Course, Semester, ProgramStructure, PrereqNode, Season } from '../types'
import { getCourseStatus } from '../utils/prereq'
import { evaluateGeneralRequirements, evaluateProgram, NodeEvalResult } from '../utils/evaluator'
import { usePrograms } from '../hooks/usePrograms'
import { usePlanStore } from '../store/planStore'
import { semesterSortKey } from '../utils/semester'

// ─── Smart semester placement ─────────────────────────────────────────────────

function getDirectPrereqCodes(node: PrereqNode | never[]): string[] {
  if (!node || Array.isArray(node)) return []
  switch (node.type) {
    case 'COURSE': return [node.code]
    case 'AND': case 'OR': return node.operands.flatMap(getDirectPrereqCodes)
    case 'RAW': return node.codes
    default: return []
  }
}

function findBestSemester(code: string, plan: Plan, courseMap: Map<string, Course>): string | null {
  const course = courseMap.get(code)
  const sorted = [...plan.semesters].sort(
    (a, b) => semesterSortKey(a.year, a.season) - semesterSortKey(b.year, b.season)
  )

  // Lower bound from direct prerequisites already placed in the plan
  let minKey = 0
  const prereqCodes = course ? getDirectPrereqCodes(course.prerequisites as PrereqNode) : []
  for (const prereq of prereqCodes) {
    for (const sem of plan.semesters) {
      if (sem.courses.includes(prereq)) {
        const key = semesterSortKey(sem.year, sem.season)
        if (key > minKey) minKey = key
      }
    }
  }

  // Fallback: use course level (100→Y1, 200→Y2, …) when no prereqs are placed
  if (minKey === 0) {
    const levelMatch = code.match(/\d{3}/)
    if (levelMatch && sorted.length > 0) {
      const level = parseInt(levelMatch[0])
      const yearOffset = Math.floor(level / 100) - 1   // 0-based
      const targetYear = sorted[0].year + yearOffset
      // Set minKey to just before Fall of that year so Fall is included
      minKey = semesterSortKey(targetYear, 'Fall') - 1
    }
  }

  const offerings: Season[] = (course?.offerings && course.offerings.length > 0)
    ? course.offerings
    : ['Fall', 'Winter']

  // Earliest valid semester: after minKey, correct season, has space, not already added
  for (const sem of sorted) {
    if (semesterSortKey(sem.year, sem.season) <= minKey) continue
    if (sem.courses.length >= 8) continue
    if (sem.courses.includes(code)) continue
    if (!offerings.includes(sem.season)) continue
    return sem.id
  }

  // Last resort: any semester with space
  for (const sem of sorted) {
    if (sem.courses.length < 8 && !sem.courses.includes(code)) return sem.id
  }

  return null
}

interface Props {
  plan: Plan
  courseMap: Map<string, Course>
}

function computeSummary(semesters: Semester[], courseMap: Map<string, Course>) {
  let total = 0, completed = 0, inProgress = 0, planned = 0, issues = 0

  for (const sem of semesters) {
    for (const code of sem.courses) {
      const course = courseMap.get(code)
      const credits = course?.credits ?? 0.5
      const status = getCourseStatus(code, sem, semesters, courseMap)
      total += credits
      if (status === 'completed')        completed  += credits
      else if (status === 'in-progress') inProgress += credits
      else if (status === 'issues')      issues     += credits
      else                               planned    += credits
    }
  }

  return { total, completed, inProgress, planned, issues }
}

function BarSegment({ value, max, color, title }: { value: number; max: number; color: string; title: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  if (pct === 0) return null
  return (
    <div
      title={`${title}: ${value.toFixed(1)} cr`}
      className={`h-full ${color} first:rounded-l-full last:rounded-r-full transition-all cursor-crosshair hover:opacity-80`}
      style={{ width: `${pct}%` }}
    />
  )
}

function GeneralStatRow({ label, stat }: { label: string; stat: { value: number; max: number; met: boolean } }) {
  const dotColor = stat.met ? 'bg-emerald-500' : 'bg-red-400'
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1.5 text-gray-600">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
        {label}
      </span>
      <span className={`font-medium ${stat.met ? 'text-emerald-700' : 'text-gray-500'}`}>
        {stat.value.toFixed(1)} / {stat.max.toFixed(1)}
      </span>
    </div>
  )
}

function ProgramComboStat({ spec, maj, min }: { spec: number; maj: number; min: number }) {
  const met = spec >= 1 || maj >= 2 || (maj >= 1 && min >= 2)
  const dotColor = met ? 'bg-emerald-500' : 'bg-red-400'

  return (
    <div className="flex items-start justify-between text-[11px] pt-1">
      <div className="flex gap-1.5 text-gray-600">
        <span className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full ${dotColor} mt-1`} />
        <div>
          Program Combination
          <div className="text-[9px] text-gray-400 mt-0.5 leading-snug">
            Requires 1 Specialist,<br />or 2 Majors, or 1 Maj + 2 Min
          </div>
        </div>
      </div>
      <div className={`font-medium text-right leading-tight ${met ? 'text-emerald-700' : 'text-gray-500'}`}>
        {met ? 'Valid' : 'Incomplete'}
        <div className="text-[9px] font-normal opacity-60 mt-0.5 uppercase tracking-wider text-gray-400">
          S:{spec} M:{maj} m:{min}
        </div>
      </div>
    </div>
  )
}

// ─── Recursive AST Node Renderer ─────────────────────────────────────────────

function fmtN(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

const COURSE_CODE_RE = /^[A-Z]{3}\d{3}[HY]\d$/

interface NodeRendererProps {
  node: NodeEvalResult
  forceExpand?: boolean
  defaultOpen?: boolean
  depth?: number
  onAddCourse?: (code: string) => void
}

function NodeRenderer({ node, forceExpand, defaultOpen = false, depth = 0, onAddCourse }: NodeRendererProps) {
  const isLeaf = !node.children || node.children.length === 0
  const isCourseLeaf = isLeaf && !!node.label && COURSE_CODE_RE.test(node.label)
  const [open, setOpen] = useState(forceExpand || defaultOpen)
  const isExpanded = open || forceExpand

  const iconColor = node.met ? 'text-emerald-500' : 'text-red-400'
  const textColor = node.met ? 'text-emerald-800' : 'text-gray-700'
  const bgColor   = node.met
    ? 'hover:bg-emerald-50/60'
    : depth === 0
      ? 'bg-red-50/20 hover:bg-red-50/50'
      : 'hover:bg-gray-50'

  const showCredits = node.max > 0 && (!isLeaf || !node.met)

  return (
    <div className="text-[11px]">
      <div
        className={`flex items-center gap-1.5 px-1.5 py-1 rounded transition-colors ${textColor} ${bgColor} ${!isLeaf ? 'cursor-pointer' : ''}`}
        onClick={() => { if (!isLeaf) setOpen(o => !o) }}
      >
        <span className={`shrink-0 text-[10px] font-bold w-3 text-center leading-none select-none ${iconColor}`}>
          {node.met ? '✓' : '✗'}
        </span>
        <div className="flex-1 leading-snug min-w-0">
          <span className="break-words">{node.label}</span>
          {showCredits && (
            <span className="ml-1 text-[10px] text-gray-400 whitespace-nowrap">
              ({fmtN(node.value)}&thinsp;/&thinsp;{fmtN(node.max)}&thinsp;cr)
            </span>
          )}
        </div>

        {/* + button: only on unmet course leaves not yet in plan */}
        {isCourseLeaf && !node.met && onAddCourse && (
          <button
            onClick={e => { e.stopPropagation(); onAddCourse(node.label!) }}
            title={`Add ${node.label} to plan`}
            className="shrink-0 w-4 h-4 rounded-full border border-utm-blue/40 text-utm-blue hover:bg-utm-blue hover:text-white transition-colors flex items-center justify-center text-[10px] leading-none select-none"
          >
            +
          </button>
        )}

        {!isLeaf && (
          <span
            className="text-[8px] text-gray-300 shrink-0 transition-transform select-none"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }}
          >
            ▼
          </span>
        )}
      </div>

      {isExpanded && !isLeaf && node.children && (
        <div className="pl-3 mt-0.5 border-l border-gray-100 space-y-0.5 ml-1.5">
          {node.children.map((child, i) => (
            <NodeRenderer key={i} node={child} forceExpand={forceExpand} depth={depth + 1} onAddCourse={onAddCourse} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function RequirementsPanel({ plan, courseMap }: Props) {
  const { programsMap, loading } = usePrograms()
  const addProgram    = usePlanStore(s => s.addProgram)
  const removeProgram = usePlanStore(s => s.removeProgram)
  const addCourse     = usePlanStore(s => s.addCourse)

  function handleAddCourse(code: string) {
    const semId = findBestSemester(code, plan, courseMap)
    if (semId) addCourse(plan.id, semId, code)
  }

  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [showProgramPicker, setShowProgramPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState(0)

  const s   = computeSummary(plan.semesters, courseMap)
  const gen = evaluateGeneralRequirements(plan.semesters, courseMap)

  const remaining = Math.max(0, 20 - s.total)

  const activePrograms = (plan.programs || [])
    .map(code => programsMap.get(code))
    .filter(Boolean) as ProgramStructure[]

  const numSpec = activePrograms.filter(p => p.type.toLowerCase().includes('specialist')).length
  const numMaj  = activePrograms.filter(p => p.type.toLowerCase().includes('major')).length
  const numMin  = activePrograms.filter(p => p.type.toLowerCase().includes('minor')).length

  const searchResults = Array.from(programsMap.values())
    .filter(p => !plan.programs?.includes(p.code))
    .filter(p => {
      const q = search.toLowerCase()
      return (
        `${p.name} ${p.type}`.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q)
      )
    })
    .slice(0, 50)

  return (
    <aside className="w-64 shrink-0 bg-white border-l border-gray-200 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">

        {/* Credit Summary */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Credit Summary
            </h2>
            <button
              className="p-1 -mr-1 text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setSummaryExpanded(!summaryExpanded)}
              title="Expand Details"
            >
              <span
                className="text-[12px] transition-transform block"
                style={{ transform: summaryExpanded ? 'rotate(180deg)' : 'none' }}
              >
                ▼
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3 mb-2">
            <div className="flex h-3 flex-1 rounded-full bg-gray-100 overflow-hidden">
              <BarSegment value={s.completed}  max={20} color="bg-emerald-500" title="Completed" />
              <BarSegment value={s.inProgress} max={20} color="bg-blue-500"    title="In Progress" />
              <BarSegment value={s.planned}    max={20} color="bg-violet-400"  title="Planned" />
              <BarSegment value={s.issues}     max={20} color="bg-red-400"     title="Issues (Missing Prereq)" />
            </div>
          </div>

          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
            <span>{s.total.toFixed(1)} / 20.0 cr</span>
            <span>{remaining > 0 ? `${remaining.toFixed(1)} left` : 'Target met!'}</span>
          </div>

          {summaryExpanded && (
            <div className="mt-4 pt-3 border-t border-gray-50">
              <div className="space-y-2 mb-2">
                <GeneralStatRow label="200+ Level Credits"     stat={gen.level200} />
                <GeneralStatRow label="300/400+ Level Credits" stat={gen.level300} />
                <GeneralStatRow label="Humanities Dist."       stat={gen.humanities} />
                <GeneralStatRow label="Sciences Dist."         stat={gen.sciences} />
                <GeneralStatRow label="Social Sci Dist."       stat={gen.socialSciences} />
                <div className="h-px bg-gray-100 my-1 w-full" />
                <ProgramComboStat spec={numSpec} maj={numMaj} min={numMin} />
              </div>
            </div>
          )}
        </div>

        {/* Enrolled Programs */}
        <div className="p-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Enrolled Programs
          </h2>

          <div className="space-y-4">
            {activePrograms.map(prog => {
              const res         = evaluateProgram(prog, plan.semesters, courseMap)
              const metGroups   = res.groups.filter(g => g.met).length
              const totalGroups = res.groups.length
              const pct         = totalGroups > 0 ? Math.round((metGroups / totalGroups) * 100) : 0
              const allMet      = metGroups === totalGroups

              return (
                <div key={prog.code} className="border border-gray-100 rounded-lg overflow-hidden relative group">
                  {/* Program header */}
                  <div className={`px-3 pt-3 pb-2 ${allMet ? 'bg-emerald-50/50' : 'bg-gray-50/50'}`}>
                    <button
                      onClick={() => removeProgram(plan.id, prog.code)}
                      className="absolute top-2 right-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity z-10 text-lg leading-none"
                      title="Remove Program"
                    >
                      ×
                    </button>
                    <h3 className="font-semibold text-xs text-utm-navy pr-5 leading-snug">{prog.name}</h3>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[9px] text-gray-400 uppercase tracking-widest">{prog.type}</span>
                      <span className={`text-[10px] font-semibold ${allMet ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {metGroups}/{totalGroups} · {pct}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full transition-all ${allMet ? 'bg-emerald-500' : 'bg-utm-blue'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Requirement tree */}
                  <div className="px-2 py-2 space-y-0.5">
                    {res.groups.map((g, i) => (
                      <NodeRenderer
                        key={i}
                        node={g}
                        defaultOpen={!g.met}
                        depth={0}
                        onAddCourse={handleAddCourse}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {activePrograms.length === 0 && !loading && (
              <div className="text-xs text-gray-400 italic text-center py-4">
                No programs added yet.
              </div>
            )}
          </div>

          {/* Add Program */}
          {!showProgramPicker ? (
            <button
              onClick={() => setShowProgramPicker(true)}
              disabled={loading}
              className="mt-4 w-full py-1.5 border border-dashed border-gray-300 rounded text-xs font-medium text-gray-500 hover:text-utm-blue hover:border-utm-blue transition-colors disabled:opacity-50"
            >
              + Add Program
            </button>
          ) : (
            <div className="mt-4 flex flex-col items-center">
              <div className="relative w-full">
                <input
                  type="text"
                  autoFocus
                  placeholder="Type to search programs..."
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-utm-blue shadow-inner"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setHighlighted(0) }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setHighlighted(h => Math.min(h + 1, searchResults.length - 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setHighlighted(h => Math.max(h - 1, 0))
                    } else if (e.key === 'Enter' && searchResults[highlighted]) {
                      addProgram(plan.id, searchResults[highlighted].code)
                      setShowProgramPicker(false)
                      setSearch('')
                    } else if (e.key === 'Escape') {
                      setShowProgramPicker(false)
                      setSearch('')
                    }
                  }}
                />
                {search.trim().length > 0 && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-lg max-h-56 overflow-y-auto top-full">
                    {searchResults.length === 0 ? (
                      <div className="p-2 text-xs text-gray-400 text-center">No matching programs found.</div>
                    ) : (
                      searchResults.map((p, idx) => (
                        <button
                          key={p.code}
                          onClick={() => {
                            addProgram(plan.id, p.code)
                            setShowProgramPicker(false)
                            setSearch('')
                          }}
                          className={`w-full text-left text-[11px] p-2 text-gray-700 leading-tight border-b border-gray-50 last:border-0 transition-colors ${idx === highlighted ? 'bg-utm-light' : 'hover:bg-utm-light'}`}
                        >
                          <div className="font-medium text-utm-navy leading-tight">
                            {p.name} <span className="opacity-80 font-normal">{p.type}</span>
                          </div>
                          <div className="text-gray-400 text-[9px] mt-1 tracking-wider uppercase">{p.code}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => { setShowProgramPicker(false); setSearch('') }}
                className="w-full mt-2 text-[10px] text-gray-400 hover:text-gray-600 uppercase tracking-wider font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

      </div>
    </aside>
  )
}
