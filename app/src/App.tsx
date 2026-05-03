import React, { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './utils/supabase'
import { usePlanStore } from './store/planStore'
import { useCourses } from './hooks/useCourses'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import PlannerGrid from './components/PlannerGrid'
import PrereqRadarPanel from './components/PrereqRadarPanel'
import AuthScreen from './components/AuthScreen'
import FeedbackWidget from './components/FeedbackWidget'
import OnboardingModal from './components/OnboardingModal'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('utm_onboarded'))

  const activePlan = usePlanStore(s => s.activePlan())
  const activePlanId = usePlanStore(s => s.activePlanId)
  const { courseMap, loading, error } = useCourses()

  useEffect(() => {
    let mounted = true

    const fetchData = async (userId: string) => {
      const { data, error } = await supabase.from('plans').select('*').eq('user_id', userId)
      
      if (data && data.length > 0 && mounted) {
        const plans = data.map((row: any) => ({
          id: row.id,
          name: row.name,
          semesters: row.semesters,
          programs: row.programs || [],
          startYear: row.start_year ?? undefined,
        }))
        const ignored: Record<string, string[]> = {}
        for (const row of data) {
          ignored[row.id] = row.ignored_prereqs || []
        }
        usePlanStore.getState().setStoreData(plans, ignored)
      }
      if (mounted) setIsInitializing(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      setSession(session)
      if (session) {
        fetchData(session.user.id)
      } else {
        setIsInitializing(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      setSession(session)
      // Only re-fetch on actual sign-in; token refreshes should not reset plan state
      if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
        fetchData(session.user.id)
      }
      if (event === 'SIGNED_OUT') {
        usePlanStore.getState().setStoreData([], {})
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-utm-blue border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session && showAuth) {
    return <AuthScreen onCancel={() => setShowAuth(false)} />
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <Header
        session={session}
        onSignInClick={() => setShowAuth(true)}
        onLogOutClick={() => supabase.auth.signOut()}
        onHelpClick={() => setShowOnboarding(true)}
      />

      <div className="flex flex-1 min-h-0">
        <Sidebar />

        <main className="flex-1 flex min-w-0 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-gray-400">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-utm-blue border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Loading course catalogue…</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center flex-1 text-red-400">
              <div className="text-center max-w-sm">
                <p className="text-2xl mb-2">⚠</p>
                <p className="text-sm font-medium">Failed to load course data</p>
                <p className="text-xs mt-1 text-gray-400">{error}</p>
              </div>
            </div>
          ) : activePlan ? (
            <>
              <div className="flex-1 flex flex-col min-w-0 min-h-0">
                <PlannerGrid plan={activePlan} courseMap={courseMap} />
              </div>
              <PrereqRadarPanel planId={activePlanId} courseMap={courseMap} />
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-400">
              <p className="text-sm">No plan selected.</p>
            </div>
          )}
        </main>
      </div>
      <FeedbackWidget session={session} />
      {showOnboarding && <OnboardingModal onDone={() => setShowOnboarding(false)} />}
    </div>
  )
}
