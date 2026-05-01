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
          <div className="w-9 h-9 rounded-full bg-utm-blue flex items-center justify-center text-[11px] font-bold tracking-tight">
            UTM
          </div>
          <div>
            <span className="font-semibold text-[15px] leading-none tracking-tight">Degree Explorer</span>
            <span className="ml-2 text-xs text-white/50 hidden sm:inline">University of Toronto Mississauga</span>
          </div>
        </div>
        <div>
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
        <div className="bg-amber-50 border-b border-amber-100 text-amber-700 text-xs px-4 py-2 flex justify-center items-center gap-2 shrink-0">
          <span className="text-amber-400">⚠</span>
          <span>You're exploring as a guest — sign in to save your plan.</span>
          <button onClick={onSignInClick} className="ml-2 text-xs font-semibold underline hover:text-amber-900">Sign in</button>
        </div>
      )}
    </>
  )
}
