import { useState, useEffect } from 'react'
import type { ProgramStructure } from '../types'

interface ProgramsState {
  programsMap: Map<string, ProgramStructure>
  loading: boolean
  error: string | null
}

let cache: ProgramsState | null = null

export function usePrograms(): ProgramsState {
  const [state, setState] = useState<ProgramsState>(
    cache ?? { programsMap: new Map(), loading: true, error: null },
  )

  useEffect(() => {
    if (cache) {
      setState(cache)
      return
    }

    let mounted = true

    async function fetchPrograms() {
      try {
        const res = await fetch('/programs_structured.json')
        if (!res.ok) throw new Error('Network response was not ok')

        const data: ProgramStructure[] = await res.json()

        if (!mounted) return

        const map = new Map<string, ProgramStructure>()
        for (const prog of data) {
          map.set(prog.code, prog)
        }

        cache = { programsMap: map, loading: false, error: null }
        setState(cache)
      } catch (err: any) {
        if (mounted) {
          setState({ programsMap: new Map(), loading: false, error: err.message || 'Failed to fetch programs_structured.json' })
        }
      }
    }

    fetchPrograms()

    return () => {
      mounted = false
    }
  }, [])

  return state
}
