import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'

const TIME_SLOTS = [
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
]

function lessonDateYyyyMmDd(lesson) {
  const raw = String(lesson?.date || lesson?.fullDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const d = String(lesson?.day || '').trim()
  const ym = String(lesson?.monthKey || lesson?.month || '').trim()
  if (/^\d{4}-\d{2}$/.test(ym) && /^\d{1,2}$/.test(d)) {
    return `${ym}-${String(d).padStart(2, '0')}`
  }
  return ''
}

/**
 * Pick a new date/time for one reserved (固定) week. Works while Book lesson is WIP-disabled.
 */
export default function MoveReservedModal({ lesson, student, onClose, onMoved }) {
  const initialDate = lessonDateYyyyMmDd(lesson)
  const initialTime = (() => {
    const t = String(lesson?.time || '').trim()
    if (/^\d{2}:\d{2}/.test(t)) return t.slice(0, 5)
    return '16:00'
  })()
  const [date, setDate] = useState(initialDate || '')
  const [time, setTime] = useState(TIME_SLOTS.includes(initialTime) ? initialTime : initialTime || '16:00')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const unchanged = useMemo(() => {
    return date === initialDate && time === initialTime
  }, [date, time, initialDate, initialTime])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const eventId = String(lesson?.eventID || lesson?.event_id || '').trim()
    if (!eventId) {
      setError('Missing event id')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Pick a valid date')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setError('Pick a valid time')
      return
    }
    if (unchanged) {
      setError('Pick a different date or time')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.moveReservedSchedule({
        event_id: eventId,
        date,
        time,
      })
      onMoved?.(res, lesson)
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Failed to change date')
    } finally {
      setSubmitting(false)
    }
  }

  const name = student?.Name || student?.name || lesson?.studentName || 'Student'

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={submitting ? undefined : onClose} aria-hidden />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200"
      >
        <header className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Change date (固定)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Move this reserved week for {name}. Other 固定 weeks stay. Status stays Reserved.
          </p>
        </header>
        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
          )}
          <div className="text-xs text-gray-500">
            Current: {initialDate || '—'} {initialTime || ''}
          </div>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">New date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">New time</span>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {!TIME_SLOTS.includes(time) && time ? (
                <option value={time}>{time}</option>
              ) : null}
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || unchanged}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Moving…' : 'Change date'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  )
}
