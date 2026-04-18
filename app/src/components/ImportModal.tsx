import React, { useState, useRef, useCallback } from 'react'
import type { Season } from '../types'
import { usePlanStore } from '../store/planStore'

interface Props {
  planId: string
  onClose: () => void
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const SEASON_ALIASES: Record<string, Season> = {
  fall: 'Fall', autumn: 'Fall',
  winter: 'Winter',
  summer: 'Summer', spring: 'Summer',
}

const COURSE_RE = /\b([A-Z]{2,4}\d{3}[HY]\d)\b/g
const SEM_RE    = /\b(fall|winter|summer|autumn|spring)\s+(\d{4})\b/i

interface ParsedEntry { year: number; season: Season; courses: string[] }

/** Parse clean "Season Year: CODE, …" text (text tab) */
function parsePlanText(text: string): { entries: ParsedEntry[]; errors: string[] } {
  const entries: ParsedEntry[] = []
  const errors: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const m = line.match(/^(fall|winter|summer|autumn|spring)\s+(\d{4})\s*[:\-]?\s*(.*)$/i)
    if (!m) { errors.push(`Skipped: "${line}"`); continue }
    const season = SEASON_ALIASES[m[1].toLowerCase()]
    const year   = parseInt(m[2], 10)
    const codes  = [...m[3].matchAll(COURSE_RE)].map(x => x[1])
    if (codes.length) entries.push({ season, year, courses: codes })
  }
  return { entries, errors }
}

/** Parse raw OCR output — semester labels + course codes may be on separate lines */
function parseOcrText(raw: string): ParsedEntry[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const entries: ParsedEntry[] = []
  let current: ParsedEntry | null = null

  for (const line of lines) {
    const semMatch = SEM_RE.exec(line)
    if (semMatch) {
      if (current) entries.push(current)
      current = {
        season: SEASON_ALIASES[semMatch[1].toLowerCase()],
        year: parseInt(semMatch[2], 10),
        courses: [],
      }
    }
    // always scan every line for course codes
    const codes = [...line.matchAll(COURSE_RE)].map(x => x[1])
    if (codes.length && current) {
      for (const c of codes) {
        if (!current.courses.includes(c)) current.courses.push(c)
      }
    }
  }
  if (current) entries.push(current)
  return entries.filter(e => e.courses.length > 0)
}

/** Serialise entries back to the text-tab format */
function entriesToText(entries: ParsedEntry[]): string {
  return entries.map(e => `${e.season} ${e.year}: ${e.courses.join(', ')}`).join('\n')
}

// ── Text tab ─────────────────────────────────────────────────────────────────

const PLACEHOLDER = `Fall 2024: CSC108H5, MAT102H5
Winter 2025: CSC148H5, MAT136H5
Fall 2025: CSC207H5, CSC236H5`

function TextTab({
  text, setText, entries, errors,
}: {
  text: string; setText: (v: string) => void
  entries: ParsedEntry[]; errors: string[]
}) {
  return (
    <>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        className="w-full h-48 text-xs font-mono border border-gray-200 rounded-lg p-3 outline-none focus:border-utm-blue resize-none"
        spellCheck={false}
      />
      {entries.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Preview — {entries.reduce((n, e) => n + e.courses.length, 0)} courses across {entries.length} semesters
          </p>
          {entries.map(e => (
            <div key={`${e.season}-${e.year}`} className="flex gap-2 text-xs">
              <span className="shrink-0 w-24 text-gray-400">{e.season} {e.year}</span>
              <span className="text-gray-700 font-mono">{e.courses.join(', ')}</span>
            </div>
          ))}
        </div>
      )}
      {errors.map((err, i) => (
        <p key={i} className="text-[11px] text-amber-500 mt-1">{err}</p>
      ))}
    </>
  )
}

// ── Image tab ─────────────────────────────────────────────────────────────────

type OcrStatus = 'idle' | 'loading' | 'done' | 'error'

function ImageTab({ onExtracted }: { onExtracted: (text: string) => void }) {
  const [image, setImage]       = useState<string | null>(null) // object URL
  const [status, setStatus]     = useState<OcrStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function loadFile(file: File) {
    if (!file.type.startsWith('image/')) return
    setImage(URL.createObjectURL(file))
    setStatus('idle')
    setProgress(0)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }, [])

  async function runOcr() {
    if (!image) return
    setStatus('loading'); setProgress(0); setErrorMsg('')
    try {
      // Dynamic import so Tesseract's large worker doesn't bloat the initial bundle
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100))
        },
      })
      const { data: { text } } = await worker.recognize(image)
      await worker.terminate()

      const entries = parseOcrText(text)
      if (entries.length === 0) {
        setErrorMsg('No courses or semester labels found. Try a clearer screenshot.')
        setStatus('error')
        return
      }
      onExtracted(entriesToText(entries))
      setStatus('done')
    } catch (err) {
      setErrorMsg(String(err))
      setStatus('error')
    }
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl transition-colors flex flex-col items-center justify-center cursor-pointer
          ${dragging ? 'border-utm-blue bg-utm-light' : 'border-gray-200 hover:border-gray-300'}`}
        style={{ minHeight: '10rem' }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f) }}
        />
        {image ? (
          <img src={image} alt="Plan screenshot" className="max-h-48 max-w-full rounded-lg object-contain p-2" />
        ) : (
          <div className="text-center p-6 select-none">
            <p className="text-3xl mb-2">🖼</p>
            <p className="text-sm text-gray-500">Drop a screenshot here</p>
            <p className="text-xs text-gray-300 mt-1">or click to browse</p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {status === 'loading' && (
        <div className="space-y-1">
          <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-utm-blue rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400">Reading text… {progress}%</p>
        </div>
      )}

      {/* Run button */}
      {image && status !== 'loading' && (
        <button
          onClick={runOcr}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
            status === 'done'
              ? 'bg-emerald-500 text-white'
              : 'bg-utm-blue text-white hover:bg-utm-navy'
          }`}
        >
          {status === 'done' ? '✓ Done — switch to Text tab to review' : 'Extract courses from image'}
        </button>
      )}

      {status === 'error' && (
        <p className="text-xs text-red-500">{errorMsg}</p>
      )}

      <p className="text-[10px] text-gray-400">
        Uses Tesseract OCR — runs entirely in your browser, nothing is uploaded.
      </p>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function ImportModal({ planId, onClose }: Props) {
  const importCourses = usePlanStore(s => s.importCourses)
  const [tab, setTab]   = useState<'text' | 'image'>('text')
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)

  const { entries, errors } = parsePlanText(text)

  function handleExtracted(extracted: string) {
    setText(extracted)
    setTab('text')
  }

  function handleImport() {
    if (entries.length === 0) return
    importCourses(planId, entries)
    setDone(true)
    setTimeout(onClose, 700)
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-utm-navy">Import Plan</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {(['text', 'image'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2.5 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-utm-blue text-utm-blue'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t === 'text' ? 'Paste text' : 'From image'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {tab === 'text'
            ? <TextTab text={text} setText={t => { setText(t); setDone(false) }} entries={entries} errors={errors} />
            : <ImageTab onExtracted={handleExtracted} />
          }
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] text-gray-400">Matched semesters will have their courses replaced.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            <button
              onClick={handleImport}
              disabled={entries.length === 0}
              className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                done
                  ? 'bg-emerald-500 text-white'
                  : entries.length > 0
                    ? 'bg-utm-blue text-white hover:bg-utm-navy'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {done ? 'Imported!' : entries.length > 0
                ? `Import ${entries.reduce((n, e) => n + e.courses.length, 0)} courses`
                : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
