/**
 * BackfillScheduleModal — Retroactively fetch past lessons from Google Calendar and sync to DB.
 * Uses server-side backfill (CALENDAR_POLL_URL + CALENDAR_POLL_API_KEY in .env) — no client rebuild needed.
 */
import { useState, useEffect } from 'react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import { Download, Calendar, X, FileSpreadsheet } from 'lucide-react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function BackfillScheduleModal({ onClose }) {
  const { success } = useToast()
  const [mode, setMode] = useState('year') // 'year' | 'month'
  const [year, setYear] = useState(() => new Date().getFullYear().toString())
  const [month, setMonth] = useState('01')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [backfillConfigured, setBackfillConfigured] = useState(null)

  useEffect(() => {
    api.getCalendarPollConfigured().then((r) => setBackfillConfigured(r.configured)).catch(() => setBackfillConfigured(false))
  }, [])

  const years = (() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 10 }, (_, i) => (y - i).toString())
  })()

  const handleSyncFromSheet = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await api.syncFromSheet()
      setResult({ label: 'From Sheet', upserted: res.upserted || 0 })
      success(`Synced ${res.upserted || 0} lessons from MonthlySchedule sheet`)
    } catch (e) {
      setResult({ error: e.message || 'Sync from sheet failed' })
    } finally {
      setLoading(false)
    }
  }

  const handleBackfill = async () => {
    setLoading(true)
    setResult(null)
    try {
      const body = mode === 'year' ? { year } : { month: `${year}-${month}` }
      const res = await api.backfillFromCalendar(body)
      const label = mode === 'year'
        ? `Year ${year}${res.backfill?.months?.length ? ` (${res.backfill.months.length} months)` : ''}`
        : `${MONTHS[parseInt(month, 10) - 1]} ${year}`
      const upserted = res.upserted ?? res.fetched ?? 0
      setResult({ label, upserted, message: res.fetched === 0 ? 'No events found' : null })
      success(upserted > 0 ? `Backfilled ${upserted} lessons from ${label}` : `Backfill complete: no events in ${label}`)
    } catch (e) {
      setResult({ error: e.message || 'Backfill failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Download className="w-5 h-5 text-green-600" />
            Backfill past lessons
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-4 space-y-4">
          {backfillConfigured === false && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Set CALENDAR_POLL_URL and CALENDAR_POLL_API_KEY in .env (project root, same folder as server) on the server. Then restart PM2.
            </p>
          )}
          <p className="text-sm text-gray-600">
            Fetch past lessons from Google Calendar (or from MonthlySchedule sheet) and sync to the database. Existing rows are updated (upsert).
          </p>
          <button
            type="button"
            onClick={handleSyncFromSheet}
            disabled={loading}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium flex items-center justify-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Sync from MonthlySchedule sheet
          </button>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="backfillMode"
                checked={mode === 'year'}
                onChange={() => setMode('year')}
                className="text-green-600"
              />
              <span className="text-sm">Full year</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="backfillMode"
                checked={mode === 'month'}
                onChange={() => setMode('month')}
                className="text-green-600"
              />
              <span className="text-sm">Single month</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            {mode === 'month' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Month</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {result && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                result.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'
              }`}
            >
              {result.error ? (
                result.error
              ) : (
                <>
                  <span className="font-medium">{result.label}:</span>{' '}
                  {result.upserted} {result.upserted === 1 ? 'lesson' : 'lessons'} synced
                  {result.message && ` — ${result.message}`}
                </>
              )}
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm font-medium"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleBackfill}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            {loading ? 'Syncing…' : 'Sync'}
          </button>
        </footer>
      </div>
    </div>
  )
}
