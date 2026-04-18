import React from 'react'

export default function Header() {
  return (
    <header className="flex items-center h-14 px-6 bg-utm-navy text-white shrink-0 shadow-md z-10">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-utm-blue flex items-center justify-center text-xs font-bold tracking-tight">
          UTM
        </div>
        <div>
          <span className="font-semibold text-base leading-none tracking-tight">Degree Explorer</span>
          <span className="ml-2 text-xs text-white/50 hidden sm:inline">University of Toronto Mississauga</span>
        </div>
      </div>
    </header>
  )
}
