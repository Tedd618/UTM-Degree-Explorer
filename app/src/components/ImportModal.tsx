import React, { useState, useRef, useCallback } from 'react'
import type { Season } from '../types'
import { usePlanStore } from '../store/planStore'

interface Props {
  planId: string
  onClose: () => void
}

// ── Constants & types ────────────────────────────────────────────────────────

const SEASONS: Season[] = ['Fall', 'Winter', 'Summer']
const COURSE_CODE_RE = /^[A-Z]{2,4}\d{3}[HY]\d$/

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 8 }, (_, i) => currentYear - 2 + i)

interface ExtractedRow {
  id: number
  season: Season
  year: number
  courses: string[]
}

// ── Spatial word extraction from Tesseract blocks ────────────────────────────

interface WordPos { text: string; cy: number }

function extractWords(blocks: any[] | null): WordPos[] {
  const words: WordPos[] = []
  if (!blocks) return words
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim()
          if (text) {
            words.push({ text, cy: (word.bbox.y0 + word.bbox.y1) / 2 })
          }
        }
      }
    }
  }
  return words
}

/** Group course codes into rows by their Y position in the image. */
function groupCoursesByRow(words: WordPos[]): ExtractedRow[] {
  const courseCodes: { code: string; cy: number }[] = []
  for (const w of words) {
    if (COURSE_CODE_RE.test(w.text)) {
      courseCodes.push({ code: w.text, cy: w.cy })
    }
  }

  if (courseCodes.length === 0) return []

  courseCodes.sort((a, b) => a.cy - b.cy)

  // Cluster: consecutive codes with a Y gap < threshold stay in the same group.
  const gaps: number[] = []
  for (let i = 1; i < courseCodes.length; i++) {
    gaps.push(courseCodes[i].cy - courseCodes[i - 1].cy)
  }
  let threshold = 40
  if (gaps.length > 0) {
    const sorted = [...gaps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    threshold = Math.max(median * 2, 30)
  }

  const clusters: { codes: string[]; minY: number; maxY: number }[] = []
  for (const item of courseCodes) {
    const last = clusters[clusters.length - 1]
    if (last && item.cy - last.maxY < threshold) {
      if (!last.codes.includes(item.code)) last.codes.push(item.code)
      last.maxY = Math.max(last.maxY, item.cy)
    } else {
      clusters.push({ codes: [item.code], minY: item.cy, maxY: item.cy })
    }
  }

  return clusters.map((cluster, i) => ({
    id: i,
    season: 'Fall' as Season,
    year: currentYear,
    courses: cluster.codes,
  }))
}

// ── Image preprocessing ──────────────────────────────────────────────────────

function preprocessImage(imageUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const minDim = Math.min(img.width, img.height)
      const scale = Math.max(2, Math.ceil(2000 / minDim))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      // Grayscale
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
        d[i] = g; d[i + 1] = g; d[i + 2] = g
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(canvas)
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageUrl
  })
}

// ── Main modal ────────────────────────────────────────────────────────────────

type OcrStatus = 'idle' | 'loading' | 'done' | 'error'

export default function ImportModal({ planId, onClose }: Props) {
  const importCourses = usePlanStore(s => s.importCourses)

  const [image, setImage] = useState<string | null>(null)
  const [status, setStatus] = useState<OcrStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const [rows, setRows] = useState<ExtractedRow[]>([])
  const [imported, setImported] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  function loadFile(file: File) {
    if (!file.type.startsWith('image/')) return
    setImage(URL.createObjectURL(file))
    setStatus('idle')
    setProgress(0)
    setRows([])
    setErrorMsg('')
    setImported(false)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }, [])

  async function runOcr() {
    if (!image) return
    setStatus('loading'); setProgress(0); setErrorMsg(''); setRows([])
    try {
      setProgress(5)
      const canvas = await preprocessImage(image)

      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') setProgress(10 + Math.round(m.progress * 85))
        },
      })
      await worker.setParameters({ tessedit_pageseg_mode: '6' as any })
      const { data: { blocks } } = await worker.recognize(canvas, undefined, { blocks: true })
      await worker.terminate()

      const words = extractWords(blocks)
      const found = groupCoursesByRow(words)
      if (found.length === 0) {
        setErrorMsg('No course codes found. Try a clearer screenshot.')
        setStatus('error')
        return
      }
      setRows(found)
      setStatus('done')
    } catch (err) {
      setErrorMsg(String(err))
      setStatus('error')
    }
  }

  // ── Row editing ─────────────────────────────────────────────────────────────

  function updateRowSeason(id: number, season: Season) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, season } : r))
    setImported(false)
  }

  function updateRowYear(id: number, year: number) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, year } : r))
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
      const existing = merged.get(key)
      if (existing) {
        for (const c of row.courses) {
          if (!existing.courses.includes(c)) existing.courses.push(c)
        }
      } else {
        merged.set(key, { year: row.year, season: row.season, courses: [...row.courses] })
      }
    }
    importCourses(planId, [...merged.values()])
    setImported(true)
    setTimeout(onClose, 700)
  }

  const totalCourses = rows.reduce((n, r) => n + r.courses.length, 0)

  const semCounts = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.season}-${r.year}`
    semCounts.set(key, (semCounts.get(key) || 0) + 1)
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[620px] max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-utm-navy">Import Plan from Image</h2>
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
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs text-red-600">{errorMsg}</p>
              <button
                onClick={runOcr}
                className="mt-2 text-xs text-red-500 underline hover:text-red-700"
              >
                Try again
              </button>
            </div>
          )}

          {/* Extracted rows with editable semester dropdowns */}
          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                {totalCourses} course{totalCourses !== 1 ? 's' : ''} found — assign each row to a semester
              </p>

              {rows.map(row => {
                const key = `${row.season}-${row.year}`
                const isDuplicate = (semCounts.get(key) || 0) > 1

                return (
                  <div
                    key={row.id}
                    className={`rounded-lg border p-3 space-y-2 ${
                      isDuplicate ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 bg-gray-50'
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
            Uses Tesseract OCR — runs entirely in your browser, nothing is uploaded.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] text-gray-400">Matched semesters will have their courses replaced.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
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
              {imported ? 'Imported!' : rows.length > 0
                ? `Import ${totalCourses} course${totalCourses !== 1 ? 's' : ''}`
                : 'Import'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
