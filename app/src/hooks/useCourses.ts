import { useState, useEffect } from 'react'
import type { Course } from '../types'

interface CoursesState {
  courses: Course[]
  courseMap: Map<string, Course>
  loading: boolean
  error: string | null
}

let cache: CoursesState | null = null

export function useCourses(): CoursesState {
  const [state, setState] = useState<CoursesState>(
    cache ?? { courses: [], courseMap: new Map(), loading: true, error: null },
  )

  useEffect(() => {
    if (cache) {
      setState(cache)
      return
    }
    fetch('/data/courses.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Course[]>
      })
      .then(data => {
        const courseMap = new Map<string, Course>(data.map(c => [c.code, c]))
        cache = { courses: data, courseMap, loading: false, error: null }
        setState(cache)
      })
      .catch(err => {
        const next = { courses: [], courseMap: new Map(), loading: false, error: String(err) }
        setState(next)
      })
  }, [])

  return state
}
