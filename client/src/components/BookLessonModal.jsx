import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { api } from '../api'
import { useCalendarPollingContext } from '../context/CalendarPollingContext'
import ExtendShiftModal from './ExtendShiftModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import PreBookLessonModal from './PreBookLessonModal'
import ConfirmActionModal from './ConfirmActionModal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { endTimeOneHourAfterStart } from '../utils/breakPresetTime.js'
import { studentIsDemoOrTrial } from '../config/booking'

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

function getYyyyMmFromDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  return dateStr.slice(0, 7)
}

function getNextYyyyMm(yyyyMm) {
  if (!yyyyMm || typeof yyyyMm !== 'string') return null
  const m = yyyyMm.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  let y = parseInt(m[1], 10)
  let mo = parseInt(m[2], 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null
  mo += 1
  if (mo > 12) {
    mo = 1
    y += 1
  }
  return `${y}-${String(mo).padStart(2, '0')}`
}

function getFirstMondayOfMonth(yyyyMm) {
  const m = String(yyyyMm || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null
  const firstDay = `${y}-${String(mo).padStart(2, '0')}-01`
  // Monday of the week that contains the 1st.
  const day = new Date(`${firstDay}T12:00:00+09:00`).getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDaysToDateStr(firstDay, mondayOffset)
}

function getWeekStartsCoveringTwoMonthsJst() {
  const nowJst = new Date(Date.now() + JST_OFFSET_MS)
  const curYm = `${nowJst.getUTCFullYear()}-${String(nowJst.getUTCMonth() + 1).padStart(2, '0')}`
  const nextYm = getNextYyyyMm(curYm)
  const start = getFirstMondayOfMonth(curYm)
  if (!start) return []

  // End boundary: start of the month after next (exclusive), in JST civil date string.
  const afterNextYm = nextYm ? getNextYyyyMm(nextYm) : null
  const endExclusive = afterNextYm ? `${afterNextYm}-01` : null
  if (!endExclusive) return [start]

  const weekStarts = []
  let ws = start
  while (ws < endExclusive) {
    weekStarts.push(ws)
    ws = addDaysToDateStr(ws, 7)
  }
  return weekStarts
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

/** Calendar sync may still store "Preset break …"; show "{Name}'s Break" instead. */
function formatBreakChipLabel(b) {
  const name = String(b?.teacher_name || 'Staff').trim()
  const raw = String(b?.title || '').trim()
  if (!raw || /^preset\s+break/i.test(raw)) {
    return `${name}'s Break`
  }
  return raw
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

function getCurrentMonthSummary(latestByMonth) {
  if (!latestByMonth || typeof latestByMonth !== 'object') return null
  const ym = getCurrentYyyyMmJst()
  return toLessonMonthSummary(ym, latestByMonth[ym])
}

function paidPackForMonth(ym, latestByMonth) {
  const e = latestByMonth?.[ym]
  if (!e || typeof e.paidLessonsCount !== 'number') return 0
  return e.paidLessonsCount > 0 ? e.paidLessonsCount : 0
}

function countActiveLessonsInMonth(ym, latestByMonth) {
  const e = latestByMonth?.[ym]
  if (!e?.lessons) return 0
  return e.lessons.filter(
    (l) => (l.status || '').toLowerCase() !== 'cancelled' && l.status !== 'unscheduled'
  ).length
}

function slotMonthFromKey(key) {
  const d = String(key || '').split('T')[0]
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(0, 7) : ''
}

function countSlotsInMonthForKeys(selectedKeys, ym) {
  return selectedKeys.filter((k) => slotMonthFromKey(k) === ym).length
}

/**
 * POST /book pack_total: override/local, else per selected calendar month from latest-by-month.
 * @returns {{ mode: 'none' } | { mode: 'single', value: number } | { mode: 'perMonth', perMonth: Record<string, number> }}
 */
function derivePackTotalForBooking(latestByMonth, overridePaidLessons, localPackOverride, selectedSlotKeys, student) {
  if (student && studentIsDemoOrTrial(student)) return { mode: 'single', value: 1 }
  const loc = Number(localPackOverride)
  if (Number.isFinite(loc) && loc > 0) return { mode: 'single', value: loc }
  const overrideTotal = Number(overridePaidLessons)
  if (Number.isFinite(overrideTotal) && overrideTotal > 0) return { mode: 'single', value: overrideTotal }

  const months = [...new Set(selectedSlotKeys.map((k) => slotMonthFromKey(k)).filter(Boolean))]
  if (months.length === 0) {
    const cur = getCurrentMonthSummary(latestByMonth)
    if (cur && typeof cur.paid === 'number' && cur.paid > 0) return { mode: 'single', value: cur.paid }
    return { mode: 'none' }
  }
  const perMonth = {}
  for (const ym of months) {
    const p = paidPackForMonth(ym, latestByMonth)
    if (!p) return { mode: 'none' }
    perMonth[ym] = p
  }
  return { mode: 'perMonth', perMonth }
}

function checkOverQuotaForSelection(selectedSlotKeys, latestByMonth, student) {
  if (student && studentIsDemoOrTrial(student)) return null
  const months = [...new Set(selectedSlotKeys.map((k) => slotMonthFromKey(k)).filter(Boolean))].sort()
  for (const ym of months) {
    const paid = paidPackForMonth(ym, latestByMonth)
    const active = countActiveLessonsInMonth(ym, latestByMonth)
    const adding = countSlotsInMonthForKeys(selectedSlotKeys, ym)
    if (paid > 0 && active + adding > paid) {
      return {
        ym,
        label: latestByMonth?.[ym]?.label || ym,
        active,
        paid,
        adding,
        minPack: active + adding,
      }
    }
  }
  return null
}

function packTotalForSlotDate(packResult, dateStr) {
  const ym = String(dateStr || '').slice(0, 7)
  if (packResult.mode === 'single') return packResult.value
  if (packResult.mode === 'perMonth' && packResult.perMonth?.[ym]) return packResult.perMonth[ym]
  return undefined
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
  overridePaidLessons = null,
  rescheduleSource = null,
  onClose,
  onBooked,
}) {
  const { success } = useToast()
  const { staff } = useAuth()
  const { lastSynced } = useCalendarPollingContext()
  const canEditBreakPresets = !!(staff?.is_admin || staff?.is_operator)
  const [moveBreakModal, setMoveBreakModal] = useState(null)
  const [moveBreakSaving, setMoveBreakSaving] = useState(false)
  const [weekStartStr, setWeekStartStr] = useState(getMondayJstStr)
  const [slots, setSlots] = useState({})
  const [teachersBySlot, setTeachersBySlot] = useState({})
  const [slotTypes, setSlotTypes] = useState({})
  const [slotMix, setSlotMix] = useState({})
  /** Keys `YYYY-MM-DDTHH:MM` where this student already has a lesson (from GET /week?student_id=). */
  const [studentBookedSlots, setStudentBookedSlots] = useState({})
  /** Keys where booking would violate the 5 consecutive teaching-hour rule (server-aligned). */
  const [breakRuleBlocked, setBreakRuleBlocked] = useState({})
  /** Owner's course: slots where OWNER_COURSE_STAFF_ID teacher is not on shift (server). */
  const [ownerShamBlocked, setOwnerShamBlocked] = useState({})
  /** Keys -> staff break entries from `lesson_kind = staff_break` (non-booking display). */
  const [staffBreakBySlot, setStaffBreakBySlot] = useState({})
  const [loading, setLoading] = useState(true)
  /** Monday YYYY-MM-DD of the week that `slots` / `teachersBySlot` currently describe (null until first load). */
  const [scheduleWeekStart, setScheduleWeekStart] = useState(null)
  const [hasLoadedWeekOnce, setHasLoadedWeekOnce] = useState(false)
  const [error, setError] = useState(null)
  const [selectedSlotKeys, setSelectedSlotKeys] = useState([])
  const [packTotalPromptOpen, setPackTotalPromptOpen] = useState(false)
  /** Set when user confirms 月の回数 inside this modal (persists until modal closes). */
  const [localPackOverride, setLocalPackOverride] = useState(null)
  /** After renumber / over-quota save, overrides parent preloaded latest-by-month until prop changes. */
  const [latestByMonthLocal, setLatestByMonthLocal] = useState(null)
  const [overQuotaState, setOverQuotaState] = useState(null)
  const [overQuotaConfirmOpen, setOverQuotaConfirmOpen] = useState(false)
  const [overQuotaEditOpen, setOverQuotaEditOpen] = useState(false)
  /** Slot that triggered click-time over-quota warning (kept pending until pack is updated). */
  const [pendingOverQuotaSlotKey, setPendingOverQuotaSlotKey] = useState(null)
  const [successModal, setSuccessModal] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [extendShiftOpen, setExtendShiftOpen] = useState(false)
  /** Cache weekStartStr -> week schedule payload for seamless scrolling between weeks. */
  const [weekCache, setWeekCache] = useState({})
  /** Visible month card(s): booked/paid from latest-by-month (see selectVisibleLessonMonthSummaries). */
  const [lessonMonthSummaries, setLessonMonthSummaries] = useState(() =>
    preloadedLatestByMonth != null && typeof preloadedLatestByMonth === 'object'
      ? selectVisibleLessonMonthSummaries(preloadedLatestByMonth)
      : []
  )
  const [lessonBalanceLoaded, setLessonBalanceLoaded] = useState(
    () => preloadedLatestByMonth != null && typeof preloadedLatestByMonth === 'object'
  )
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
    setLatestByMonthLocal(null)
  }, [preloadedLatestByMonth])

  useEffect(() => {
    refreshLessonBalance()
  }, [refreshLessonBalance, lastSynced])

  useEffect(() => {
    const sid = resolveBookStudentId(studentId, student)
    const weekOpts = sid != null ? { studentId: sid } : undefined
    const cacheKey = `${weekStartStr}::${sid ?? ''}`
    const cached = weekCache[cacheKey]
    if (cached) {
      setSlots(cached.slots || {})
      setTeachersBySlot(cached.teachersBySlot || {})
      setSlotTypes(cached.slotTypes || {})
      setSlotMix(cached.slotMix || {})
      setStudentBookedSlots(cached.studentBookedSlots || {})
      setBreakRuleBlocked(cached.breakRuleBlocked || {})
      setOwnerShamBlocked(cached.ownerShamBlocked || {})
      setStaffBreakBySlot(cached.staffBreakBySlot || {})
      setScheduleWeekStart(weekStartStr)
      setHasLoadedWeekOnce(true)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    api
      .getWeekSchedule(weekStartStr, weekOpts)
      .then((data) => {
        setSlots(data.slots || {})
        setTeachersBySlot(data.teachersBySlot || {})
        setSlotTypes(data.slotTypes || {})
        setSlotMix(data.slotMix || {})
        setStudentBookedSlots(data.studentBookedSlots || {})
        setBreakRuleBlocked(data.breakRuleBlocked || {})
        setOwnerShamBlocked(data.ownerShamBlocked || {})
        setStaffBreakBySlot(data.staffBreakBySlot || {})
        setScheduleWeekStart(weekStartStr)
        setWeekCache((prev) => ({ ...prev, [cacheKey]: data }))
        setHasLoadedWeekOnce(true)
      })
      .catch((e) => {
        setError(e.message)
        setHasLoadedWeekOnce(true)
      })
      .finally(() => setLoading(false))
  }, [weekStartStr, lastSynced, studentId, student, weekCache])

  useEffect(() => {
    // When lessons are synced, clear cached weeks so we refetch fresh counts/capacity.
    setWeekCache({})
  }, [lastSynced])

  useEffect(() => {
    // Preload current + next month (JST) so moving across weeks feels seamless.
    const sid = resolveBookStudentId(studentId, student)
    const weekOpts = sid != null ? { studentId: sid } : undefined
    const weekStarts = getWeekStartsCoveringTwoMonthsJst()
    if (weekStarts.length === 0) return

    let cancelled = false
    ;(async () => {
      for (const ws of weekStarts) {
        const cacheKey = `${ws}::${sid ?? ''}`
        if (cancelled) return
        if (weekCache[cacheKey]) continue
        try {
          const data = await api.getWeekSchedule(ws, weekOpts)
          if (cancelled) return
          setWeekCache((prev) => (prev[cacheKey] ? prev : { ...prev, [cacheKey]: data }))
        } catch {
          // ignore preload errors; current week fetch handles visible errors
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [studentId, student, weekCache])

  useEffect(() => {
    // On modal open, refresh lesson schedule snapshot from GAS for current + next month (JST).
    // Non-blocking: UI remains interactive; week grid refetches after refresh finishes.
    let cancelled = false
    const ym0 = getCurrentYyyyMmJst()
    const ym1 = addOneMonthYyyyMm(ym0)
    const months = [ym0, ym1].filter(Boolean)
    if (months.length === 0) return

    Promise.all(months.map((m) => api.backfillFromCalendar({ month: m }).catch(() => null))).finally(() => {
      if (cancelled) return
      // Invalidate week cache so active week reloads with fresh DB data.
      setWeekCache({})
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Invalidate selections only for the *visible* week. Keys from other weeks are kept so
    // prev/next navigation does not wipe a multi-week selection (their capacity is not in `slots`).
    // Skip until `slots` match the visible week: after changing week, state still holds the previous
    // week's map briefly; validating then would drop all selections for the week we navigated to.
    if (scheduleWeekStart !== weekStartStr) return
    const weekDateSet = new Set(
      Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStartStr, i))
    )
    setSelectedSlotKeys((prev) =>
      prev.filter((key) => {
        const [dateStr, timeStr] = key.split('T')
        if (!dateStr || !timeStr) return false
        if (studentBookedSlots[key]) return false
        if (isSlotPastJst(dateStr, timeStr)) return false
        if (!weekDateSet.has(dateStr)) return true
        const booked = slots[key] || 0
        const capacity = (teachersBySlot[key] || []).length
        if (capacity === 0 || booked >= capacity) return false
        if (isKidAdultMixBlocked(student, slotMix[key])) return false
        if (breakRuleBlocked[key]) return false
        if (ownerShamBlocked[key]) return false
        return true
      })
    )
  }, [
    scheduleWeekStart,
    weekStartStr,
    slots,
    teachersBySlot,
    slotMix,
    breakRuleBlocked,
    ownerShamBlocked,
    studentBookedSlots,
    student,
  ])

  const goWeek = (delta) => {
    setWeekStartStr(addDaysToDateStr(weekStartStr, delta * 7))
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStartStr, i))
  const effectiveLatest = latestByMonthLocal ?? preloadedLatestByMonth

  const handleSlotClick = (dateStr, timeStr) => {
    if (resolveBookStudentId(studentId, student) == null) {
      setError('Student is not loaded. Close and reopen booking, or refresh the page.')
      return
    }
    const key = `${dateStr}T${timeStr}`
    if (selectedSlotKeys.includes(key)) {
      setSelectedSlotKeys((prev) => prev.filter((k) => k !== key))
      if (pendingOverQuotaSlotKey === key) setPendingOverQuotaSlotKey(null)
      return
    }
    if (studentBookedSlots[key]) return
    const booked = slots[key] || 0
    const teachers = teachersBySlot[key] || []
    const capacity = teachers.length
    if (capacity === 0 || booked >= capacity) return
    if (isKidAdultMixBlocked(student, slotMix[key])) return
    if (breakRuleBlocked[key]) return
    if (ownerShamBlocked[key]) return
    if (rescheduleSource) {
      setSelectedSlotKeys([key])
      return
    }
    const nextSelected = [...selectedSlotKeys, key]
    const over = checkOverQuotaForSelection(nextSelected, effectiveLatest, student)
    if (over) {
      setOverQuotaState(over)
      setPendingOverQuotaSlotKey(key)
      setOverQuotaConfirmOpen(true)
      return
    }
    setSelectedSlotKeys(nextSelected)
  }

  const handleSubmitSelected = async () => {
    const sidRaw = resolveBookStudentId(studentId, student)
    if (sidRaw == null || sidRaw === '') {
      setError('Missing student. Close and reopen booking, or refresh the page.')
      return
    }
    if (selectedSlotKeys.length === 0) {
      setError('Please select one or more slots first.')
      return
    }
    if (rescheduleSource) {
      if (selectedSlotKeys.length !== 1) {
        setError('Select exactly one target slot for reschedule.')
        return
      }
      const [date, time] = selectedSlotKeys[0].split('T')
      setSubmitting(true)
      setError(null)
      try {
        await api.rescheduleLesson({
          source_event_id: rescheduleSource.eventID,
          source_student_name: student?.Name || student?.name || '',
          student_id: sidRaw,
          date,
          time,
          duration_minutes: 50,
          location: 'Cafe',
        })
        success('Lesson rescheduled')
        onBooked?.()
        const [weekData, latestRes] = await Promise.all([
          api.getWeekSchedule(weekStartStr, { studentId: sidRaw }).catch(() => null),
          api.getStudentLatestByMonth(sidRaw).catch(() => null),
        ])
        if (weekData) {
          setSlots(weekData.slots || {})
          setTeachersBySlot(weekData.teachersBySlot || {})
          setSlotTypes(weekData.slotTypes || {})
          setSlotMix(weekData.slotMix || {})
          setStudentBookedSlots(weekData.studentBookedSlots || {})
          setBreakRuleBlocked(weekData.breakRuleBlocked || {})
          setOwnerShamBlocked(weekData.ownerShamBlocked || {})
          setStaffBreakBySlot(weekData.staffBreakBySlot || {})
          setScheduleWeekStart(weekStartStr)
        }
        if (latestRes?.latestByMonth) {
          setLessonMonthSummaries(selectVisibleLessonMonthSummaries(latestRes.latestByMonth))
        }
        setSelectedSlotKeys([])
        setSuccessModal({
          title: 'Reschedule completed',
          message: 'The lesson was rescheduled successfully.',
        })
      } catch (e) {
        setError(e?.message || 'Failed to reschedule lesson')
      } finally {
        setSubmitting(false)
      }
      return
    }
    const packResult = derivePackTotalForBooking(
      effectiveLatest,
      overridePaidLessons,
      localPackOverride,
      selectedSlotKeys,
      student
    )
    if (packResult.mode === 'none') {
      setPackTotalPromptOpen(true)
      return
    }
    const over = checkOverQuotaForSelection(selectedSlotKeys, effectiveLatest, student)
    if (over) {
      setOverQuotaState(over)
      setOverQuotaConfirmOpen(true)
      return
    }
    await submitBookingsWithPackResult(packResult)
  }

  const submitBookingsWithPackResult = async (packResult, slotKeysOverride = null) => {
    const sidRaw = resolveBookStudentId(studentId, student)
    if (sidRaw == null || sidRaw === '') {
      setError('Missing student. Close and reopen booking, or refresh the page.')
      return
    }
    const numericId = Number(sidRaw)
    const student_id = Number.isFinite(numericId) ? numericId : sidRaw
    setError(null)
    setSubmitting(true)
    try {
      const selected = [...(slotKeysOverride ?? selectedSlotKeys)].sort()
      const failed = []
      const touchedMonths = new Set()
      let successCount = 0

      for (const key of selected) {
        const [date, time] = key.split('T')
        if (!date || !time) continue
        const packTotal = packTotalForSlotDate(packResult, date)
        if (packTotal == null || packTotal <= 0) {
          failed.push(`${date} ${time}: Missing lesson pack total for this month.`)
          continue
        }
        try {
          await api.getBookingWarning(date, time, student_id)
          await api.bookLesson({
            student_id,
            date: String(date),
            time: String(time),
            duration_minutes: 50,
            pack_total: packTotal,
            location: 'Cafe',
          })
          successCount += 1
          touchedMonths.add(String(date).slice(0, 7))
        } catch (e) {
          failed.push(`${date} ${time}: ${e?.message || 'Failed to book'}`)
        }
      }

      if (successCount > 0) {
        success(`${successCount} lesson${successCount > 1 ? 's' : ''} booked (added to calendar)`)
        onBooked?.()
        await Promise.all([...touchedMonths].map((month) => api.backfillFromCalendar({ month }).catch(() => null)))
      }
      if (failed.length > 0) {
        setError(`Some slots could not be booked. ${failed.slice(0, 2).join(' | ')}${failed.length > 2 ? ' ...' : ''}`)
      } else {
        setSelectedSlotKeys([])
      }

      const [weekData, latestRes] = await Promise.all([
        api.getWeekSchedule(weekStartStr, { studentId: student_id }).catch(() => null),
        api.getStudentLatestByMonth(student_id).catch(() => null),
      ])
      if (weekData) {
        setSlots(weekData.slots || {})
        setTeachersBySlot(weekData.teachersBySlot || {})
        setSlotTypes(weekData.slotTypes || {})
        setSlotMix(weekData.slotMix || {})
        setStudentBookedSlots(weekData.studentBookedSlots || {})
        setBreakRuleBlocked(weekData.breakRuleBlocked || {})
        setOwnerShamBlocked(weekData.ownerShamBlocked || {})
        setStaffBreakBySlot(weekData.staffBreakBySlot || {})
        setScheduleWeekStart(weekStartStr)
      }
      if (latestRes?.latestByMonth) {
        setLessonMonthSummaries(selectVisibleLessonMonthSummaries(latestRes.latestByMonth))
      }
      if (successCount > 0 && failed.length === 0) {
        setSuccessModal({
          title: 'Booking completed',
          message: `${successCount} lesson${successCount > 1 ? 's were' : ' was'} booked successfully.`,
        })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const refetchWeekSchedule = useCallback(async () => {
    const sid = resolveBookStudentId(studentId, student)
    const weekOpts = sid != null ? { studentId: sid } : undefined
    const cacheKey = `${weekStartStr}::${sid ?? ''}`
    try {
      const data = await api.getWeekSchedule(weekStartStr, weekOpts)
      setSlots(data.slots || {})
      setTeachersBySlot(data.teachersBySlot || {})
      setSlotTypes(data.slotTypes || {})
      setSlotMix(data.slotMix || {})
      setStudentBookedSlots(data.studentBookedSlots || {})
      setBreakRuleBlocked(data.breakRuleBlocked || {})
      setOwnerShamBlocked(data.ownerShamBlocked || {})
      setStaffBreakBySlot(data.staffBreakBySlot || {})
      setScheduleWeekStart(weekStartStr)
      setWeekCache((prev) => ({ ...prev, [cacheKey]: data }))
    } catch (e) {
      setError(e.message)
    }
  }, [weekStartStr, studentId, student])

  const handleSaveMoveBreak = async () => {
    if (!moveBreakModal) return
    const { preset_id, teacher_name, weekday, start_time } = moveBreakModal
    const st = String(start_time || '').slice(0, 5)
    const et = endTimeOneHourAfterStart(st)
    if (!/^\d{2}:\d{2}$/.test(st) || !et) {
      setError('Start time must be HH:MM.')
      return
    }
    setMoveBreakSaving(true)
    setError(null)
    try {
      await api.updateTeacherBreakPreset(preset_id, {
        teacher_name: String(teacher_name || '').trim(),
        weekday: Number(weekday),
        start_time: st,
        end_time: et,
        active: true,
      })
      success('Break preset updated')
      setMoveBreakModal(null)
      await refetchWeekSchedule()
    } catch (e) {
      setError(e?.message || 'Failed to update break preset')
    } finally {
      setMoveBreakSaving(false)
    }
  }

  const studentName = student?.Name || student?.name || 'Student'
  const studentKanji = student?.['漢字'] || student?.name_kanji || ''

  /** Show full overlay only on first modal load; week navigation stays non-blocking. */
  const modalBusy = loading && !hasLoadedWeekOnce

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
              {rescheduleSource && (
                <p className="text-[11px] text-amber-700 mt-1">
                  Reschedule mode: pick one new slot to move this lesson.
                </p>
              )}
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
            {String(student?.Payment || student?.payment || '')
              .toLowerCase()
              .includes('owner') && (
              <p className="mb-2 text-[11px] text-rose-800/90 leading-snug">
                Owner&apos;s course: only book hours when your course teacher is on shift for that slot.
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
                <div
                  className="flex-shrink-0 grid bg-green-600 text-white shadow-md z-10"
                  style={{ gridTemplateColumns: `3.5rem repeat(${weekDates.length}, minmax(0, 1fr))` }}
                >
                  <div className="px-3 py-2.5 text-sm font-semibold text-center">
                    Time
                  </div>
                  {weekDates.map((dateStr) => (
                    <div key={dateStr} className="min-w-0 px-3 py-2.5 text-sm font-semibold text-center">
                      <div>{DAY_LABELS[getJstDayIndex(dateStr)]}</div>
                      <div className="text-xs font-normal text-white/90 mt-0.5">{dateStr.slice(8)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-0.5">
                  <div
                    className="booking-week-grid grid w-full min-w-0"
                    style={{
                      gridTemplateColumns: `3.5rem repeat(${weekDates.length}, minmax(0, 1fr))`,
                      gridAutoRows: 'minmax(56px, auto)',
                    }}
                  >
                    {TIME_SLOTS.map((timeStr) => (
                      <React.Fragment key={timeStr}>
                        <div className="px-3 py-1 flex items-center justify-center text-xs font-medium text-black bg-gray-50 border-t border-dashed border-gray-400/85 border-b border-gray-100 min-h-0 min-w-0">
                          {timeStr}
                        </div>
                        {weekDates.map((dateStr) => {
                          const key = `${dateStr}T${timeStr}`
                          const booked = slots[key] || 0
                          const teachers = teachersBySlot[key] || []
                          const capacity = teachers.length
                          const slotType = slotTypes[key]
                          const mix = slotMix[key]
                          const mixBlocked = isKidAdultMixBlocked(student, mix)
                          const breakBlocked = !!breakRuleBlocked[key]
                          const shamBlocked = !!ownerShamBlocked[key]
                          const alreadyYours = !!studentBookedSlots[key]
                          const isSelected = selectedSlotKeys.includes(key)
                          const isPast = isSlotPastJst(dateStr, timeStr)
                          const isFull = capacity > 0 && booked >= capacity
                          const staffBreaks = staffBreakBySlot[key] || []
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
                          const shamLabel =
                            shamBlocked && !isPast && capacity > 0 && !isFull && !alreadyYours && !mixBlocked && !breakBlocked
                              ? 'Sham only'
                              : null
                          const label = alreadyYours
                            ? 'Yours'
                            : isSelected
                              ? 'Selected'
                            : mixLabel
                              ? mixLabel
                              : breakLabel
                                ? breakLabel
                                : shamLabel
                                  ? shamLabel
                                : isPast
                                  ? 'Finished'
                                  : capacity === 0
                                    ? '—'
                                    : `${booked} / ${capacity} slots`
                          const bookingUnavailable =
                            isPast ||
                            capacity === 0 ||
                            isFull ||
                            mixBlocked ||
                            alreadyYours ||
                            breakBlocked ||
                            shamBlocked
                          const slotTypeLabel =
                            slotType === 'kids' ? '子'
                              : slotType === 'adult' ? 'Adult'
                                : slotType === 'mixed' ? '子+Adult'
                                  : null
                          const primaryLabel = isSelected ? 'Selected' : label
                          const showStrike = bookingUnavailable && !isSelected
                          return (
                            <div
                              key={key}
                              className="isolate min-h-0 min-w-0 overflow-hidden flex flex-col gap-0.5 border-t border-dashed border-gray-400/85 border-b border-gray-100 py-1 px-0.5"
                            >
                              <button
                                type="button"
                                disabled={
                                  !isSelected && (
                                    isPast ||
                                    capacity === 0 ||
                                    isFull ||
                                    mixBlocked ||
                                    alreadyYours ||
                                    breakBlocked ||
                                    shamBlocked
                                  )
                                }
                                onClick={() => handleSlotClick(dateStr, timeStr)}
                                className={`booking-slot-btn flex-1 min-h-0 min-w-0 w-full px-2 rounded-sm transition-colors ${
                                  isSelected
                                    ? 'bg-green-100 text-green-900 ring-2 ring-green-500 ring-inset cursor-pointer'
                                    : bookingUnavailable
                                      ? isFull
                                        ? 'bg-[#525557] text-white cursor-default'
                                        : 'bg-[#525557] text-white cursor-not-allowed'
                                      : 'bg-white hover:bg-green-50 text-green-700 hover:text-green-800 hover:ring-2 hover:ring-green-500 hover:ring-inset cursor-pointer'
                                }`}
                              >
                                <div className="booking-slot-row-primary">
                                  <span className={`booking-slot-primary ${showStrike ? 'line-through' : ''}`}>
                                    {primaryLabel}
                                  </span>
                                </div>
                                <span
                                  className={`booking-slot-meta ${
                                    isSelected
                                      ? 'text-green-800'
                                      : bookingUnavailable
                                        ? 'text-white/80'
                                        : 'text-green-600'
                                  }`}
                                >
                                  {slotTypeLabel ?? '—'}
                                </span>
                              </button>
                              {staffBreaks.length > 0 && (
                                <div className="flex flex-col gap-px shrink-0 w-full min-w-0">
                                  {staffBreaks.map((b, bi) => {
                                    const label = formatBreakChipLabel(b)
                                    const isPreset =
                                      b.preset_id != null && Number.isFinite(Number(b.preset_id))
                                    if (canEditBreakPresets && isPreset) {
                                      return (
                                        <button
                                          key={`preset-${b.preset_id}-${bi}`}
                                          type="button"
                                          className="booking-slot-break-chip rounded border border-slate-200/70 bg-slate-50/95 px-1 py-px text-center text-[8px] font-medium leading-tight text-slate-700 hover:bg-slate-100 cursor-pointer select-none w-full"
                                          title="Move recurring break preset"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setMoveBreakModal({
                                              preset_id: Number(b.preset_id),
                                              teacher_name: b.teacher_name,
                                              weekday: Number(b.preset_weekday),
                                              start_time: String(b.preset_start_time || '').slice(0, 5),
                                              end_time: String(b.preset_end_time || '').slice(0, 5),
                                            })
                                          }}
                                        >
                                          {label}
                                        </button>
                                      )
                                    }
                                    return (
                                      <div
                                        key={`${b.teacher_name}-${bi}-${b.break_source || 'x'}`}
                                        className="booking-slot-break-chip rounded border border-slate-200/70 bg-slate-50/95 px-1 py-px text-center text-[8px] font-medium leading-tight text-slate-600 pointer-events-none select-none"
                                        title={
                                          b.break_source === 'schedule'
                                            ? 'Calendar break (edit in Google Calendar)'
                                            : b.title || undefined
                                        }
                                      >
                                        {label}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
            </div>
          </div>

          <footer className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleSubmitSelected}
              disabled={submitting || selectedSlotKeys.length === 0}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting
                ? 'Submitting...'
                : rescheduleSource
                  ? 'Confirm reschedule'
                  : `Submit selected (${selectedSlotKeys.length})`}
            </button>
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
      {packTotalPromptOpen && (
        <PreBookLessonModal
          overlayClassName="z-[10002]"
          description="No monthly lesson total was found from payments for this flow. Enter 月の回数 (lessons in the pack) so bookings can be labeled in the calendar."
          onClose={() => setPackTotalPromptOpen(false)}
          onConfirm={async (n) => {
            setLocalPackOverride(n)
            setPackTotalPromptOpen(false)
            const pr = derivePackTotalForBooking(
              effectiveLatest,
              overridePaidLessons,
              n,
              selectedSlotKeys,
              student
            )
            if (pr.mode === 'none') return
            const over = checkOverQuotaForSelection(selectedSlotKeys, effectiveLatest, student)
            if (over) {
              setOverQuotaState(over)
              setOverQuotaConfirmOpen(true)
              return
            }
            await submitBookingsWithPackResult(pr)
          }}
        />
      )}
      {overQuotaConfirmOpen && overQuotaState && (
        <ConfirmActionModal
          title="月の回数を超える予約"
          message={`${overQuotaState.label}: 既存 ${overQuotaState.active} 件 + 今回 ${overQuotaState.adding} 件で、月の回数（${overQuotaState.paid}）を超えます。\n\n月の回数が超えています。ご希望の回数に変更してください。`}
          confirmLabel="回数を変更"
          onClose={() => {
            setOverQuotaConfirmOpen(false)
            setOverQuotaState(null)
            setPendingOverQuotaSlotKey(null)
          }}
          onConfirm={() => {
            setOverQuotaConfirmOpen(false)
            setOverQuotaEditOpen(true)
          }}
        />
      )}
      {overQuotaEditOpen && overQuotaState && (
        <PreBookLessonModal
          key={overQuotaState.ym}
          overlayClassName="z-[10003]"
          initialPackTotal={overQuotaState.minPack}
          description={`${overQuotaState.label} の月の回数を ${overQuotaState.minPack} 以上に設定します。保存すると既存レッスンのタイトル（i/N）をこの回数に合わせて更新し、続けて予約します。`}
          confirmLabel="Save"
          onClose={() => {
            setOverQuotaEditOpen(false)
            setOverQuotaState(null)
            setPendingOverQuotaSlotKey(null)
          }}
          onConfirm={async (n) => {
            const sidRaw = resolveBookStudentId(studentId, student)
            if (sidRaw == null) return
            const numericId = Number(sidRaw)
            const student_id = Number.isFinite(numericId) ? numericId : sidRaw
            setError(null)
            try {
              await api.renumberMonthLessonTitles({
                student_id,
                month: overQuotaState.ym,
                pack_total: n,
              })
              const fresh = await api.getStudentLatestByMonth(student_id)
              setLatestByMonthLocal(fresh.latestByMonth ?? null)
              setLessonMonthSummaries(selectVisibleLessonMonthSummaries(fresh.latestByMonth))
              setOverQuotaEditOpen(false)
              setOverQuotaState(null)
              setLocalPackOverride(n)
              const pr = derivePackTotalForBooking(
                fresh.latestByMonth,
                overridePaidLessons,
                n,
                pendingOverQuotaSlotKey && !selectedSlotKeys.includes(pendingOverQuotaSlotKey)
                  ? [...selectedSlotKeys, pendingOverQuotaSlotKey]
                  : selectedSlotKeys,
                student
              )
              if (pr.mode === 'none') {
                setError('月の回数を保存しましたが、予約に必要なデータがまだありません。')
                return
              }
              const selectedAfterUpdate =
                pendingOverQuotaSlotKey && !selectedSlotKeys.includes(pendingOverQuotaSlotKey)
                  ? [...selectedSlotKeys, pendingOverQuotaSlotKey]
                  : selectedSlotKeys
              const over2 = checkOverQuotaForSelection(selectedAfterUpdate, fresh.latestByMonth, student)
              if (over2) {
                setOverQuotaState(over2)
                setOverQuotaConfirmOpen(true)
                return
              }
              setPendingOverQuotaSlotKey(null)
              setSelectedSlotKeys(selectedAfterUpdate)
              await submitBookingsWithPackResult(pr, selectedAfterUpdate)
            } catch (e) {
              setError(e?.message || 'Failed to update monthly pack')
            }
          }}
        />
      )}
      {successModal && (
        <ConfirmActionModal
          title={successModal.title}
          message={successModal.message}
          confirmLabel="OK"
          onClose={() => {
            setSuccessModal(null)
            onClose?.()
          }}
          onConfirm={() => {
            setSuccessModal(null)
            onClose?.()
          }}
        />
      )}
      {extendShiftOpen && (
        <ExtendShiftModal onClose={() => setExtendShiftOpen(false)} />
      )}
      {moveBreakModal && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="moveBreakTitle">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !moveBreakSaving && setMoveBreakModal(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl ring-1 ring-black/5 p-5">
            <h4 id="moveBreakTitle" className="text-base font-semibold text-gray-900">
              Move Break
            </h4>
            <p className="text-sm text-gray-800 mt-1 mb-4 font-medium">{moveBreakModal.teacher_name}</p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Start (1 hour)</span>
                <input
                  type="time"
                  className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                  value={moveBreakModal.start_time}
                  disabled={moveBreakSaving}
                  onChange={(e) =>
                    setMoveBreakModal((prev) =>
                      prev ? { ...prev, start_time: e.target.value.slice(0, 5) } : prev
                    )
                  }
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                disabled={moveBreakSaving}
                onClick={() => setMoveBreakModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                disabled={moveBreakSaving}
                onClick={handleSaveMoveBreak}
              >
                {moveBreakSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
