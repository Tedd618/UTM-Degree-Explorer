import React, { useState, useRef, useEffect } from 'react'
import type { Semester, Course } from '../types'
import { usePlanStore } from '../store/planStore'
import { getCourseStatus, getIssueReasons } from '../utils/prereq'
import { semLabel, isSemPast, isSemCurrent } from '../utils/semester'
import CourseCard from './CourseCard'
import { RADAR_DRAG_PREFIX } from './PrereqRadarPanel'
import { REQ_DRAG_PREFIX } from './RequirementsPanel'

const MAX_COURSES = 8
const CELL_W = 'w-36'

let dragState: { planId: string; fromSemId: string; code: string } | null = null

interface Props {
  planId: string
  semester: Semester
  allSemesters: Semester[]
  courseMap: Map<string, Course>
}

/* ─── Autocomplete add-input ─── */

interface AddInputProps {
  planId: string
  semId: string
  courseMap: Map<string, Course>
  onDone: () => void
}

function AddInput({ planId, semId, courseMap, onDone }: AddInputProps) {
  const addCourse = usePlanStore(s => s.addCourse)
  const [value, setValue]             = useState('')
  const [suggestions, setSuggestions] = useState<Course[]>([])
  const [highlighted, setHighlighted] = useState(-1)
  const [error, setError]             = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function filterCourses(raw: string) {
    const q = raw.toUpperCase().trim()
    if (q.length < 2) { setSuggestions([]); return }

    const exact: Course[]      = []
    const startsWith: Course[] = []
    const contains: Course[]   = []

    for (const c of courseMap.values()) {
      if (c.code === q) {
        exact.push(c)
      } else if (c.code.startsWith(q)) {
        startsWith.push(c)
      } else if (c.code.includes(q) || c.title.toUpperCase().includes(q)) {
        contains.push(c)
      }
      if (exact.length + startsWith.length + contains.length >= 40) break
    }

    const results = [...exact, ...startsWith, ...contains].slice(0, 20)
    setSuggestions(results)
    setHighlighted(-1)
  }

  function selectSuggestion(c: Course) {
    addCourse(planId, semId, c.code)
    onDone()
  }

  function submit(code?: string) {
    const target = (code ?? value).trim().toUpperCase()
    if (!target) { onDone(); return }
    if (!courseMap.has(target)) { setError('Course not found'); return }
    addCourse(planId, semId, target)
    onDone()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onDone(); return }
    if (suggestions.length === 0) {
      if (e.key === 'Enter') submit()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlighted >= 0) selectSuggestion(suggestions[highlighted])
      else submit()
    }
  }

  const open = suggestions.length > 0
  const noResults = value.trim().length >= 2 && suggestions.length === 0

  return (
    <div className={`${CELL_W} shrink-0 relative`}>
      <div className={`rounded-md border bg-white shadow-sm p-1.5 flex flex-col gap-1 ${error ? 'border-red-400' : 'border-utm-blue'}`}>
        <input
          ref={inputRef}
          value={value}
          onChange={e => {
            const v = e.target.value.toUpperCase()
            setValue(v)
            setError('')
            filterCourses(v)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setTimeout(() => {
              setSuggestions([])
              submit()
            }, 120)
          }}
          placeholder="e.g. CSC148H5"
          className="text-xs w-full outline-none placeholder:text-gray-300 font-mono"
          spellCheck={false}
          autoComplete="off"
        />
        {error && <p className="text-[10px] text-red-500">{error}</p>}
        {noResults && !error && (
          <p className="text-[10px] text-gray-400">No courses found</p>
        )}
      </div>

      {open && (
        <ul className="absolute left-0 top-full mt-0.5 z-50 w-72 bg-white border border-gray-200 rounded-lg shadow-xl overflow-y-auto max-h-64 py-1">
          {suggestions.map((c, i) => (
            <li
              key={c.code}
              className={`flex items-baseline gap-2 px-3 py-1.5 cursor-pointer text-xs ${i === highlighted ? 'bg-utm-blue text-white' : 'hover:bg-gray-50 text-gray-800'}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectSuggestion(c)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className={`font-mono font-semibold shrink-0 ${i === highlighted ? 'text-white' : 'text-utm-navy'}`}>{c.code}</span>
              <span className={`truncate ${i === highlighted ? 'text-white/80' : 'text-gray-400'}`}>{c.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ─── Semester row ─── */

export default function SemesterRow({ planId, semester, allSemesters, courseMap }: Props) {
  const removeCourse = usePlanStore(s => s.removeCourse)
  const moveCourse   = usePlanStore(s => s.moveCourse)
  const addCourse    = usePlanStore(s => s.addCourse)
  const [adding, setAdding]         = useState(false)
  const [dropIndex, setDropIndex]   = useState<number | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const isPast    = isSemPast(semester)
  const isCurrent = isSemCurrent(semester)
  const canAdd    = semester.courses.length < MAX_COURSES

  function semHeaderClass() {
    if (isPast)    return 'text-emerald-700 bg-emerald-50'
    if (isCurrent) return 'text-blue-700 bg-blue-50'
    return 'text-gray-600 bg-gray-50'
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    const hasRadar = e.dataTransfer.types.includes('text/plain')
    if (!dragState && !hasRadar) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dragState ? 'move' : 'copy'
    setDropIndex(idx)
    setIsDragOver(true)
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault()
    const raw = e.dataTransfer.getData('text/plain')
    if (raw.startsWith(RADAR_DRAG_PREFIX)) {
      addCourse(planId, semester.id, raw.slice(RADAR_DRAG_PREFIX.length))
      setDropIndex(null)
      setIsDragOver(false)
      return
    }
    if (raw.startsWith(REQ_DRAG_PREFIX)) {
      addCourse(planId, semester.id, raw.slice(REQ_DRAG_PREFIX.length))
      setDropIndex(null)
      setIsDragOver(false)
      return
    }
    if (!dragState) return
    moveCourse(dragState.planId, dragState.fromSemId, semester.id, dragState.code, idx)
    dragState = null
    setDropIndex(null)
    setIsDragOver(false)
  }

  function handleDragLeave() {
    setDropIndex(null)
    setIsDragOver(false)
  }

  // Build fixed slot array: filled courses + optional add input + empty placeholders
  const slots: Array<'course' | 'add' | 'empty'> = []
  semester.courses.forEach(() => slots.push('course'))
  if (canAdd && !adding) slots.push('add')
  if (adding) slots.push('add')
  while (slots.length < MAX_COURSES) slots.push('empty')

  let courseIdx = 0

  return (
    <div className="flex gap-2 items-start group/row">
      {/* Semester label */}
      <div className={`shrink-0 w-28 rounded-md px-2 py-1.5 ${semHeaderClass()}`}>
        <p className="text-xs font-semibold leading-tight">{semLabel(semester)}</p>
        <p className="text-[10px] opacity-60 mt-0.5">
          {semester.courses.length}/{MAX_COURSES}
        </p>
      </div>

      {/* Fixed grid of slots */}
      <div
        className={`grid gap-2 flex-1 rounded-md p-1 transition-colors ${isDragOver ? 'bg-utm-blue/5 ring-1 ring-utm-blue/20' : ''}`}
        style={{ gridTemplateColumns: `repeat(${MAX_COURSES}, ${9 /* w-36 = 9rem */}rem)` }}
        onDragOver={e => handleDragOver(e, semester.courses.length)}
        onDrop={e => handleDrop(e, semester.courses.length)}
        onDragLeave={handleDragLeave}
      >
        {slots.map((slot, slotIdx) => {
          if (slot === 'course') {
            const code = semester.courses[courseIdx++]
            const idx  = slotIdx
            const status  = getCourseStatus(code, semester, allSemesters, courseMap)
            const reasons = getIssueReasons(code, semester, allSemesters, courseMap)

            return (
              <React.Fragment key={code}>
                {dropIndex === idx && dragState?.code !== code && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-utm-blue"
                    onDragOver={e => { e.stopPropagation(); handleDragOver(e, idx) }}
                    onDrop={e => { e.stopPropagation(); handleDrop(e, idx) }}
                  />
                )}
                <div
                  className={`${CELL_W} shrink-0 transition-opacity relative ${dragState?.code === code ? 'opacity-30' : ''}`}
                  draggable
                  onDragStart={e => {
                    dragState = { planId, fromSemId: semester.id, code }
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    dragState = null
                    setDropIndex(null)
                    setIsDragOver(false)
                  }}
                  onDragOver={e => { e.stopPropagation(); handleDragOver(e, idx) }}
                  onDrop={e => { e.stopPropagation(); handleDrop(e, idx) }}
                >
                  <CourseCard
                    code={code}
                    status={status}
                    issueReasons={reasons}
                    course={courseMap.get(code)}
                    onRemove={() => removeCourse(planId, semester.id, code)}
                  />
                </div>
              </React.Fragment>
            )
          }

          if (slot === 'add') {
            return adding ? (
              <AddInput
                key="__add__"
                planId={planId}
                semId={semester.id}
                courseMap={courseMap}
                onDone={() => setAdding(false)}
              />
            ) : (
              <button
                key="__add__"
                onClick={() => setAdding(true)}
                className={`${CELL_W} shrink-0 h-[52px] rounded-md border-2 border-dashed border-gray-200 text-gray-300 text-xs hover:border-utm-blue hover:text-utm-blue transition-colors flex items-center justify-center gap-1`}
              >
                <span className="text-lg leading-none">+</span>
                <span>Add</span>
              </button>
            )
          }

          // empty placeholder
          return (
            <div
              key={`__empty_${slotIdx}`}
              className={`${CELL_W} shrink-0 h-[52px] rounded-md border border-dashed border-gray-100`}
            />
          )
        })}
      </div>
    </div>
  )
}
