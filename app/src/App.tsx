import React from 'react'
import { usePlanStore } from './store/planStore'
import { useCourses } from './hooks/useCourses'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import PlannerGrid from './components/PlannerGrid'

export default function App() {
  const activePlan = usePlanStore(s => s.activePlan())
  const { courseMap, loading, error } = useCourses()

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <Header />

      <div className="flex flex-1 min-h-0">
        <Sidebar />

        <main className="flex-1 flex flex-col min-w-0">
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
            <PlannerGrid plan={activePlan} courseMap={courseMap} />
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-400">
              <p className="text-sm">No plan selected.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
