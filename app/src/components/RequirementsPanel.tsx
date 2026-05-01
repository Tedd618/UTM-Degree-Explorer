import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Plan, Course, Semester, ProgramStructure, RequirementNode } from '../types'
import { getCourseStatus } from '../utils/prereq'
import { evaluateGeneralRequirements, evaluateProgram, NodeEvalResult } from '../utils/evaluator'
import { usePrograms } from '../hooks/usePrograms'
import { usePlanStore } from '../store/planStore'

/** Collect every explicit course code mentioned anywhere in a program's requirement tree. */
function collectProgramCourseCodes(program: ProgramStructure): Set<string> {
  const codes = new Set<string>()
  function walk(node: RequirementNode) {
    if (node.type === 'course' && node.code) { codes.add(node.code); return }
    if ('items' in node && Array.isArray(node.items)) node.items.forEach(walk)
  }
  for (const group of program.completion.groups) group.items.forEach(walk)
  return codes
}

/**
 * Compute the approximate number of distinct credits across all enrolled programs.
 * Logic: sum all program total-required credits, then subtract credits for any course
 * code that appears in 2+ programs (those would be double-counted shared courses).
 */
function computeDistinctCredits(
  programs: ProgramStructure[],
  courseMap: Map<string, Course>,
  semesters: Semester[],
): { distinct: number; combined: number; overlap: number } {
  if (programs.length === 0) return { distinct: 0, combined: 0, overlap: 0 }

  // Total required credits per program (from evaluateProgram)
  const combined = programs.reduce((sum, prog) => {
    const res = evaluateProgram(prog, semesters, courseMap)
    return sum + res.groups.reduce((s, g) => s + g.max, 0)
  }, 0)

  // Count how many programs each course code appears in
  const codeFreq = new Map<string, number>()
  for (const prog of programs) {
    for (const code of collectProgramCourseCodes(prog)) {
      codeFreq.set(code, (codeFreq.get(code) ?? 0) + 1)
    }
  }

  // Overlap = credits of courses shared by 2+ programs
  let overlap = 0
  for (const [code, freq] of codeFreq) {
    if (freq > 1) overlap += courseMap.get(code)?.credits ?? 0.5
  }

  return { distinct: combined - overlap, combined, overlap }
}

// Drag prefix — SemesterRow checks for this and copies the course into the dropped semester
export const REQ_DRAG_PREFIX = '__req__'

// ─── Credit summary helpers ───────────────────────────────────────────────────

interface Props {
  plan: Plan
  courseMap: Map<string, Course>
  width?: number
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
          <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">
            Requires 1 Specialist,<br />or 2 Majors, or 1 Maj + 2 Min
          </div>
        </div>
      </div>
      <div className={`font-medium text-right leading-tight ${met ? 'text-emerald-700' : 'text-gray-500'}`}>
        {met ? 'Valid' : 'Incomplete'}
        <div className="text-[11px] font-normal opacity-60 mt-0.5 uppercase tracking-wider text-gray-400">
          S:{spec} M:{maj} m:{min}
        </div>
      </div>
    </div>
  )
}

// ─── Course Pill ──────────────────────────────────────────────────────────────
// Draggable, colored by met-status, shows tooltip on hover

function fmtN(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

const COURSE_CODE_RE = /^[A-Z]{3}\d{3}[HY]\d$/

interface CoursePillProps {
  code: string
  met: boolean
  courseMap: Map<string, Course>
}

function CoursePill({ code, met, courseMap }: CoursePillProps) {
  const course   = courseMap.get(code)
  const [dragging, setDragging] = useState(false)
  const [tipPos,   setTipPos]   = useState<{ x: number; y: number } | null>(null)
  const pillRef = useRef<HTMLSpanElement>(null)

  // Close tooltip on scroll so it doesn't drift
  useEffect(() => {
    if (!tipPos) return
    const hide = () => setTipPos(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [tipPos])

  function handleMouseEnter() {
    if (!pillRef.current) return
    const r = pillRef.current.getBoundingClientRect()
    setTipPos({ x: r.left, y: r.top })
  }

  const tooltip = tipPos && createPortal(
    <span
      className="fixed z-[99999] w-64 bg-gray-900 text-white rounded-xl p-3 shadow-2xl text-[10px] leading-snug pointer-events-none block"
      style={{ left: tipPos.x, top: tipPos.y - 8, transform: 'translateY(-100%)' }}
    >
      <span className="font-semibold text-[11px] block mb-1">
        {code}{course && ` — ${course.title}`}
      </span>
      {course?.credits && (
        <span className="text-gray-300 block mb-1">{course.credits} credit{course.credits !== 1 ? 's' : ''}</span>
      )}
      {course?.description && (
        <span className="text-gray-400 block leading-relaxed line-clamp-5">{course.description}</span>
      )}
      {!course && <span className="text-gray-400 italic">Course info unavailable</span>}
    </span>,
    document.body
  )

  return (
    <span className="relative inline-block leading-none">
      <span
        ref={pillRef}
        draggable
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData('text/plain', `${REQ_DRAG_PREFIX}${code}`)
          setDragging(true)
          setTipPos(null)
        }}
        onDragEnd={() => setDragging(false)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTipPos(null)}
        className={`
          inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold
          cursor-grab active:cursor-grabbing select-none transition-all
          ${met
            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200'
            : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
          }
          ${dragging ? 'opacity-40' : 'hover:shadow-sm'}
        `}
      >
        {met && <span className="text-emerald-500 text-[11px]">✓</span>}
        {code}
      </span>
      {tooltip}
    </span>
  )
}

// ─── Pool Node ────────────────────────────────────────────────────────────────
// Expandable "Choose N from …" / "Up to N from …" node (for n_from / limit)

interface PoolNodeProps {
  node: NodeEvalResult
  courseMap: Map<string, Course>
  depth: number
}

function PoolNode({ node, courseMap, depth }: PoolNodeProps) {
  const [poolOpen, setPoolOpen] = useState(false)
  const label = node.label ?? ''
  const children = node.children ?? []
  const credStr = node.max > 0 ? ` · ${fmtN(node.value)}/${fmtN(node.max)} cr` : ''

  return (
    <span className="inline-flex flex-col gap-1">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] cursor-pointer select-none
          ${node.met ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700'}
        `}
        onClick={() => setPoolOpen(o => !o)}
      >
        {node.met && <span className="text-emerald-500 text-[11px]">✓</span>}
        <span>{label}{credStr}</span>
        <span
          className="text-[9px] opacity-60 transition-transform"
          style={{ transform: poolOpen ? 'rotate(180deg)' : 'none' }}
        >
          ▼
        </span>
      </span>
      {poolOpen && (
        <span className="flex flex-wrap gap-1 pl-1">
          {children.map((child, i) => (
            <InlineNode key={i} node={child} courseMap={courseMap} depth={depth + 1} />
          ))}
        </span>
      )}
    </span>
  )
}

// ─── Open Pool Node ───────────────────────────────────────────────────────────
// Expandable pool for open_pool nodes — shows all valid courses from courseMap

interface OpenPoolNodeProps {
  node: NodeEvalResult
  courseMap: Map<string, Course>
}

function OpenPoolNode({ node, courseMap }: OpenPoolNodeProps) {
  const [open, setOpen] = useState(false)
  const label = node.label ?? ''
  const credStr = node.max > 0 ? ` · ${fmtN(node.value)}/${fmtN(node.max)} cr` : ''
  const courses = node.poolCourses ?? []

  const sorted = [...courses].sort()
  const taken = new Set(node.takenFromPool ?? [])

  return (
    <span className="inline-flex flex-col gap-1 w-full">
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] cursor-pointer select-none leading-snug
          ${node.met ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}
        `}
        onClick={() => setOpen(o => !o)}
      >
        {node.met && <span className="text-emerald-500 text-[11px] shrink-0">✓</span>}
        <span className="flex-1">{label}{credStr}</span>
        {sorted.length > 0 && (
          <span className="text-[9px] opacity-60 shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
            ▼ {sorted.length} courses
          </span>
        )}
      </span>
      {open && sorted.length > 0 && (
        <span className="flex flex-wrap gap-1 pl-1 pt-0.5">
          {sorted.map(code => (
            <CoursePill
              key={code}
              code={code}
              met={taken.has(code)}
              courseMap={courseMap}
            />
          ))}
        </span>
      )}
    </span>
  )
}

// ─── Collapsible One-Of Node ──────────────────────────────────────────────────
// For one_of with many options (> ONE_OF_COLLAPSE_THRESHOLD), render as a
// collapsed badge instead of an always-expanded inline list.

const ONE_OF_COLLAPSE_THRESHOLD = 5

interface CollapsibleOneOfProps {
  node: NodeEvalResult
  courseMap: Map<string, Course>
  depth: number
}

function CollapsibleOneOfNode({ node, courseMap, depth }: CollapsibleOneOfProps) {
  const [open, setOpen] = useState(false)
  const children = node.children ?? []
  const metCount = children.filter(c => c.met).length
  const credStr = node.max > 0 ? ` · ${fmtN(node.value)}/${fmtN(node.max)} cr` : ''

  return (
    <span className="inline-flex flex-col gap-1">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] cursor-pointer select-none
          ${node.met ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700'}
        `}
        onClick={() => setOpen(o => !o)}
      >
        {node.met && <span className="text-emerald-500 text-[11px]">✓</span>}
        <span>
          {node.met
            ? `1 of ${children.length} options met`
            : `Choose 1 from ${children.length} options`}
          {credStr}
        </span>
        {metCount > 0 && !node.met && (
          <span className="text-[11px] text-emerald-600 font-medium">({metCount} taken)</span>
        )}
        <span className="text-[9px] opacity-60 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </span>
      {open && (
        <span className="flex flex-wrap gap-1 pl-1">
          {children.map((child, i) => (
            <InlineNode key={i} node={child} courseMap={courseMap} depth={depth + 1} />
          ))}
        </span>
      )}
    </span>
  )
}

// ─── Inline Node Renderer ─────────────────────────────────────────────────────
// Renders a NodeEvalResult tree inline (horizontally) rather than as a deep tree

interface InlineNodeProps {
  node: NodeEvalResult
  courseMap: Map<string, Course>
  depth?: number
}

function InlineNode({ node, courseMap, depth = 0 }: InlineNodeProps) {
  const label = node.label ?? ''
  const children = node.children ?? []

  // ── Course leaf ──
  if (COURSE_CODE_RE.test(label)) {
    return <CoursePill code={label} met={node.met} courseMap={courseMap} />
  }

  // ── open_pool: expandable course list (check before childless-text so poolCourses wins) ──
  if (node.poolCourses !== undefined) {
    return <OpenPoolNode node={node} courseMap={courseMap} />
  }

  // ── Childless text node (section header / plain note) ──
  if (children.length === 0) {
    if (!label) return null
    const credStr = node.max > 0 ? ` (${fmtN(node.value)}/${fmtN(node.max)} cr)` : ''
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] leading-snug
        ${node.met
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : node.max > 0
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-gray-50 border-gray-200 text-gray-500 italic'
        }`}>
        {node.met && <span className="text-emerald-500 text-[11px]">✓</span>}
        {label}{credStr}
      </span>
    )
  }

  // ── All of: join children with "and" ──
  if (label === 'All of:') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {children.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-[11px] text-gray-400 font-medium">and</span>}
            <InlineNode node={child} courseMap={courseMap} depth={depth + 1} />
          </React.Fragment>
        ))}
      </span>
    )
  }

  // ── One of: show bracketed alternatives (collapse when large) ──
  if (label === 'One of:') {
    if (children.length > ONE_OF_COLLAPSE_THRESHOLD) {
      return <CollapsibleOneOfNode node={node} courseMap={courseMap} depth={depth} />
    }
    return (
      <span className={`inline-flex flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 border border-dashed
        ${node.met ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-300 bg-gray-50/40'}
      `}>
        {children.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-[11px] text-gray-400 font-medium px-0.5">or</span>}
            <InlineNode node={child} courseMap={courseMap} depth={depth + 1} />
          </React.Fragment>
        ))}
      </span>
    )
  }

  // ── N from / Choose: credit pool — delegate to separate component to satisfy hooks rules ──
  if (label.startsWith('Choose') || label.startsWith('Up to')) {
    return <PoolNode node={node} courseMap={courseMap} depth={depth} />
  }

  // ── Everything else (unrecognised) ──
  const credStr = node.max > 0 ? ` (${fmtN(node.value)}/${fmtN(node.max)} cr)` : ''
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]
      ${node.met ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}
    `}>
      {node.met && <span className="text-emerald-500 text-[11px]">✓</span>}
      {label}{credStr}
    </span>
  )
}

// ─── Group Row ────────────────────────────────────────────────────────────────
// One numbered requirement group, rendered flat

interface GroupRowProps {
  index: number
  group: NodeEvalResult & { label: string }
  courseMap: Map<string, Course>
}

function GroupRow({ index, group, courseMap }: GroupRowProps) {
  const [open, setOpen] = useState(!group.met)
  const children = group.children ?? []

  useEffect(() => {
    if (group.met) setOpen(false)
  }, [group.met])
  const credStr = group.max > 0 ? `${fmtN(group.value)}/${fmtN(group.max)} cr` : null

  return (
    <div className={`rounded-lg border text-[11px] overflow-hidden ${group.met ? 'border-gray-100' : 'border-red-100 bg-red-50/20'}`}>
      {/* Group header — click to expand/collapse */}
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none
          ${group.met ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'bg-red-50/30 hover:bg-red-50/60'}
        `}
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-[11px] text-gray-400 shrink-0 font-medium">{index}.</span>
        <span className={`shrink-0 font-bold text-[11px] ${group.met ? 'text-emerald-500' : 'text-red-400'}`}>
          {group.met ? '✓' : '✗'}
        </span>
        <span className={`flex-1 text-xs font-medium leading-snug ${group.met ? 'text-emerald-800' : 'text-gray-700'}`}>
          {group.label || 'Requirements'}
        </span>
        {credStr && (
          <span className={`text-[11px] shrink-0 tabular-nums ${group.met ? 'text-emerald-600' : 'text-gray-400'}`}>
            {credStr}
          </span>
        )}
        <span
          className="text-[9px] text-gray-300 shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▼
        </span>
      </div>

      {/* Inline requirement content */}
      {open && children.length > 0 && (
        <div className="px-3 py-2 space-y-1.5 border-t border-gray-100/80">
          {children.map((child, i) => {
            const isHeader = child.max === 0 && (child.children?.length ?? 0) === 0

            if (isHeader) {
              // Section divider label
              return (
                <div key={i} className="text-[11px] text-gray-400 uppercase tracking-wider pt-1">
                  {child.label}
                </div>
              )
            }

            const childCredStr = child.max > 0 ? `${fmtN(child.value)}/${fmtN(child.max)} cr` : null

            return (
              <div key={i} className="flex flex-wrap items-start gap-1.5">
                <InlineNode node={child} courseMap={courseMap} />
                {/* Show credits for one_of (small) and plain text nodes; suppress for all others that self-display credits */}
                {childCredStr &&
                  child.label !== 'All of:' &&
                  child.label !== 'One of:' &&
                  !(child.label ?? '').startsWith('Choose') &&
                  !(child.label ?? '').startsWith('Up to') &&
                  child.poolCourses === undefined &&
                  !COURSE_CODE_RE.test(child.label ?? '') && (
                  <span className="text-[11px] text-gray-400 self-center whitespace-nowrap">
                    {childCredStr}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function RequirementsPanel({ plan, courseMap, width }: Props) {
  const { programsMap, loading } = usePrograms()
  const addProgram    = usePlanStore(s => s.addProgram)
  const removeProgram = usePlanStore(s => s.removeProgram)

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
    <aside
      className="shrink-0 bg-white border-l border-gray-200 flex flex-col h-full overflow-hidden"
      style={{ width: width ?? 256 }}
    >
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
            <div className="flex h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
              <BarSegment value={s.completed}  max={20} color="bg-emerald-500" title="Completed" />
              <BarSegment value={s.inProgress} max={20} color="bg-blue-500"    title="In Progress" />
              <BarSegment value={s.planned}    max={20} color="bg-violet-400"  title="Planned" />
              <BarSegment value={s.issues}     max={20} color="bg-red-400"     title="Issues (Missing Prereq)" />
            </div>
          </div>

          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
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

                {activePrograms.length >= 2 && (() => {
                  const { distinct, overlap } = computeDistinctCredits(activePrograms, courseMap, plan.semesters)
                  const met = distinct >= 12
                  return (
                    <div className="pt-1 space-y-1">
                      <div className="h-px bg-gray-100 w-full" />
                      <div className="flex items-start justify-between text-[11px] pt-1">
                        <div className="flex gap-1.5 text-gray-600">
                          <span className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full mt-1 ${met ? 'bg-emerald-500' : 'bg-red-400'}`} />
                          <div>
                            Distinct Program Credits
                            <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                              Combined programs must have<br />≥ 12 credits not shared between them
                            </div>
                          </div>
                        </div>
                        <div className={`font-medium text-right leading-tight ${met ? 'text-emerald-700' : 'text-gray-500'}`}>
                          {distinct.toFixed(1)} / 12.0
                          {overlap > 0 && (
                            <div className="text-[11px] font-normal text-gray-400 mt-0.5">
                              −{overlap.toFixed(1)} shared
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Enrolled Programs */}
        <div className="p-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-gray-300 mb-3">
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
                      <span className="text-[11px] text-gray-400 uppercase tracking-widest">{prog.type}</span>
                      <span className={`text-[11px] font-semibold ${allMet ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {metGroups}/{totalGroups} · {pct}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full transition-all ${allMet ? 'bg-emerald-500' : 'bg-utm-blue'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Flat requirement groups */}
                  <div className="p-2 space-y-1">
                    {res.groups.map((g, i) => (
                      <GroupRow
                        key={i}
                        index={i + 1}
                        group={g as NodeEvalResult & { label: string }}
                        courseMap={courseMap}
                      />
                    ))}
                  </div>

                  {/* Drag hint */}
                  <div className="px-3 pb-2 text-[11px] text-gray-300 text-center">
                    drag a course chip into any semester
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
              className="mt-4 w-full py-1.5 border border-dashed border-gray-300 rounded text-sm font-medium text-gray-500 hover:text-utm-blue hover:border-utm-blue transition-colors disabled:opacity-50"
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
