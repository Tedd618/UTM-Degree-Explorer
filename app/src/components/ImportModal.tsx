import React, { useState, useRef, useCallback } from 'react'
import type { Season } from '../types'
import { usePlanStore } from '../store/planStore'

interface Props {
  planId: string
  onClose: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEASONS: Season[] = ['Fall', 'Winter', 'Summer']
const COURSE_CODE_RE = /^[A-Z]{2,4}\d{3}[HY]\d$/
const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 10 }, (_, i) => currentYear - 3 + i)

const API_KEY = import.meta.env.VITE_GOOGLE_VISION_API_KEY as string | undefined

interface ExtractedRow {
  id: number
  season: Season
  year: number
  courses: string[]
  autoDetected: boolean   // true when season+year came from the image
}

// ── Vision API types ──────────────────────────────────────────────────────────

interface VisionWord {
  text: string
  cx: number   // horizontal centre in image pixels
  cy: number   // vertical centre in image pixels
}

// ── Parse Cloud Vision DOCUMENT_TEXT_DETECTION response ───────────────────────

/**
 * Flatten the block→paragraph→word tree into (text, cx, cy) triples.
 * Each word's position is the centre of its bounding-box vertices.
 */
function extractVisionWords(response: any): VisionWord[] {
  const out: VisionWord[] = []
  for (const page of response.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const text = (word.symbols ?? [])
            .map((s: any) => s.text ?? '')
            .join('')
            .trim()
          if (!text) continue

          const verts: { x?: number; y?: number }[] =
            word.boundingBox?.vertices ?? []
          if (verts.length < 4) continue

          const xs = verts.map(v => v.x ?? 0)
          const ys = verts.map(v => v.y ?? 0)
          out.push({
            text,
            cx: (Math.min(...xs) + Math.max(...xs)) / 2,
            cy: (Math.min(...ys) + Math.max(...ys)) / 2,
          })
        }
      }
    }
  }
  return out
}

/**
 * Given a flat word list, detect semester labels and assign course codes to them.
 *
 * Semester labels: a Season word ("Fall"/"Winter"/"Summer") whose nearest
 * 4-digit-year word is within ~60 px vertically and ~350 px horizontally.
 *
 * Course codes are assigned to the semester whose label has the closest Y centre.
 * Bands are split at the midpoint between consecutive label Y positions.
 */
function buildRows(words: VisionWord[]): ExtractedRow[] {
  // ── 1. Detect semester labels ──────────────────────────────────────────────
  const semLabels: { season: Season; year: number; cy: number }[] = []

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const season = SEASONS.find(
      s => s.toLowerCase() === w.text.toLowerCase(),
    )
    if (!season) continue

    // Find nearest 4-digit year word
    let best: VisionWord | null = null
    let bestDist = Infinity
    for (const w2 of words) {
      if (w2 === w) continue
      if (!/^\d{4}$/.test(w2.text)) continue
      const year = parseInt(w2.text, 10)
      if (year < 2000 || year > 2050) continue
      const dy = Math.abs(w2.cy - w.cy)
      const dx = Math.abs(w2.cx - w.cx)
      if (dy > 60 || dx > 350) continue
      const dist = Math.hypot(dx, dy)
      if (dist < bestDist) { bestDist = dist; best = w2 }
    }

    if (!best) continue
    const year = parseInt(best.text, 10)
    const cy = (w.cy + best.cy) / 2

    // De-duplicate (keep first occurrence of each season+year pair)
    if (!semLabels.some(s => s.season === season && s.year === year)) {
      semLabels.push({ season, year, cy })
    }
  }

  // ── 2. Fall back: cluster by Y if no labels found ─────────────────────────
  const courseCodes = words.filter(w => COURSE_CODE_RE.test(w.text))
  if (courseCodes.length === 0) return []

  if (semLabels.length === 0) {
    // Plain Y-clustering — user must fill semester manually
    const sorted = [...courseCodes].sort((a, b) => a.cy - b.cy)
    const gaps = sorted.slice(1).map((w, i) => w.cy - sorted[i].cy)
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0
    const threshold = Math.max(median * 2, 30)

    const clusters: { codes: string[]; maxY: number }[] = []
    for (const item of sorted) {
      const last = clusters[clusters.length - 1]
      if (last && item.cy - last.maxY < threshold) {
        if (!last.codes.includes(item.text)) last.codes.push(item.text)
        last.maxY = item.cy
      } else {
        clusters.push({ codes: [item.text], maxY: item.cy })
      }
    }

    return clusters.map((c, i) => ({
      id: i,
      season: 'Fall',
      year: currentYear,
      courses: c.codes,
      autoDetected: false,
    }))
  }

  // ── 3. Sort labels top→bottom and compute band boundaries ─────────────────
  semLabels.sort((a, b) => a.cy - b.cy)

  const boundaries: number[] = [-Infinity]
  for (let i = 1; i < semLabels.length; i++) {
    boundaries.push((semLabels[i - 1].cy + semLabels[i].cy) / 2)
  }
  boundaries.push(Infinity)

  // ── 4. Assign course codes to the matching band ────────────────────────────
  const rows = new Map<string, ExtractedRow>(
    semLabels.map((s, i) => [
      `${s.season}-${s.year}`,
      { id: i, season: s.season, year: s.year, courses: [], autoDetected: true },
    ]),
  )

  for (const code of courseCodes) {
    let bandIdx = 0
    for (let i = 1; i < boundaries.length; i++) {
      if (code.cy >= boundaries[i - 1] && code.cy < boundaries[i]) {
        bandIdx = i - 1
        break
      }
    }
    const sem = semLabels[bandIdx]
    if (!sem) continue
    const row = rows.get(`${sem.season}-${sem.year}`)
    if (row && !row.courses.includes(code.text)) row.courses.push(code.text)
  }

  return [...rows.values()].filter(r => r.courses.length > 0)
}

// ── Call the Cloud Vision API ─────────────────────────────────────────────────

async function callVisionApi(imageBase64: string): Promise<any> {
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageBase64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        }],
      }),
    },
  )
  if (!res.ok) throw new Error(`Vision API error ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const resp = json.responses?.[0]
  if (resp?.error) throw new Error(resp.error.message ?? 'Vision API error')
  return resp
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip "data:image/...;base64," prefix
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Main modal ────────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'done' | 'error'

export default function ImportModal({ planId, onClose }: Props) {
  const importCourses = usePlanStore(s => s.importCourses)

  const [image, setImage]       = useState<string | null>(null)
  const [file, setFile]         = useState<File | null>(null)
  const [status, setStatus]     = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const [rows, setRows]         = useState<ExtractedRow[]>([])
  const [imported, setImported] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  function loadFile(f: File) {
    if (!f.type.startsWith('image/')) return
    if (image) URL.revokeObjectURL(image)
    setImage(URL.createObjectURL(f))
    setFile(f)
    setStatus('idle')
    setRows([])
    setErrorMsg('')
    setImported(false)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) loadFile(f)
  }, [])

  async function runOcr() {
    if (!file) return
    if (!API_KEY) {
      setErrorMsg('VITE_GOOGLE_VISION_API_KEY is not set. See .env.local.example.')
      setStatus('error')
      return
    }

    setStatus('loading'); setErrorMsg(''); setRows([])
    try {
      const b64 = await fileToBase64(file)
      const response = await callVisionApi(b64)
      const words = extractVisionWords(response)
      const found = buildRows(words)

      if (found.length === 0) {
        setErrorMsg('No course codes found. Try a clearer screenshot.')
        setStatus('error')
        return
      }
      setRows(found)
      setStatus('done')
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err))
      setStatus('error')
    }
  }

  // ── Row editing ─────────────────────────────────────────────────────────────

  function updateRowSeason(id: number, season: Season) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, season, autoDetected: false } : r))
    setImported(false)
  }

  function updateRowYear(id: number, year: number) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, year, autoDetected: false } : r))
    setImported(false)
  }

  function removeRow(id: number) {
    setRows(prev => prev.filter(r => r.id !== id))
    setImported(false)
  }

  // ── Import ──────────────────────────────────────────────────────────────────

  function handleImport() {
    if (rows.length === 0) return
    const merged = new Map<string, { year: number; season: Season; courses: string[] }>()
    for (const row of rows) {
      const key = `${row.season}-${row.year}`
      const ex = merged.get(key)
      if (ex) {
        for (const c of row.courses) if (!ex.courses.includes(c)) ex.courses.push(c)
      } else {
        merged.set(key, { year: row.year, season: row.season, courses: [...row.courses] })
      }
    }
    importCourses(planId, [...merged.values()])
    setImported(true)
    setTimeout(onClose, 700)
  }

  const totalCourses = rows.reduce((n, r) => n + r.courses.length, 0)
  const autoCount    = rows.filter(r => r.autoDetected).length

  const semCounts = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.season}-${r.year}`
    semCounts.set(key, (semCounts.get(key) ?? 0) + 1)
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-utm-navy">Import Plan from Screenshot</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-4">

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
                <p className="text-sm text-gray-500">Drop a screenshot of your degree plan here</p>
                <p className="text-xs text-gray-300 mt-1">or click to browse</p>
              </div>
            )}
          </div>

          {/* Loading */}
          {status === 'loading' && (
            <div className="flex items-center gap-3 py-1">
              <svg className="animate-spin w-4 h-4 text-utm-blue shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              <p className="text-[11px] text-gray-400">Sending to Google Cloud Vision…</p>
            </div>
          )}

          {/* Extract button */}
          {image && status !== 'loading' && status !== 'done' && (
            <button
              onClick={runOcr}
              className="w-full py-2 rounded-lg text-sm font-medium bg-utm-blue text-white hover:bg-utm-navy transition-colors"
            >
              Extract courses from image
            </button>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
              <p className="text-xs text-red-600">{errorMsg}</p>
              <button onClick={runOcr} className="text-xs text-red-400 underline hover:text-red-600">
                Try again
              </button>
            </div>
          )}

          {/* Extracted rows */}
          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {totalCourses} course{totalCourses !== 1 ? 's' : ''} in {rows.length} semester{rows.length !== 1 ? 's' : ''}
                </p>
                {autoCount > 0 && (
                  <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                    <span>✓</span> {autoCount} semester{autoCount !== 1 ? 's' : ''} auto-detected
                  </span>
                )}
              </div>

              {rows.map(row => {
                const key = `${row.season}-${row.year}`
                const isDuplicate = (semCounts.get(key) ?? 0) > 1

                return (
                  <div
                    key={row.id}
                    className={`rounded-lg border p-3 space-y-2 ${
                      isDuplicate ? 'border-amber-300 bg-amber-50/50'
                      : row.autoDetected ? 'border-emerald-200 bg-emerald-50/30'
                      : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={row.season}
                        onChange={e => updateRowSeason(row.id, e.target.value as Season)}
                        className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1.5 bg-white outline-none focus:border-utm-blue"
                      >
                        {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>

                      <select
                        value={row.year}
                        onChange={e => updateRowYear(row.id, parseInt(e.target.value, 10))}
                        className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1.5 bg-white outline-none focus:border-utm-blue"
                      >
                        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>

                      {row.autoDetected && (
                        <span className="text-[10px] text-emerald-600 font-medium">auto</span>
                      )}

                      <span className="flex-1" />

                      {isDuplicate && (
                        <span className="text-[10px] text-amber-600 font-medium">Duplicate</span>
                      )}

                      <button
                        onClick={() => removeRow(row.id)}
                        title="Remove this group"
                        className="text-gray-300 hover:text-red-500 text-sm transition-colors"
                      >
                        ×
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {row.courses.map(code => (
                        <span
                          key={code}
                          className="text-[11px] font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-[10px] text-gray-400">
            Powered by Google Cloud Vision API · your image is sent to Google for text recognition.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] text-gray-400">Matched semesters will have their courses replaced.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={rows.length === 0 || imported}
              className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                imported
                  ? 'bg-emerald-500 text-white'
                  : rows.length > 0
                    ? 'bg-utm-blue text-white hover:bg-utm-navy'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {imported
                ? 'Imported!'
                : rows.length > 0
                  ? `Import ${totalCourses} course${totalCourses !== 1 ? 's' : ''}`
                  : 'Import'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
