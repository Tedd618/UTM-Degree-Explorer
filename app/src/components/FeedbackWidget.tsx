import React, { useState, useRef, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../utils/supabase'

interface Props {
  session: Session | null
}

type Status = 'idle' | 'sending' | 'sent' | 'error'

export default function FeedbackWidget({ session }: Props) {
  const [open, setOpen]       = useState(false)
  const [message, setMessage] = useState('')
  const userEmail = session?.user?.email ?? ''
  const [email, setEmail]     = useState(userEmail.endsWith('@utm.com') ? '' : userEmail)
  const [status, setStatus]   = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Keep email in sync if user signs in after widget mounts
  useEffect(() => {
    const e = session?.user?.email ?? ''
    setEmail(e.endsWith('@utm.com') ? '' : e)
  }, [session?.user?.email])

  function handleOpen() {
    setOpen(o => !o)
    setStatus('idle')
    setErrorMsg('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) return

    setStatus('sending')
    const { error } = await supabase.from('feedback').insert({
      message: trimmed,
      email: email.trim() || null,
      user_id: session?.user?.id ?? null,
    })

    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
    } else {
      setStatus('sent')
      setMessage('')
      setTimeout(() => setOpen(false), 1800)
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col items-end gap-2">
      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-utm-navy">Send feedback</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Bug, suggestion, or anything on your mind.</p>
          </div>

          {status === 'sent' ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center px-4">
              <span className="text-2xl">🎉</span>
              <p className="text-sm font-medium text-gray-700">Thanks for the feedback!</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <textarea
                autoFocus
                placeholder="What's on your mind?"
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-utm-blue resize-none placeholder:text-gray-300"
              />

              <input
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-utm-blue placeholder:text-gray-300"
              />

              {status === 'error' && (
                <p className="text-xs text-red-500">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={!message.trim() || status === 'sending'}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  message.trim() && status !== 'sending'
                    ? 'bg-utm-blue text-white hover:bg-utm-navy'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {status === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={handleOpen}
        title="Send feedback"
        className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-sm font-medium transition-all select-none cursor-pointer
          ${open
            ? 'bg-utm-navy text-white'
            : 'bg-white text-gray-600 border border-gray-200 hover:border-utm-blue hover:text-utm-blue hover:shadow-xl'
          }`}
      >
        <span className="text-base leading-none">💬</span>
        Feedback
      </button>
    </div>
  )
}
