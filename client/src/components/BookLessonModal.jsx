import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { api } from '../api'
import { useCalendarPollingContext } from '../context/CalendarPollingContext'
import ExtendShiftModal from './ExtendShiftModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import { useToast } from '../context/ToastContext'

const TIME_SLOTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** Monday of the current week in Asia/Tokyo as YYYY-MM-DD (for slot keys and display). */
function getMondayJstStr() {
  const jst = new Date(Date.now() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth()
  const d = jst.getUTCDate()
  const day = new Date(Date.UTC(y, m, d)).getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const mon = new Date(Date.UTC(y, m, d + mondayOffset))
  return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`
}

/** Add n days to YYYY-MM-DD, return YYYY-MM-DD. */
function addDaysToDateStr(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d + n))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function formatDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** True if the given JST date+time slot is in the past (slots are in Asia/Tokyo). */
function isSlotPastJst(dateStr, timeStr) {
  const iso = `${dateStr}T${timeStr}:00+09:00`
  return new Date(iso).getTime() <= Date.now()
}

/** Day of week index for a JST date string (0=Mon, 6=Sun) for DAY_LABELS. */
function getJstDayIndex(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00')
  const utcDay = d.getUTCDay()
  return utcDay === 0 ? 6 : utcDay - 1
}

/** Format YYYY-MM-DD for display (e.g. "Mar 17, 2025"). */
function formatWeekLabel(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BookLessonModal({ studentId, student, onClose, onBooked }) {
  const { success } = useToast()
  const { lastSynced } = useCalendarPollingContext()
  const [weekStartStr, setWeekStartStr] = useState(getMondayJstStr)
  const [slots, setSlots] = useState({})
  const [teachersBySlot, setTeachersBySlot] = useState({})
  const [slotTypes, setSlotTypes] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingSlot, setPendingSlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [breakWarning, setBreakWarning] = useState(null)
  const [extendShiftOpen, setExtendShiftOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getWeekSchedule(weekStartStr)
      .then((data) => {
        setSlots(data.slots || {})
        setTeachersBySlot(data.teachersBySlot || {})
        setSlotTypes(data.slotTypes || {})
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [weekStartStr, lastSynced])

  const goWeek = (delta) => {
    setWeekStartStr(addDaysToDateStr(weekStartStr, delta * 7))
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStartStr, i))

  const handleSlotClick = (dateStr, timeStr) => {
    const key = `${dateStr}T${timeStr}`
    if (slots[key]) return
    const teachers = teachersBySlot[key] || []
    if (teachers.length === 0) return
    setPendingSlot({ date: dateStr, time: timeStr })
  }

  const handleConfirmBook = () => {
    if (!pendingSlot || studentId == null) return
    setBreakWarning(null)
    setSubmitting(true)
    api
      .getBookingWarning(pendingSlot.date, pendingSlot.time, studentId)
      .then((w) => {
        if (w.warn && w.message) setBreakWarning(w.message)
        return api.bookLesson({
          student_id: studentId,
          date: pendingSlot.date,
          time: pendingSlot.time,
          duration_minutes: 50,
        })
      })
      .then(() => {
        success('Lesson booked')
        onBooked?.()
        onClose()
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setSubmitting(false)
        setPendingSlot(null)
        setBreakWarning(null)
      })
  }

  const studentName = student?.Name || student?.name || 'Student'
  const studentKanji = student?.['漢字'] || student?.name_kanji || ''

  const modalBusy = loading || submitting

  const modal = (
    <div className="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-labelledby="bookLessonTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="relative w-full max-w-6xl max-h-[90vh] rounded-2xl bg-white shadow-xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          {modalBusy && <ModalLoadingOverlay />}
          <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <div>
              <h3 id="bookLessonTitle" className="text-lg font-semibold text-gray-900 leading-tight">Book a New Lesson</h3>
              <p className="text-xs text-gray-600 mt-0.5">
                {studentName} {studentKanji ? `(${studentKanji})` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExtendShiftOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                <Clock className="w-4 h-4" />
                Extend shift
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </header>

          <div className="px-5 pt-4 pb-5 flex-1 overflow-hidden flex flex-col min-h-0">
            {error && (
              <div className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => goWeek(-1)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Week
              </button>
              <h4 className="text-base font-semibold text-gray-900">
                Week of {formatWeekLabel(weekStartStr)}
              </h4>
              <button
                type="button"
                onClick={() => goWeek(1)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer"
              >
                Next Week
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="relative bg-white flex flex-col flex-1 min-h-0 overflow-hidden" style={{ maxHeight: '60vh', minHeight: 320 }}>
                <div className="flex-shrink-0 flex bg-green-600 text-white shadow-md z-10">
                  <div className="flex-shrink-0 w-14 px-3 py-2.5 text-sm font-semibold text-center border-r border-white/20">
                    Time
                  </div>
                  {weekDates.map((dateStr) => (
                    <div key={dateStr} className="flex-1 min-w-0 px-3 py-2.5 text-sm font-semibold text-center">
                      <div>{DAY_LABELS[getJstDayIndex(dateStr)]}</div>
                      <div className="text-xs font-normal text-white/90 mt-0.5">{dateStr.slice(8)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-1 min-h-0 overflow-y-auto pt-0.5">
                  <div className="flex-shrink-0 w-14 border-r border-gray-100">
                    {TIME_SLOTS.map((timeStr) => (
                      <div
                        key={timeStr}
                        className="px-3 py-1 flex items-center justify-center text-xs font-medium text-gray-700 bg-gray-50 border-b border-gray-100 min-h-[30px]"
                      >
                        {timeStr}
                      </div>
                    ))}
                  </div>
                  {weekDates.map((dateStr) => (
                      <div key={dateStr} className="flex-1 min-w-0 relative flex flex-col">
                        {TIME_SLOTS.map((timeStr) => {
                          const key = `${dateStr}T${timeStr}`
                          const booked = slots[key] || 0
                          const teachers = teachersBySlot[key] || []
                          const capacity = teachers.length
                          const slotType = slotTypes[key]
                          const isPast = isSlotPastJst(dateStr, timeStr)
                          const isFull = capacity > 0 && booked >= capacity
                          const oneLeft = capacity > 0 && booked === capacity - 1
                          const statusBead =
                            !isPast && capacity > 0
                              ? isFull
                                ? 'bg-red-500'
                                : oneLeft
                                  ? 'bg-orange-500'
                                  : 'bg-green-500'
                              : null
                          const label =
                            isPast
                              ? 'Past'
                              : capacity === 0
                                ? '—'
                                : isFull
                                  ? `${booked} lesson${booked > 1 ? 's' : ''}`
                                  : booked > 0
                                    ? `${booked} lesson${booked > 1 ? 's' : ''}`
                                    : 'Book'
                          return (
                            <div
                              key={timeStr}
                              className="flex min-h-[30px] border-b border-r border-gray-100"
                            >
                              <button
                                type="button"
                                disabled={isPast || capacity === 0 || isFull}
                                onClick={() => handleSlotClick(dateStr, timeStr)}
                                className={`flex-1 py-0.5 px-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                                  isPast
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : capacity === 0
                                      ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                      : isFull
                                        ? 'bg-amber-50 text-amber-800 cursor-default'
                                        : 'bg-white hover:bg-green-50 text-gray-800 hover:ring-2 hover:ring-green-500 hover:ring-inset cursor-pointer'
                                }`}
                              >
                                {statusBead && (
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusBead}`} aria-hidden />
                                )}
                                {label}
                                {slotType === 'kids' && <span className="text-[10px] text-gray-500">子</span>}
                                {slotType === 'adult' && <span className="text-[10px] text-gray-500">Adult</span>}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                  ))}
                </div>
            </div>
          </div>

          {pendingSlot && (
            <div className="shrink-0 p-4 border-t border-gray-200 bg-gray-50 flex flex-col gap-2">
              {breakWarning && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  {breakWarning}
                </p>
              )}
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-gray-700">
                  Book on <strong>{pendingSlot.date}</strong> at <strong>{pendingSlot.time}</strong>?
                </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPendingSlot(null)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmBook}
                  disabled={submitting}
                  className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Booking...' : 'Confirm'}
                </button>
              </div>
              </div>
            </div>
          )}

          <footer className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Close
            </button>
          </footer>
        </div>
      </div>
    </div>
  )

  return createPortal(
    <>
      {modal}
      {extendShiftOpen && (
        <ExtendShiftModal onClose={() => setExtendShiftOpen(false)} />
      )}
    </>,
    document.body
  )
}
