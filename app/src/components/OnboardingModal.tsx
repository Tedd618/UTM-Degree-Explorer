import React, { useState } from 'react'

const STEPS = [
  {
    emoji: '📸',
    title: 'Import your transcript',
    desc: 'Screenshot your ACORN transcript. The app reads every course and semester automatically.',
    detail: 'Sidebar → Import',
  },
  {
    emoji: '🎯',
    title: 'Drag to add from degree plan',
    desc: 'Open your degree requirements on the right. Drag any missing course chip straight into a semester.',
    detail: 'Right panel → drag course chips',
  },
  {
    emoji: '📡',
    title: 'Prereq Radar catches issues',
    desc: 'Unmet prerequisites appear in the Prereq Radar on the far right. Fix them by dragging suggested courses in.',
    detail: 'Far-right panel',
  },
  {
    emoji: '✓',
    title: 'Override red courses',
    desc: 'Hover any red course to mark it as "no issue" — useful for SG / H1 courses or special circumstances.',
    detail: 'Hover card → ✓ or SG button',
  },
]

interface Props {
  onDone: () => void
}

export default function OnboardingModal({ onDone }: Props) {
  const [step, setStep] = useState<number | null>(null) // null = overview

  function finish() {
    localStorage.setItem('utm_onboarded', '1')
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-utm-navy/80 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-7 pb-4 text-center">
          <div className="w-10 h-10 rounded-xl bg-utm-blue flex items-center justify-center text-xs font-bold text-white mx-auto mb-3">
            UTM
          </div>
          <h1 className="text-lg font-semibold text-utm-navy leading-tight">Welcome to Degree Explorer</h1>
          <p className="text-xs text-gray-400 mt-1">Here's everything you need to know — in 30 seconds.</p>
        </div>

        {/* Feature cards */}
        <div className="px-6 pb-2 grid grid-cols-2 gap-3">
          {STEPS.map((s, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-100 bg-gray-50 p-4 flex flex-col gap-2 hover:border-utm-blue/30 hover:bg-utm-light/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5">{s.emoji}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-utm-navy leading-tight">{s.title}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-snug">{s.desc}</p>
                </div>
              </div>
              <span className="self-start text-[10px] font-medium text-gray-400 bg-white border border-gray-200 rounded-md px-2 py-0.5 leading-tight">
                {s.detail}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-5 flex items-center justify-between border-t border-gray-100 mt-2">
          <p className="text-[11px] text-gray-300">You can always re-read this from the Help menu.</p>
          <button
            onClick={finish}
            className="px-6 py-2 bg-utm-navy text-white text-sm font-medium rounded-xl hover:bg-utm-blue transition-colors"
          >
            Let's go →
          </button>
        </div>

      </div>
    </div>
  )
}
