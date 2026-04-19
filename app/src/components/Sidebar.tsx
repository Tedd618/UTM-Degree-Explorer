import React, { useState } from 'react'
import { usePlanStore } from '../store/planStore'
import ImportModal from './ImportModal'

export default function Sidebar() {
  const plans        = usePlanStore(s => s.plans)
  const activePlanId = usePlanStore(s => s.activePlanId)
  const hideSummers  = usePlanStore(s => s.hideSummers)
  const addPlan           = usePlanStore(s => s.addPlan)
  const removePlan        = usePlanStore(s => s.removePlan)
  const renamePlan        = usePlanStore(s => s.renamePlan)
  const setActivePlan     = usePlanStore(s => s.setActivePlan)
  const toggleHideSummers = usePlanStore(s => s.toggleHideSummers)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue]  = useState('')
  const [showImport, setShowImport] = useState(false)

  function startRename(id: string, current: string) {
    setEditingId(id)
    setEditValue(current)
  }

  function commitRename(id: string) {
    const trimmed = editValue.trim()
    if (trimmed) renamePlan(id, trimmed)
    setEditingId(null)
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-gray-200 overflow-y-auto">
      {/* My Plans */}
        <section className="p-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">My Plans</span>
          <button
            onClick={addPlan}
            title="New plan"
            className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors text-lg leading-none"
          >
            +
          </button>
        </div>
        <ul className="space-y-0.5">
          {plans.map(plan => (
            <li
              key={plan.id}
              className={`sidebar-plan-item group ${plan.id === activePlanId ? 'active' : ''}`}
              onClick={() => setActivePlan(plan.id)}
            >
              {editingId === plan.id ? (
                <input
                  autoFocus
                  className="flex-1 text-sm bg-white border border-utm-blue rounded px-1 py-0.5 outline-none"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => commitRename(plan.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(plan.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="flex-1 truncate">{plan.name}</span>
                  <span className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title="Rename"
                      className="text-gray-400 hover:text-gray-700 text-xs px-1"
                      onClick={e => { e.stopPropagation(); startRename(plan.id, plan.name) }}
                    >
                      ✎
                    </button>
                    {plans.length > 1 && (
                      <button
                        title="Delete"
                        className="text-gray-400 hover:text-red-500 text-xs px-1"
                        onClick={e => { e.stopPropagation(); removePlan(plan.id) }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Planning Periods */}
      <section className="p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-2">Display</span>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideSummers}
            onChange={toggleHideSummers}
            className="rounded border-gray-300 text-utm-blue focus:ring-utm-blue"
          />
          Hide summer semesters
        </label>
      </section>

      <div className="mt-auto border-t border-gray-100">
        <div className="p-3">
          <button
            onClick={() => setShowImport(true)}
            className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-utm-blue text-white hover:bg-utm-navy transition-colors"
          >
            Import
          </button>
        </div>
        <div className="px-3 pb-3">
          <p className="text-[10px] text-gray-300 leading-relaxed">
            UTM Degree Explorer · data from{' '}
            <a
              href="https://utm.calendar.utoronto.ca"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-gray-400"
            >
              utm.calendar.utoronto.ca
            </a>
          </p>
        </div>
      </div>

      {showImport && (
        <ImportModal planId={activePlanId} onClose={() => setShowImport(false)} />
      )}
    </aside>
  )
}
