export type Season = 'Fall' | 'Winter' | 'Summer'

export interface Course {
  code: string
  title: string
  description: string
  credits: number
  prerequisites: string[]
  exclusions: string[]
  recommended_preparation: string[]
  distribution: string
  hours: string
  delivery: string
  note: string
  has_experiential: boolean
  has_international: boolean
}

export interface Semester {
  id: string
  year: number
  season: Season
  courses: string[]   // ordered list of course codes
}

export interface Plan {
  id: string
  name: string
  semesters: Semester[]
}

export type CourseStatus =
  | 'completed'
  | 'in-progress'
  | 'no-issues'
  | 'issues'
  | 'unknown'
