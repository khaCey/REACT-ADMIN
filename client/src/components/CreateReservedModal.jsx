import { useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { getCurrentYyyyMmJst, addOneMonthYyyyMm } from '../utils/jstMonth'

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

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
]

/**
 * Create a weekly reserved (固定) hold for the current/next month.
 */
export default function CreateReservedModal({ studentId, student, onClose, onCreated }) {
  const curYm = getCurrentYyyyMmJst()
  const nextYm = addOneMonthYyyyMm(curYm) || curYm
  const [month, setMonth] = useState(curYm)
  const [weekday, setWeekday] = useState(1)
  const [time, setTime] = useState('16:00')
  const [durationMinutes, setDurationMinutes] = useState(50)
  const [location, setLocation] = useState('Cafe')
  const [teacherName, setTeacherName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const sid = Number(studentId ?? student?.ID ?? student?.id)
    if (!Number.isFinite(sid) || sid <= 0) {
      setError('Student id is missing')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.createReservedSchedule({
        student_id: sid,
        month,
        weekday: Number(weekday),
        time,
        duration_minutes: Number(durationMinutes) || 50,
        location,
        teacher_name: teacherName.trim() || undefined,
      })
      onCreated?.(res)
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Failed to create 固定')
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={submitting ? undefined : onClose} aria-hidden />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200"
      >
        <header className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create 固定</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Weekly yellow reserved hold for {student?.Name || student?.name || 'this student'}
          </p>
        </header>
        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
          )}
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Month</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={curYm}>{curYm} (current)</option>
              {nextYm !== curYm && <option value={nextYm}>{nextYm} (next)</option>}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Weekday</span>
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {WEEKDAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Time</span>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Duration (minutes)</span>
            <input
              type="number"
              min={30}
              max={120}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Location</span>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="Cafe">Cafe</option>
              <option value="Online">Online</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Teacher (optional)</span>
            <input
              type="text"
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="#teacher name"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
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
            disabled={submitting}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-700 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create 固定'}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  )
}
