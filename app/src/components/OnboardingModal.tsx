import React, { useState } from 'react'

const SLIDES = [
  {
    img: '/onboarding/step1.jpg',
    title: 'Import your transcript',
    desc: 'Drop a screenshot of your ACORN transcript — the app reads every course automatically.',
  },
  {
    img: '/onboarding/step2.jpg',
    title: 'Add courses from your degree plan',
    desc: 'Search your degree program and drag any missing course chip straight into a semester.',
  },
  {
    img: '/onboarding/step3.jpg',
    title: 'Prereq Radar catches issues',
    desc: 'Unmet prerequisites appear on the right. Drag the suggested course into any semester to fix it.',
  },
  {
    img: '/onboarding/step4.jpg',
    title: 'Override issues on any course',
    desc: 'Hover a course to mark it "no issue" (✓) or flag it as an SG cross-listed course.',
  },
]

interface Props {
  onDone: () => void
}

export default function OnboardingModal({ onDone }: Props) {
  const [slide, setSlide] = useState(0)
  const isLast = slide === SLIDES.length - 1

  function finish() {
    localStorage.setItem('utm_onboarded', '1')
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-utm-navy/80 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] flex flex-col overflow-hidden">

        {/* Slide image */}
        <div className="relative bg-gray-50 border-b border-gray-100 overflow-hidden" style={{ height: 260 }}>
          <img
            key={slide}
            src={SLIDES[slide].img}
            alt={SLIDES[slide].title}
            className="w-full h-full object-cover object-top"
          />
          {/* subtle vignette at bottom */}
          <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-white/60 to-transparent pointer-events-none" />
        </div>

        {/* Text */}
        <div className="px-8 pt-5 pb-2 text-center">
          <h2 className="text-base font-semibold text-utm-navy leading-tight">{SLIDES[slide].title}</h2>
          <p className="text-xs text-gray-400 mt-1.5 leading-snug">{SLIDES[slide].desc}</p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between">

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={`rounded-full transition-all ${
                  i === slide
                    ? 'w-4 h-2 bg-utm-navy'
                    : 'w-2 h-2 bg-gray-200 hover:bg-gray-300'
                }`}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div className="flex items-center gap-2">
            {slide > 0 && (
              <button
                onClick={() => setSlide(s => s - 1)}
                className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Back
              </button>
            )}
            {isLast ? (
              <button
                onClick={finish}
                className="px-6 py-2 bg-utm-navy text-white text-sm font-medium rounded-xl hover:bg-utm-blue transition-colors"
              >
                Let's go →
              </button>
            ) : (
              <button
                onClick={() => setSlide(s => s + 1)}
                className="px-6 py-2 bg-utm-navy text-white text-sm font-medium rounded-xl hover:bg-utm-blue transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
