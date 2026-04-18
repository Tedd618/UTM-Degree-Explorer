import React, { useState } from 'react'
import type { Course, CourseStatus } from '../types'

const STATUS_LABEL: Record<CourseStatus, string> = {
  completed:   'Completed',
  'in-progress': 'In Progress',
  'no-issues': 'No Issues',
  issues:      'Issues Found',
  unknown:     'Unknown',
}

const STATUS_CLASS: Record<CourseStatus, string> = {
  completed:   'status-completed',
  'in-progress': 'status-in-progress',
  'no-issues': 'status-no-issues',
  issues:      'status-issues',
  unknown:     'status-unknown',
}

interface Props {
  code: string
  status: CourseStatus
  issueReasons: string[]
  course: Course | undefined
  onRemove: () => void
}

export default function CourseCard({ code, status, issueReasons, course, onRemove }: Props) {
  const [showTip, setShowTip] = useState(false)

  return (
    <div
      className="relative group flex flex-col rounded-md overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow cursor-default"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      {/* Colored status band at top */}
      <div className={`h-1.5 w-full ${STATUS_CLASS[status]}`} />

      <div className="px-2 py-1.5 flex items-start justify-between gap-1 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-800 leading-tight truncate">{code}</p>
          {course && (
            <p className="text-[10px] text-gray-400 leading-tight truncate mt-0.5">{course.title}</p>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          title="Remove"
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 rounded-full flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 text-xs leading-none mt-0.5"
        >
          ×
        </button>
      </div>

      {/* Status badge */}
      <div className="px-2 pb-1.5">
        <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_CLASS[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* Tooltip */}
      {showTip && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-52 bg-gray-900 text-white text-[11px] rounded-lg shadow-xl p-3 pointer-events-none">
          <p className="font-semibold text-white mb-1">{code}</p>
          {course && <p className="text-gray-300 mb-2 leading-snug">{course.title}</p>}
          {course && (
            <div className="text-gray-400 space-y-0.5 mb-2">
              <p>{course.credits} credit{course.credits !== 1 ? 's' : ''}</p>
              {course.distribution && <p>{course.distribution}</p>}
            </div>
          )}
          {issueReasons.length > 0 && (
            <ul className="mt-1 space-y-0.5 border-t border-white/10 pt-1.5">
              {issueReasons.map((r, i) => (
                <li key={i} className="text-red-300 flex gap-1">
                  <span className="shrink-0">⚠</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
          {course?.prerequisites?.length ? (
            <p className="mt-1.5 text-gray-500 border-t border-white/10 pt-1.5">
              <span className="text-gray-400">Prereqs: </span>
              {course.prerequisites.join(', ')}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
