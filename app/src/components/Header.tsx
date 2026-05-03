import React from 'react'

interface Props {
  session: any
  onSignInClick: () => void
  onLogOutClick: () => void
}

export default function Header({ session, onSignInClick, onLogOutClick }: Props) {
  return (
    <>
      <header className="flex items-center justify-between h-14 px-6 bg-utm-navy text-white shrink-0 shadow-md z-10 w-full relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-utm-blue flex items-center justify-center text-xs font-bold tracking-tight">
            UTM
          </div>
          <div>
            <span className="font-semibold text-base leading-none tracking-tight">Degree Explorer</span>
            <span className="ml-2 text-xs text-white/50 hidden sm:inline">University of Toronto Mississauga</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {session ? (
            <button onClick={onLogOutClick} className="text-sm font-medium text-white/80 hover:text-white transition-colors">
              Log out
            </button>
          ) : (
            <button onClick={onSignInClick} className="text-sm font-medium bg-utm-blue px-4 py-1.5 rounded-full hover:bg-utm-blue/80 shadow-sm transition-colors">
              Sign In
            </button>
          )}
        </div>
      </header>
      {!session && (
        <div className="bg-amber-100/90 border-b border-amber-200 text-amber-800 text-[11px] px-4 py-1.5 font-semibold flex justify-center items-center shrink-0 tracking-wide uppercase">
          Warning: You are building a plan as a guest. Your changes will not be saved!
        </div>
      )}
    </>
  )
}
