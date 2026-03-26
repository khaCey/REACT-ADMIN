import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { api } from '../api'
import { useCalendarPollingContext } from '../context/CalendarPollingContext'
import ExtendShiftModal from './ExtendShiftModal'
import ConfirmActionModal from './ConfirmActionModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import { useToast } from '../context/ToastContext'

const TIME_SLOTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** JST: show current+next month cards when today is in the last N days of the calendar month (tune if needed). */
const END_OF_MONTH_LOOKAHEAD_DAYS = 7

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

/** Day of week index for a JST civil date string YYYY-MM-DD (0=Mon, 6=Sun) for DAY_LABELS. */
function getJstDayIndex(dateStr) {
  // Noon JST stays on the same UTC calendar day as the JST date; midnight JST is "yesterday" in UTC,
  // so getUTCDay() was wrong (e.g. Thu + 20 when the 20th was Friday in Japan).
  const d = new Date(`${dateStr}T12:00:00+09:00`)
  const utcDay = d.getUTCDay()
  return utcDay === 0 ? 6 : utcDay - 1
}

/** Format YYYY-MM-DD for display (e.g. "Mar 17, 2025"). */
function formatWeekLabel(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Calendar month YYYY-MM in Asia/Tokyo (matches server latest-by-month keys). */
function getCurrentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/** Next calendar month as YYYY-MM (for showing this + next month cards). */
function addOneMonthYyyyMm(yyyyMm) {
  const [ys, ms] = String(yyyyMm).split('-')
  const y = parseInt(ys, 10)
  const mo = parseInt(ms, 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null
  let ny = y
  let nm = mo + 1
  if (nm > 12) {
    nm = 1
    ny += 1
  }
  return `${ny}-${String(nm).padStart(2, '0')}`
}

function toLessonMonthSummary(ym, entry) {
  if (!ym || !entry) return null
  const booked = entry.bookedLessonsCount
  const paid = entry.paidLessonsCount
  if (typeof booked !== 'number' || typeof paid !== 'number') return null
  return { yyyyMm: ym, label: entry.label || ym, booked, paid }
}

/** True when JST "today" is in the last END_OF_MONTH_LOOKAHEAD_DAYS of the month. */
function isEndOfMonthJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth() + 1
  const d = jst.getUTCDate()
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d > lastDay - END_OF_MONTH_LOOKAHEAD_DAYS
}

/**
 * Which month cards to show (GET /students/:id/latest-by-month).
 * 1) Quota full (paid > 0 and booked === paid): next month only; fallback to current if next missing.
 * 2) Else end of month (JST): current + next.
 * 3) Else: current only.
 */
function selectVisibleLessonMonthSummaries(latestByMonth) {
  if (!latestByMonth || typeof latestByMonth !== 'object') return []
  const ym0 = getCurrentYyyyMmJst()
  const ym1 = addOneMonthYyyyMm(ym0)
  const cur = toLessonMonthSummary(ym0, latestByMonth[ym0])
  const next = ym1 ? toLessonMonthSummary(ym1, latestByMonth[ym1]) : null

  const quotaFull = cur != null && cur.paid > 0 && cur.booked === cur.paid
  if (quotaFull) {
    if (next != null) return [next]
    if (cur != null) return [cur]
    return []
  }
  if (isEndOfMonthJst()) {
    const out = []
    if (cur != null) out.push(cur)
    if (next != null) out.push(next)
    return out
  }
  if (cur != null) return [cur]
  return []
}

/** Aligns with GET /student and POST /book (students.is_child). */
function studentIsChild(student) {
  if (!student) return false
  return (
    student.子 === '子' ||
    student.is_child === true ||
    student.IsChild === true
  )
}

/**
 * Hour bucket already has kids-only and/or adult-only lessons; block bookings that POST /book would reject.
 * @param {{ hasKids?: boolean, hasAdult?: boolean }|undefined} mix - from API slotMix[key]
 */
function isKidAdultMixBlocked(student, mix) {
  if (!mix || (!mix.hasKids && !mix.hasAdult)) return false
  const isChild = studentIsChild(student)
  if (isChild) return !!mix.hasAdult
  return !!mix.hasKids
}

/** Prefer prop from parent; fall back to loaded student object (API uses `ID`). */
function resolveBookStudentId(studentIdProp, student) {
  if (studentIdProp != null && studentIdProp !== '') return studentIdProp
  const fromStudent = student?.ID ?? student?.id
  if (fromStudent != null && fromStudent !== '') return fromStudent
  return null
}

export default function BookLessonModal({
  studentId,
  student,
  preloadedLatestByMonth,
  onClose,
  onBooked,
}) {
  const { success } = useToast()
  const { lastSynced } = useCalendarPollingContext()
  const [weekStartStr, setWeekStartStr] = useState(getMondayJstStr)
  const [slots, setSlots] = useState({})
  const [teachersBySlot, setTeachersBySlot] = useState({})
  const [slotTypes, setSlotTypes] = useState({})
  const [slotMix, setSlotMix] = useState({})
  /** Keys `YYYY-MM-DDTHH:MM` where this student already has a lesson (from GET /week?student_id=). */
  const [studentBookedSlots, setStudentBookedSlots] = useState({})
  /** Keys where booking would violate the 5 consecutive teaching-hour rule (server-aligned). */
  const [breakRuleBlocked, setBreakRuleBlocked] = useState({})
  /** Keys -> staff break entries from `lesson_kind = staff_break` (non-booking display). */
  const [staffBreakBySlot, setStaffBreakBySlot] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingSlot, setPendingSlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [breakWarning, setBreakWarning] = useState(null)
  const [extendShiftOpen, setExtendShiftOpen] = useState(false)
  /** Visible month card(s): booked/paid from latest-by-month (see selectVisibleLessonMonthSummaries). */
  const [lessonMonthSummaries, setLessonMonthSummaries] = useState(() =>
    preloadedLatestByMonth != null && typeof preloadedLatestByMonth === 'object'
      ? selectVisibleLessonMonthSummaries(preloadedLatestByMonth)
      : []
  )
  const [lessonBalanceLoaded, setLessonBalanceLoaded] = useState(
    () => preloadedLatestByMonth != null && typeof preloadedLatestByMonth === 'object'
  )
  /** Snapshot at slot pick so Confirm + async chain never lose date/time/id if state races. */
  const bookingIntentRef = useRef(null)

  const refreshLessonBalance = useCallback(() => {
    const sid = resolveBookStudentId(studentId, student)
    if (sid == null) {
      setLessonMonthSummaries([])
      setLessonBalanceLoaded(true)
      return
    }
    api
      .getStudentLatestByMonth(sid)
      .then((res) => {
        setLessonMonthSummaries(selectVisibleLessonMonthSummaries(res.latestByMonth))
      })
      .catch(() => setLessonMonthSummaries([]))
      .finally(() => setLessonBalanceLoaded(true))
  }, [studentId, student])

  /** Parent refreshed latest-by-month (e.g. after fetchData); keep UI in sync without loading flicker. */
  useEffect(() => {
    if (preloadedLatestByMonth != null && typeof preloadedLatestByMonth === 'object') {
      setLessonMonthSummaries(selectVisibleLessonMonthSummaries(preloadedLatestByMonth))
      setLessonBalanceLoaded(true)
    }
  }, [preloadedLatestByMonth])

  useEffect(() => {
    refreshLessonBalance()
  }, [refreshLessonBalance, lastSynced])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const sid = resolveBookStudentId(studentId, student)
    const weekOpts = sid != null ? { studentId: sid } : undefined
    api
      .getWeekSchedule(weekStartStr, weekOpts)
      .then((data) => {
        setSlots(data.slots || {})
        setTeachersBySlot(data.teachersBySlot || {})
        setSlotTypes(data.slotTypes || {})
        setSlotMix(data.slotMix || {})
        setStudentBookedSlots(data.studentBookedSlots || {})
        setBreakRuleBlocked(data.breakRuleBlocked || {})
        setStaffBreakBySlot(data.staffBreakBySlot || {})
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [weekStartStr, lastSynced, studentId, student])

  const goWeek = (delta) => {
    setWeekStartStr(addDaysToDateStr(weekStartStr, delta * 7))
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStartStr, i))

  const handleSlotClick = (dateStr, timeStr) => {
    if (resolveBookStudentId(studentId, student) == null) {
      setError('Student is not loaded. Close and reopen booking, or refresh the page.')
      return
    }
    const key = `${dateStr}T${timeStr}`
    if (studentBookedSlots[key]) return
    const booked = slots[key] || 0
    const teachers = teachersBySlot[key] || []
    const capacity = teachers.length
    if (capacity === 0 || booked >= capacity) return
    if (isKidAdultMixBlocked(student, slotMix[key])) return
    if (breakRuleBlocked[key]) return
    const sid = resolveBookStudentId(studentId, student)
    bookingIntentRef.current = { date: dateStr, time: timeStr, studentId: sid }
    setPendingSlot({ date: dateStr, time: timeStr })
  }

  const handleConfirmBook = () => {
    const intent = bookingIntentRef.current
    const slot = intent || pendingSlot
    const sidRaw = intent?.studentId ?? resolveBookStudentId(studentId, student)
    if (!slot?.date || !slot?.time || sidRaw == null || sidRaw === '') {
      setError('Missing student or time slot. Cancel and choose a slot again.')
      return
    }
    const numericId = Number(sidRaw)
    const student_id = Number.isFinite(numericId) ? numericId : sidRaw
    setBreakWarning(null)
    setError(null)
    setSubmitting(true)
    api
      .getBookingWarning(slot.date, slot.time, student_id)
      .then((w) => {
        if (w.warn && w.message) setBreakWarning(w.message)
        return api.bookLesson({
          student_id,
          date: String(slot.date),
          time: String(slot.time),
          duration_minutes: 50,
        })
      })
      .then(() => {
        success('Lesson booked (added to calendar)')
        onBooked?.()
        return Promise.all([
          api
            .getWeekSchedule(weekStartStr, { studentId: student_id })
            .catch(() => null),
          api.getStudentLatestByMonth(student_id).catch(() => null),
        ])
      })
      .then(([weekData, latestRes]) => {
        if (weekData) {
          setSlots(weekData.slots || {})
          setTeachersBySlot(weekData.teachersBySlot || {})
          setSlotTypes(weekData.slotTypes || {})
          setSlotMix(weekData.slotMix || {})
          setStudentBookedSlots(weekData.studentBookedSlots || {})
          setBreakRuleBlocked(weekData.breakRuleBlocked || {})
          setStaffBreakBySlot(weekData.staffBreakBySlot || {})
        }
        if (latestRes?.latestByMonth) {
          setLessonMonthSummaries(selectVisibleLessonMonthSummaries(latestRes.latestByMonth))
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setSubmitting(false)
        setPendingSlot(null)
        bookingIntentRef.current = null
        setBreakWarning(null)
      })
  }

  const studentName = student?.Name || student?.name || 'Student'
  const studentKanji = student?.['漢字'] || student?.name_kanji || ''

  /** Full-panel overlay only while loading the week grid; booking submit shows spinner on confirm button only. */
  const modalBusy = loading

  /** Compact header corner: booked / paid (not full-width). */
  const lessonBalanceCorner =
    lessonBalanceLoaded && lessonMonthSummaries.length > 0 ? (
      <div
        className="w-[7.25rem] shrink-0 rounded-md border border-gray-200 bg-gray-50/90 px-1.5 py-1 shadow-sm"
        aria-label="Lessons booked versus paid this period"
      >
        <div className="flex flex-col gap-1">
          {lessonMonthSummaries.map((m, idx) => (
            <div
              key={m.yyyyMm}
              className={
                idx > 0 ? 'pt-1 border-t border-gray-200/80' : ''
              }
            >
              <div className="text-[8px] font-semibold text-gray-500 uppercase tracking-wide leading-none truncate" title={m.label}>
                {m.label}
              </div>
              <div className="mt-0.5 flex items-center justify-center gap-0.5 tabular-nums">
                <span className="text-sm font-bold text-emerald-800 leading-none">{m.booked}</span>
                <span className="text-[10px] text-gray-400 font-light leading-none">/</span>
                <span className="text-sm font-bold text-gray-800 leading-none">{m.paid}</span>
              </div>
              <div className="mt-px flex justify-between gap-1 text-[7px] text-gray-500 uppercase tracking-tighter leading-none px-px">
                <span>Bkd</span>
                <span>Pd</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : !lessonBalanceLoaded ? (
      <div className="w-[7.25rem] shrink-0 rounded-md border border-dashed border-gray-200 px-1.5 py-1 min-h-[2.5rem] flex items-center justify-center">
        <p className="text-[9px] text-gray-400 leading-tight">Balance…</p>
      </div>
    ) : null

  const modal = (
    <div className="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-labelledby="bookLessonTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="relative w-full max-w-6xl max-h-[90vh] rounded-2xl bg-white shadow-xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          {modalBusy && <ModalLoadingOverlay />}
          <header className="shrink-0 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 py-3 border-b border-gray-200">
            <div className="min-w-0 flex-1">
              <h3 id="bookLessonTitle" className="text-lg font-semibold text-gray-900 leading-tight">Book a New Lesson</h3>
              <p className="text-xs text-gray-600 mt-0.5">
                {studentName} {studentKanji ? `(${studentKanji})` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 ml-auto">
              {lessonBalanceCorner}
              <div className="flex items-center gap-2 shrink-0">
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
            </div>
          </header>

          <div className="px-5 pt-4 pb-5 flex-1 overflow-hidden flex flex-col min-h-0">
            {error && (
              <div className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
                {error}
              </div>
            )}

            {lessonBalanceLoaded && lessonMonthSummaries.length === 0 && (
              <p className="mb-2 text-[11px] text-gray-600 leading-snug">
                {studentIsChild(student)
                  ? 'Child (子): only hours without adult lessons can be booked.'
                  : 'Adult: only hours without kids (子) lessons can be booked.'}
              </p>
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
                          const mix = slotMix[key]
                          const mixBlocked = isKidAdultMixBlocked(student, mix)
                          const breakBlocked = !!breakRuleBlocked[key]
                          const alreadyYours = !!studentBookedSlots[key]
                          const isPast = isSlotPastJst(dateStr, timeStr)
                          const isFull = capacity > 0 && booked >= capacity
                          const oneLeft = capacity > 0 && booked === capacity - 1
                          const staffBreaks = staffBreakBySlot[key] || []
                          const statusBead =
                            !isPast && capacity > 0 && !mixBlocked && !alreadyYours && !breakBlocked
                              ? isFull
                                ? 'bg-red-500'
                                : oneLeft
                                  ? 'bg-orange-500'
                                  : 'bg-green-500'
                              : null
                          const mixLabel =
                            mixBlocked && !isPast && capacity > 0 && !isFull && !alreadyYours
                              ? studentIsChild(student)
                                ? 'Adult slot'
                                : 'Kids slot'
                              : null
                          const breakLabel =
                            breakBlocked && !isPast && capacity > 0 && !isFull && !alreadyYours && !mixBlocked
                              ? 'Break needed'
                              : null
                          const label = alreadyYours
                            ? 'Yours'
                            : mixLabel
                              ? mixLabel
                              : breakLabel
                                ? breakLabel
                                : isPast
                                  ? 'Past'
                                  : capacity === 0
                                    ? '—'
                                    : isFull
                                      ? `${booked} lesson${booked > 1 ? 's' : ''}`
                                      : booked > 0
                                        ? `${booked} lesson${booked > 1 ? 's' : ''}`
                                        : 'Book'
                          const bookingUnavailable =
                            isPast ||
                            capacity === 0 ||
                            isFull ||
                            mixBlocked ||
                            alreadyYours ||
                            breakBlocked
                          return (
                            <div
                              key={timeStr}
                              className="flex min-h-[30px] flex-col gap-0.5 border-b border-r border-gray-100 py-0.5 px-0.5"
                            >
                              {staffBreaks.length > 0 && (
                                <div className="flex flex-col gap-0.5 shrink-0">
                                  {staffBreaks.map((b, bi) => (
                                    <div
                                      key={`${b.teacher_name}-${bi}`}
                                      className="rounded border border-slate-200/80 bg-slate-100/95 px-1 py-0.5 text-center text-[9px] font-medium leading-tight text-slate-700 pointer-events-none select-none"
                                      title={b.title || undefined}
                                    >
                                      {b.title?.trim() || `${b.teacher_name}'s Break`}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button
                                type="button"
                                disabled={
                                  isPast ||
                                  capacity === 0 ||
                                  isFull ||
                                  mixBlocked ||
                                  alreadyYours ||
                                  breakBlocked
                                }
                                onClick={() => handleSlotClick(dateStr, timeStr)}
                                className={`flex-1 min-h-[24px] py-0.5 px-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                                  isPast
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : alreadyYours
                                      ? 'bg-violet-50 text-violet-800 cursor-not-allowed'
                                      : capacity === 0
                                        ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                        : mixBlocked
                                          ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                                          : breakBlocked
                                            ? 'bg-amber-50/90 text-amber-900 cursor-not-allowed'
                                            : isFull
                                              ? 'bg-amber-50 text-amber-800 cursor-default'
                                              : 'bg-white hover:bg-green-50 text-gray-800 hover:ring-2 hover:ring-green-500 hover:ring-inset cursor-pointer'
                                }`}
                              >
                                {statusBead && (
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusBead}`} aria-hidden />
                                )}
                                <span className={bookingUnavailable ? 'line-through' : undefined}>
                                  {label}
                                  {slotType === 'kids' && <span className="text-[10px] text-gray-500">子</span>}
                                  {slotType === 'adult' && <span className="text-[10px] text-gray-500">Adult</span>}
                                  {slotType === 'mixed' && (
                                    <span className="text-[10px] text-gray-500">子+Adult</span>
                                  )}
                                </span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                  ))}
                </div>
            </div>
          </div>

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
      {pendingSlot && (
        <ConfirmActionModal
          title="Confirm booking"
          message={`Book on ${pendingSlot.date} at ${pendingSlot.time}?`}
          showCloseButton={false}
          onClose={() => {
            if (!submitting) {
              setPendingSlot(null)
              bookingIntentRef.current = null
            }
          }}
          onConfirm={handleConfirmBook}
          confirming={submitting}
          confirmLabel="Confirm"
          busyConfirmLabel="Booking..."
          cancelLabel="Cancel"
        >
          {breakWarning ? (
            <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {breakWarning}
            </p>
          ) : null}
        </ConfirmActionModal>
      )}
      {extendShiftOpen && (
        <ExtendShiftModal onClose={() => setExtendShiftOpen(false)} />
      )}
    </>,
    document.body
  )
}
