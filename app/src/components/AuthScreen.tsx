import React, { useState } from 'react'
import { supabase } from '../utils/supabase'

export default function AuthScreen({ onCancel }: { onCancel: () => void }) {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    
    // Format username cleanly into a pseudo-email per Supabase requirement
    const email = username.includes('@') ? username : `${username}@utm.com`

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
      }
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setErrorMsg('Incorrect username or password.')
      } else if (err.message.includes('User already registered')) {
        setErrorMsg('That username is already taken.')
      } else {
        setErrorMsg(err.message || 'An error occurred during authentication.')
      }
    } finally {
      setLoading(false)
    }
  }

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
          {isLogin ? 'Sign in to access your plans' : 'Create a structured plan'}
        </p>
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-100 p-8 pt-6">
        <form className="space-y-5" onSubmit={handleAuth}>
          {errorMsg && (
            <div className="bg-red-50 text-red-600 text-xs px-3 py-2.5 rounded-lg border border-red-100">
              {errorMsg}
            </div>
          )}
          
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Tyler"
              className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-utm-blue focus:outline-none focus:ring-2 focus:ring-utm-blue/20 transition-all bg-gray-50/50 focus:bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 pr-10 text-sm placeholder-gray-400 focus:border-utm-blue focus:outline-none focus:ring-2 focus:ring-utm-blue/20 transition-all bg-gray-50/50 focus:bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword
                  ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>
                }
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 rounded-xl bg-utm-navy py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#001D40] focus:outline-none focus:ring-2 focus:ring-utm-navy focus:ring-offset-2 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {loading ? 'Authenticating...' : (isLogin ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <div className="mt-7 text-center">
          <p className="text-xs text-gray-400">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin)
                setErrorMsg('')
              }}
              className="font-medium text-utm-blue hover:text-utm-navy transition-colors underline decoration-utm-blue/30 underline-offset-2"
            >
              {isLogin ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
