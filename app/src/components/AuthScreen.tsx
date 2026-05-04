import React, { useState } from 'react'
import { supabase } from '../utils/supabase'

type Mode = 'login' | 'signup' | 'forgot'

export default function AuthScreen({ onCancel }: { onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [errorMsg, setErrorMsg]       = useState('')
  const [resetSent, setResetSent]     = useState(false)

  function switchMode(m: Mode) {
    setMode(m)
    setErrorMsg('')
    setResetSent(false)
  }

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    try {
      if (mode === 'forgot') {
        const raw = email.trim()
        const normalized = raw.includes('@') ? raw : `${raw}@utm.com`
        const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setResetSent(true)

      } else if (mode === 'login') {
        const raw = email.trim()
        const normalized = raw.includes('@') ? raw : `${raw}@utm.com`
        const { error } = await supabase.auth.signInWithPassword({
          email: normalized,
          password,
        })
        if (error) throw error

      } else {
        // signup — normalize to valid email format for Supabase
        const raw = email.trim()
        const normalized = raw.includes('@') ? raw : `${raw}@utm.com`
        const { error } = await supabase.auth.signUp({
          email: normalized,
          password,
        })
        if (error) throw error
      }
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setErrorMsg('Incorrect email or password.')
      } else if (err.message?.includes('User already registered')) {
        setErrorMsg('An account with that email already exists.')
      } else {
        setErrorMsg(err.message || 'An error occurred.')
      }
    } finally {
      setLoading(false)
    }
  }

  const eyeShow = (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
    </svg>
  )
  const eyeHide = (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/>
      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>
    </svg>
  )

  const inputClass = "block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-utm-blue focus:outline-none focus:ring-2 focus:ring-utm-blue/20 transition-all bg-gray-50/50 focus:bg-white"
  const labelClass = "block text-xs font-semibold text-gray-600 uppercase tracking-wider"

  return (
    <div className="flex flex-col h-screen bg-[#F9FAFB] items-center justify-center p-4 font-sans relative">
      <button
        onClick={onCancel}
        className="absolute top-6 left-6 text-sm text-gray-500 hover:text-utm-navy transition-colors font-medium flex items-center gap-1.5"
      >
        <span className="text-lg leading-none mb-0.5">←</span> Back to Planner
      </button>

      <div className="w-full max-w-sm mb-8 text-center text-utm-navy">
        <h1 className="text-2xl font-bold tracking-tight mb-2">UTM Degree Explorer</h1>
        <p className="text-sm text-gray-500 font-medium">
          {mode === 'login'  && 'Sign in to access your plans'}
          {mode === 'signup' && 'Create an account to save your plans'}
          {mode === 'forgot' && 'Reset your password'}
        </p>
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-100 p-8 pt-6">

        {/* Forgot password — success state */}
        {mode === 'forgot' && resetSent ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-gray-600">
              A password reset link has been sent to <span className="font-semibold text-utm-navy">{email}</span>.
              Check your inbox.
            </p>
            <button
              onClick={() => switchMode('login')}
              className="text-xs text-utm-blue hover:text-utm-navy underline decoration-utm-blue/30 underline-offset-2 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleAuth}>
            {errorMsg && (
              <div className="bg-red-50 text-red-600 text-xs px-3 py-2.5 rounded-lg border border-red-100">
                {errorMsg}
              </div>
            )}

            {/* Google sign-in — login and signup only */}
            {mode !== 'forgot' && (
              <>
                <button
                  type="button"
                  onClick={handleGoogle}
                  className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-all active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[11px] text-gray-400">or</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              </>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label className={labelClass}>Email</label>
              <input
                type="text"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@mail.utoronto.ca"
                className={inputClass}
              />
              {mode === 'signup' && (
                <p className="text-[11px] text-gray-400 leading-snug">
                  Use any identifier you like — a real email, a username, anything. If you use a real email, we can send you a password reset link if you ever forget it.
                </p>
              )}
            </div>

            {/* Password — not shown on forgot */}
            {mode !== 'forgot' && (
              <div className="space-y-1.5">
                <label className={labelClass}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`${inputClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? eyeShow : eyeHide}
                  </button>
                </div>
                {/* Forgot password link — login only */}
                {mode === 'login' && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs text-gray-400 hover:text-utm-blue transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-amber-600 leading-snug">
                  Do not use your school or university password.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 rounded-xl bg-utm-navy py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#001D40] focus:outline-none focus:ring-2 focus:ring-utm-navy focus:ring-offset-2 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'  ? 'Sign in'
                : mode === 'signup' ? 'Create account'
                : 'Send reset link'}
            </button>
          </form>
        )}

        {/* Footer links */}
        {!resetSent && (
          <div className="mt-7 text-center">
            <p className="text-xs text-gray-400">
              {mode === 'login' && (
                <>Don't have an account?{' '}
                  <button type="button" onClick={() => switchMode('signup')} className="font-medium text-utm-blue hover:text-utm-navy transition-colors underline decoration-utm-blue/30 underline-offset-2">
                    Sign up
                  </button>
                </>
              )}
              {mode === 'signup' && (
                <>Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="font-medium text-utm-blue hover:text-utm-navy transition-colors underline decoration-utm-blue/30 underline-offset-2">
                    Log in
                  </button>
                </>
              )}
              {mode === 'forgot' && (
                <>Remember your password?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="font-medium text-utm-blue hover:text-utm-navy transition-colors underline decoration-utm-blue/30 underline-offset-2">
                    Back to sign in
                  </button>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
