import React, { useState, useRef, useEffect } from 'react'
import type { Semester, Course } from '../types'
import { usePlanStore } from '../store/planStore'
import { getCourseStatus, getIssueReasons } from '../utils/prereq'
import { semLabel, isSemPast, isSemCurrent } from '../utils/semester'
import CourseCard from './CourseCard'

const CELL_W = 'w-36'   // fixed width per cell
const MAX_COURSES = 8   // max visible course slots

interface Props {
  planId: string
  semester: Semester
  allSemesters: Semester[]
  courseMap: Map<string, Course>
}

interface AddInputProps {
  planId: string
  semId: string
  courseMap: Map<string, Course>
  onDone: () => void
}

function AddInput({ planId, semId, courseMap, onDone }: AddInputProps) {
  const addCourse = usePlanStore(s => s.addCourse)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  function submit() {
    const code = value.trim().toUpperCase()
    if (!code) { onDone(); return }
    if (!courseMap.has(code)) {
      setError('Course not found')
      return
    }
    addCourse(planId, semId, code)
    onDone()
  }

  return (
    <div className={`${CELL_W} shrink-0`}>
      <div className="rounded-md border border-utm-blue bg-white shadow-sm p-1.5 flex flex-col gap-1">
        <input
          ref={ref}
          value={value}
          onChange={e => { setValue(e.target.value.toUpperCase()); setError('') }}
          onKeyDown={e => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onDone()
          }}
          onBlur={submit}
          placeholder="e.g. CSC148H5"
          className="text-xs w-full outline-none placeholder:text-gray-300 font-mono"
          spellCheck={false}
        />
        {error && <p className="text-[10px] text-red-500">{error}</p>}
      </div>
    </div>
  )
}

export default function SemesterRow({ planId, semester, allSemesters, courseMap }: Props) {
  const removeCourse = usePlanStore(s => s.removeCourse)
  const [adding, setAdding] = useState(false)

  const isPast    = isSemPast(semester)
  const isCurrent = isSemCurrent(semester)

  function semHeaderClass() {
    if (isPast)    return 'text-emerald-700 bg-emerald-50'
    if (isCurrent) return 'text-blue-700 bg-blue-50'
    return 'text-gray-600 bg-gray-50'
  }

  const canAdd = semester.courses.length < MAX_COURSES

  return (
    <div className="flex gap-2 items-start group/row">
      {/* Semester label */}
      <div className={`shrink-0 w-28 rounded-md px-2 py-1 ${semHeaderClass()}`}>
        <p className="text-xs font-semibold leading-tight">{semLabel(semester)}</p>
        <p className="text-[10px] opacity-60 mt-0.5">
          {semester.courses.length} course{semester.courses.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Course cards */}
      <div className="flex flex-wrap gap-2 flex-1">
        {semester.courses.map(code => {
          const status = getCourseStatus(code, semester, allSemesters, courseMap)
          const reasons = status === 'issues'
            ? getIssueReasons(code, semester, allSemesters, courseMap)
            : []
          return (
            <div key={code} className={`${CELL_W} shrink-0`}>
              <CourseCard
                code={code}
                status={status}
                issueReasons={reasons}
                course={courseMap.get(code)}
                onRemove={() => removeCourse(planId, semester.id, code)}
              />
            </div>
          )
        })}

        {/* Add cell */}
        {adding ? (
          <AddInput
            planId={planId}
            semId={semester.id}
            courseMap={courseMap}
            onDone={() => setAdding(false)}
          />
        ) : canAdd ? (
          <button
            onClick={() => setAdding(true)}
            className={`${CELL_W} shrink-0 h-[58px] rounded-md border-2 border-dashed border-gray-200 text-gray-300 text-xs hover:border-utm-blue hover:text-utm-blue transition-colors flex items-center justify-center gap-1`}
          >
            <span className="text-lg leading-none">+</span>
            <span>Add course</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
