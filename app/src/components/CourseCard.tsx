import React, { useState, useRef, useEffect } from 'react'
import type { Course, CourseStatus } from '../types'
import { formatPrereq } from '../utils/prereq'

const STATUS_LABEL: Record<CourseStatus, string> = {
  completed:     'Completed',
  'in-progress': 'In Progress',
  'no-issues':   'No Issues',
  issues:        'Issues Found',
  unknown:       'Unknown',
}

// Used for tooltip header background
const STATUS_CLASS: Record<CourseStatus, string> = {
  completed:     'status-completed',
  'in-progress': 'status-in-progress',
  'no-issues':   'status-no-issues',
  issues:        'status-issues',
  unknown:       'status-unknown',
}

// Left-border indicator on card
const STATUS_BORDER: Record<CourseStatus, string> = {
  completed:     'status-border-completed',
  'in-progress': 'status-border-in-progress',
  'no-issues':   'status-border-no-issues',
  issues:        'status-border-issues',
  unknown:       'status-border-unknown',
}

interface Props {
  code: string
  status: CourseStatus
  issueReasons: string[]
  course: Course | undefined
  onRemove: () => void
}

interface InfoRowProps { label: string; children: React.ReactNode }
function InfoRow({ label, children }: InfoRowProps) {
  return (
    <div className="flex gap-2 text-[11px] leading-snug">
      <span className="shrink-0 w-20 text-gray-400 font-medium">{label}</span>
      <span className="text-gray-200 min-w-0">{children}</span>
    </div>
  )
}

export default function CourseCard({ code, status, issueReasons, course, onRemove }: Props) {
  const [showTip, setShowTip] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Decide whether to flip the tooltip above or below based on card position
  const [flipUp, setFlipUp]     = useState(true)
  const [flipLeft, setFlipLeft] = useState(false)

  // Hide tooltip whenever any drag begins
  useEffect(() => {
    const hide = () => setShowTip(false)
    document.addEventListener('dragstart', hide)
    return () => document.removeEventListener('dragstart', hide)
  }, [])

  function onMouseEnter() {
    if (document.querySelector('[data-dragging]')) return
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setFlipUp(rect.top > 260)
      setFlipLeft(rect.right > window.innerWidth - 300)
    }
    setShowTip(true)
  }

  return (
    <div
      ref={cardRef}
      className={`relative group flex flex-col rounded-md overflow-visible border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing select-none ${STATUS_BORDER[status]}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => setShowTip(false)}
    >
      <div className="px-2.5 py-2 flex items-start justify-between gap-1 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <p className="text-[13px] font-semibold text-gray-800 leading-tight truncate">{code}</p>
            {issueReasons.length > 0 && (
              <span className="shrink-0 text-[10px] text-red-500 font-bold leading-none" title="Issues found">⚠</span>
            )}
          </div>
          {course && (
            <p className="text-[11px] text-gray-500 leading-tight truncate mt-0.5">{course.title}</p>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          title="Remove"
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 text-xs leading-none mt-0.5 cursor-pointer"
        >
          ×
        </button>
      </div>

      {/* Rich tooltip */}
      {showTip && (
        <div
          className={`absolute ${flipUp ? 'bottom-full mb-2' : 'top-full mt-2'} ${flipLeft ? 'right-0' : 'left-0'} z-[200] w-72 bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden pointer-events-none`}
          style={{ minWidth: '17rem' }}
        >
          {/* Header */}
          <div className={`px-4 py-3 ${STATUS_CLASS[status]}`}>
            <p className="font-bold text-sm leading-tight">{code}</p>
            {course && <p className="text-white/80 text-xs mt-0.5 leading-snug">{course.title}</p>}
          </div>

          <div className="px-4 py-3 space-y-2">
            {/* Meta */}
            {course && (
              <InfoRow label="Credits">
                {course.credits} credit{course.credits !== 1 ? 's' : ''}
                {course.distribution ? ` · ${course.distribution}` : ''}
                {course.hours ? ` · ${course.hours}` : ''}
              </InfoRow>
            )}
            {course?.delivery && (
              <InfoRow label="Delivery">{course.delivery}</InfoRow>
            )}

            {/* Issues */}
            {issueReasons.length > 0 && (
              <div className="border-t border-white/10 pt-2 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Issues Found</p>
                {issueReasons.map((r, i) => (
                  <div key={i} className="flex gap-1.5 text-[11px] text-red-300">
                    <span className="shrink-0 mt-px">⚠</span>
                    <span className="leading-snug">{r}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Prerequisites */}
            {course ? (
              <div className="border-t border-white/10 pt-2">
                <InfoRow label="Prerequisites">
                  {formatPrereq(course.prerequisites) === 'None' ? (
                    <span className="text-gray-500">None</span>
                  ) : (
                    formatPrereq(course.prerequisites)
                  )}
                </InfoRow>
              </div>
            ) : null}

            {/* Exclusions */}
            {course?.exclusions?.length ? (
              <InfoRow label="Exclusions">{course.exclusions.join(', ')}</InfoRow>
            ) : null}

            {/* Recommended prep */}
            {course?.recommended_preparation?.length ? (
              <InfoRow label="Rec. Prep">{course.recommended_preparation.join(', ')}</InfoRow>
            ) : null}

            {/* Note */}
            {course?.note ? (
              <div className="border-t border-white/10 pt-2">
                <p className="text-[10px] text-gray-400 leading-snug">{course.note}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
