export type Season = 'Fall' | 'Winter' | 'Summer'

export type PrereqNode =
  | { type: 'AND'; operands: PrereqNode[] }
  | { type: 'OR'; operands: PrereqNode[] }
  | { type: 'COURSE'; code: string }
  | { type: 'RAW'; codes: string[] }
  | { type: 'CREDITS'; minimum: number }
  | { type: 'LEVEL_POOL'; n: number; subjects: string[] | null; min_level: number | null; max_level: number | null; specific_courses: string[] }

export interface Course {
  code: string
  title: string
  description: string
  credits: number
  prerequisites: PrereqNode | never[]
  exclusions: string[]
  recommended_preparation: string[]
  distribution: string
  hours: string
  delivery: string
  note: string
  has_experiential: boolean
  has_international: boolean
  offerings?: Season[]
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
  programs: string[]
}

export type RequirementNode =
  | { type: 'course'; code: string }
  | { type: 'all_of'; items: RequirementNode[] }
  | { type: 'one_of'; items: RequirementNode[] }
  | { type: 'n_from'; n: number; items: RequirementNode[] }
  | { 
      type: 'open_pool'; 
      n: number; 
      constraint: string;
      subject: string | null;
      min_level: number | null;
      max_level: number | null;
      specific_courses: string[];
      excluding: string[];
      description?: string;
    }
  | { type: 'text'; text: string; description?: string }
  | { type: 'limit'; limit: number; items: RequirementNode[] }

export interface RequirementGroup {
  label: string
  condition: string | null
  items: RequirementNode[]
}

export interface ProgramStructure {
  code: string
  name: string
  type: string
  degree_type: string | null
  completion: {
    total_credits: { min: number; max: number | null }
    groups: RequirementGroup[]
  }
}

export type CourseStatus =
  | 'completed'
  | 'in-progress'
  | 'no-issues'
  | 'issues'
  | 'unknown'

/** A structured missing prerequisite group, used by the Prerequisite Radar panel. */
export type MissingGroup =
  | { kind: 'single'; code: string }
  | { kind: 'or'; options: MissingGroup[] }
  | { kind: 'and'; parts: MissingGroup[] }
  | { kind: 'credit'; minimum: number }
  | { kind: 'level_pool'; n: number; subjects: string[] | null; min_level: number | null; max_level: number | null; specific_courses: string[] }
