import { useState, useEffect } from 'react'
import type { ProgramStructure } from '../types'

export function usePrograms() {
  const [programsMap, setProgramsMap] = useState<Map<string, ProgramStructure>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
        
        setProgramsMap(map)
        setError(null)
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to fetch programs_structured.json')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchPrograms()

    return () => {
      mounted = false
    }
  }, [])

  return { programsMap, loading, error }
}
