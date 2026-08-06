import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Calendar } from 'lucide-react'
import { api } from '../api'
import { useCalendarPollingContext } from '../context/CalendarPollingContext'
import LessonDetailsModal from './LessonDetailsModal'
import ConfirmActionModal from './ConfirmActionModal'
import PreBookLessonModal from './PreBookLessonModal'
import RescheduleChoiceModal from './RescheduleChoiceModal'
import { useToast } from '../context/ToastContext'
import { addOneMonthYyyyMm, getCurrentYyyyMmJst } from '../utils/jstMonth'
import { studentIsDemo } from '../config/booking'
import { BOOKING_WIP_DISABLED, RESERVED_CONFIRM_WIP_DISABLED } from '../guides/wipFlags'

const DOW = ['日', '月', '火', '水', '木', '金', '土']

const CARD_STYLES = {
  scheduled: { accent: 'bg-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-600', hoverRing: 'hover:ring-emerald-500/60', label: 'Scheduled' },
  /** Calendar placeholder / yellow hold slots (see GAS MonthlyCache). */
  reserved: {
    accent: 'bg-cyan-600',
    bg: 'bg-cyan-50',
    dot: 'bg-cyan-600',
    hoverRing: 'hover:ring-cyan-500/60',
    label: 'Reserved',
  },
  calendar_pending: {
    accent: 'bg-sky-600',
    bg: 'bg-sky-50',
    dot: 'bg-sky-600',
    hoverRing: 'hover:ring-sky-500/60',
    label: 'Pending',
  },
  confirm_processing: {
    accent: 'bg-violet-600',
    bg: 'bg-violet-50',
    dot: 'bg-violet-600',
    hoverRing: 'hover:ring-violet-500/60',
    label: 'Processing',
  },
  cancelled: { accent: 'bg-slate-500', bg: 'bg-slate-50', dot: 'bg-slate-500', hoverRing: 'hover:ring-slate-500/60', label: 'Cancelled' },
  reschedule_date_tbd: {
    accent: 'bg-orange-500',
    bg: 'bg-orange-50',
    dot: 'bg-orange-500',
    hoverRing: 'hover:ring-orange-500/60',
    label: 'Date TBD',
  },
  rescheduled: { accent: 'bg-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-600', hoverRing: 'hover:ring-amber-500/60', label: 'Rescheduled' },
  demo: { accent: 'bg-violet-600', bg: 'bg-violet-50', dot: 'bg-violet-600', hoverRing: 'hover:ring-violet-500/60', label: 'Demo' },
  unscheduled: { accent: 'bg-rose-600', bg: 'bg-rose-50', dot: 'bg-rose-600', hoverRing: 'hover:ring-rose-500/60', label: 'Unscheduled' },
  deleting: { accent: 'bg-slate-700', bg: 'bg-slate-100', dot: 'bg-slate-700', hoverRing: 'hover:ring-slate-600/60', label: 'Deleting...' },
  sync_pending: { accent: 'bg-indigo-600', bg: 'bg-indigo-50', dot: 'bg-indigo-600', hoverRing: 'hover:ring-indigo-500/60', label: 'Syncing' },
  sync_failed: { accent: 'bg-red-600', bg: 'bg-red-50', dot: 'bg-red-600', hoverRing: 'hover:ring-red-500/60', label: 'Sync failed' },
}

const CARD_SIZES = {
  compact: { date: 'text-[0.7rem]', dow: 'text-[0.6rem]', time: 'text-[0.65rem]', status: 'text-[0.6rem]', dot: 'h-1 w-1', pad: 'px-1.5 py-0.5', accent: 'w-1' },
  normal: { date: 'text-[0.75rem]', dow: 'text-[0.65rem]', time: 'text-[0.7rem]', status: 'text-[0.65rem]', dot: 'h-1.5 w-1.5', pad: 'px-2 py-1', accent: 'w-1' },
  large: { date: 'text-[0.8rem]', dow: 'text-[0.7rem]', time: 'text-[0.75rem]', status: 'text-[0.7rem]', dot: 'h-2 w-2', pad: 'px-2 py-1.5', accent: 'w-1.5' },
}

function getLessonDisplayStatus(lesson) {
  const transientStatus = String(lesson?.transientStatus || '').toLowerCase()
  const rawStatus = String(lesson?.status || '').toLowerCase()
  const syncStatus = String(lesson?.calendarSyncStatus || 'synced').toLowerCase()
  const isDemoLesson = String(lesson?.lessonKind || '').toLowerCase() === 'demo'

  if (transientStatus === 'deleting') return 'deleting'
  if (transientStatus === 'sync_failed') return 'sync_failed'
  if (transientStatus === 'rescheduled') return 'rescheduled'
  if (transientStatus === 'confirm_processing') return 'confirm_processing'
  if (transientStatus === 'sync_pending') return 'sync_pending'
  if (rawStatus === 'unscheduled') return 'unscheduled'
  if ((rawStatus === 'rescheduled' || rawStatus === 'cancelled') && lesson?.awaitingRescheduleDate) return 'reschedule_date_tbd'
  if (lesson?.optimisticRescheduledTo || lesson?.rescheduledTo) return 'rescheduled'
  if (rawStatus === 'rescheduled') return 'rescheduled'
  if (rawStatus === 'cancelled') return 'cancelled'
  if (syncStatus === 'failed') return 'sync_failed'
  if (syncStatus === 'pending' && (rawStatus === 'scheduled' || rawStatus === 'reserved')) return 'calendar_pending'
  if (isDemoLesson) return 'demo'
  if (rawStatus === 'reserved') return 'reserved'
  return rawStatus || 'scheduled'
}

function stripMonthlyEventIdBase(eventId) {
  return String(eventId || '')
    .trim()
    .replace(/_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/, '')
}

/** Same reserved recurring hold as anchor (matches server confirm-reserved batch). */
function listReservedBatchEventIds(monthData, monthKey, anchorLesson) {
  const anchorId = String(anchorLesson?.eventID || '').trim()
  if (!anchorId || !monthKey || !monthData?.[monthKey]) return anchorId ? [anchorId] : []
  const idBase = stripMonthlyEventIdBase(anchorId)
  const byEvent = new Map()
  for (const lesson of monthData[monthKey].lessons || []) {
    if (String(lesson?.status || '').toLowerCase() !== 'reserved') continue
    const eid = String(lesson?.eventID || '').trim()
    if (!eid || stripMonthlyEventIdBase(eid) !== idBase) continue
    if (!byEvent.has(eid)) byEvent.set(eid, lesson)
  }
  return [...byEvent.values()]
    .sort((a, b) => {
      const aDay = parseInt(a?.day, 10) || 999
      const bDay = parseInt(b?.day, 10) || 999
      if (aDay !== bDay) return aDay - bDay
      return String(a?.time || '99:99').localeCompare(String(b?.time || '99:99'))
    })
    .map((l) => String(l.eventID || '').trim())
    .filter(Boolean)
}

function sortLessonsForDisplay(lessons) {
  return [...(lessons || [])].sort((a, b) => {
    const aUnscheduled = String(a?.status || '').toLowerCase() === 'unscheduled'
    const bUnscheduled = String(b?.status || '').toLowerCase() === 'unscheduled'
    if (aUnscheduled && !bUnscheduled) return 1
    if (!aUnscheduled && bUnscheduled) return -1
    const aDay = aUnscheduled ? 999 : parseInt(a?.day, 10) || 999
    const bDay = bUnscheduled ? 999 : parseInt(b?.day, 10) || 999
    if (aDay !== bDay) return aDay - bDay
    const aTime = String(a?.time || '99:99')
    const bTime = String(b?.time || '99:99')
    return aTime.localeCompare(bTime)
  })
}

function buildDefaultMonthEntry(monthKey) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/)
  const year = m ? parseInt(m[1], 10) : new Date().getFullYear()
  const monthIndex = m ? parseInt(m[2], 10) - 1 : new Date().getMonth()
  return {
    Payment: '未',
    lessons: [],
    missingCount: 0,
    paidLessonsCount: 0,
    bookedLessonsCount: 0,
    year,
    monthIndex,
    label: monthKey,
  }
}

function ensureMonthEntry(data, monthKey) {
  return data?.[monthKey] || buildDefaultMonthEntry(monthKey)
}

function findLessonMonthKey(monthDataObj, eventID) {
  if (!monthDataObj || !eventID) return null
  for (const key of Object.keys(monthDataObj)) {
    if ((monthDataObj[key]?.lessons || []).some((l) => l.eventID === eventID)) return key
  }
  return null
}

function getLessonIdentityKey(lesson) {
  const lessonUUID = String(lesson?.lessonUUID || '').trim()
  if (lessonUUID) return `uuid:${lessonUUID}`
  const eventID = String(lesson?.eventID || '').trim()
  return eventID ? `event:${eventID}` : ''
}

function hasRealLessonAtDateTime(monthDataObj, monthKey, date, time, optimisticEventID = '') {
  if (!monthDataObj || !monthKey || !date || !time) return false
  const day = String(date).slice(8, 10)
  return (monthDataObj[monthKey]?.lessons || []).some((lesson) => {
    const eventID = String(lesson?.eventID || '')
    if (!eventID || eventID === optimisticEventID) return false
    if (eventID.startsWith('optimistic-')) return false
    return String(lesson?.day || '').padStart(2, '0') === day && String(lesson?.time || '') === time
  })
}

function findRealLessonAtDateTime(monthDataObj, monthKey, date, time) {
  if (!monthDataObj || !monthKey || !date || !time) return null
  const day = String(date).slice(8, 10)
  return (
    (monthDataObj[monthKey]?.lessons || []).find((lesson) => {
      const eventID = String(lesson?.eventID || '')
      if (!eventID || eventID.startsWith('optimistic-')) return false
      return String(lesson?.day || '').padStart(2, '0') === day && String(lesson?.time || '') === time
    }) || null
  )
}

function isLessonCalendarSyncPending(lesson) {
  return String(lesson?.calendarSyncStatus || '').toLowerCase() === 'pending'
}

/** Drop temp optimistic rows at a slot when the server already has a real lesson there. */
function removeOptimisticLessonsAtSlot(data, monthKey, date, time) {
  if (!data || !monthKey || !date || !time) return data
  if (!hasRealLessonAtDateTime(data, monthKey, date, time)) return data
  return clearLessonsAtSlot(data, monthKey, date, time, { onlyOptimistic: true })
}

/** Remove lessons occupying a slot (e.g. before inserting a new optimistic reschedule target). */
function clearLessonsAtSlot(data, monthKey, date, time, { onlyOptimistic = false, keepEventID = '' } = {}) {
  if (!data || !monthKey || !date || !time) return data
  const day = String(date).slice(8, 10)
  return withPatchedMonth(data, monthKey, (entry) => ({
    ...entry,
    lessons: sortLessonsForDisplay(
      (entry.lessons || []).filter((lesson) => {
        const eventID = String(lesson?.eventID || '')
        if (keepEventID && eventID === keepEventID) return true
        const sameSlot =
          String(lesson?.day || '').padStart(2, '0') === day && String(lesson?.time || '') === time
        if (!sameSlot) return true
        if (onlyOptimistic) return !eventID.startsWith('optimistic-')
        return false
      })
    ),
  }))
}

function stripOptimisticDuplicatesFromMonthData(data) {
  if (!data) return data
  let next = data
  for (const monthKey of Object.keys(next)) {
    for (const lesson of next[monthKey]?.lessons || []) {
      const eventID = String(lesson?.eventID || '')
      if (!eventID.startsWith('optimistic-')) continue
      const yyyyMm = monthKey
      const day = String(lesson?.day || '').padStart(2, '0')
      const time = String(lesson?.time || '')
      if (!day || day === '--' || !time || time === '--') continue
      const date = `${yyyyMm}-${day}`
      next = removeOptimisticLessonsAtSlot(next, monthKey, date, time)
    }
  }
  return next
}

function buildOptimisticUnscheduled(monthKey, seed = Date.now()) {
  return {
    day: '--',
    time: '--',
    status: 'unscheduled',
    eventID: `unscheduled-optimistic-${monthKey}-${seed}`,
    isGroup: false,
    lessonKind: 'regular',
  }
}

function withPatchedMonth(data, monthKey, patcher) {
  const next = { ...(data || {}) }
  const entry = ensureMonthEntry(next, monthKey)
  next[monthKey] = patcher({
    ...entry,
    lessons: sortLessonsForDisplay(entry.lessons || []),
  })
  return next
}

function applyLessonPatch(data, eventID, patcher) {
  if (!data || !eventID) return data
  const monthKey = findLessonMonthKey(data, eventID)
  if (!monthKey) return data
  return withPatchedMonth(data, monthKey, (entry) => ({
    ...entry,
    lessons: sortLessonsForDisplay(
      (entry.lessons || []).map((lesson) =>
        lesson.eventID === eventID ? patcher(lesson) : lesson
      )
    ),
  }))
}

function insertLessonIntoMonth(data, monthKey, lesson, opts = {}) {
  const replacePlaceholder = opts.replacePlaceholder !== false
  return withPatchedMonth(data, monthKey, (entry) => {
    let lessons = [...(entry.lessons || [])].filter((l) => l.eventID !== lesson.eventID)
    if (replacePlaceholder) {
      const unscheduledIdx = lessons.findIndex((l) => String(l.status || '').toLowerCase() === 'unscheduled')
      if (unscheduledIdx >= 0) lessons.splice(unscheduledIdx, 1)
    }
    lessons.push(lesson)
    return {
      ...entry,
      lessons: sortLessonsForDisplay(lessons),
    }
  })
}

function replaceLessonWithUnscheduled(data, eventID) {
  if (!data || !eventID) return data
  const monthKey = findLessonMonthKey(data, eventID)
  if (!monthKey) return data
  return withPatchedMonth(data, monthKey, (entry) => {
    const lessons = (entry.lessons || []).filter((l) => l.eventID !== eventID)
    lessons.push(buildOptimisticUnscheduled(monthKey))
    return {
      ...entry,
      lessons: sortLessonsForDisplay(lessons),
    }
  })
}

function applyOptimisticMutationToMonthData(prevData, mutation) {
  if (!prevData || !mutation) return prevData
  switch (mutation.type) {
    case 'book_start':
      if (
        hasRealLessonAtDateTime(
          prevData,
          mutation.monthKey,
          mutation.date,
          mutation.time,
          mutation.lesson?.eventID
        )
      ) {
        return prevData
      }
      return insertLessonIntoMonth(prevData, mutation.monthKey, mutation.lesson, { replacePlaceholder: true })
    case 'book_failed':
      return applyLessonPatch(prevData, mutation.eventID, (lesson) => ({
        ...lesson,
        transientStatus: 'sync_failed',
        calendarSyncStatus: 'failed',
        calendarSyncError: mutation.error || lesson.calendarSyncError || 'Failed to book',
      }))
    case 'reschedule_start': {
      let next = applyLessonPatch(prevData, mutation.sourceEventID, (lesson) => ({
        ...lesson,
        transientStatus: 'rescheduled',
        awaitingRescheduleDate: false,
        optimisticRescheduledTo: {
          date: mutation.targetDate || null,
          time: mutation.targetTime || null,
        },
        calendarSyncError: null,
      }))
      next = clearLessonsAtSlot(next, mutation.targetMonthKey, mutation.targetDate, mutation.targetTime, {
        onlyOptimistic: true,
        keepEventID: mutation.targetLesson?.eventID || '',
      })
      if (
        !hasRealLessonAtDateTime(
          next,
          mutation.targetMonthKey,
          mutation.targetDate,
          mutation.targetTime,
          mutation.targetLesson?.eventID
        )
      ) {
        next = insertLessonIntoMonth(next, mutation.targetMonthKey, mutation.targetLesson, { replacePlaceholder: true })
      }
      return next
    }
    case 'reschedule_failed': {
      let next = applyLessonPatch(prevData, mutation.sourceEventID, (lesson) => ({
        ...lesson,
        transientStatus: undefined,
        optimisticRescheduledTo: undefined,
      }))
      next = applyLessonPatch(next, mutation.targetEventID, (lesson) => ({
        ...lesson,
        transientStatus: 'sync_failed',
        calendarSyncStatus: 'failed',
        calendarSyncError: mutation.error || lesson.calendarSyncError || 'Failed to reschedule lesson',
      }))
      return next
    }
    case 'patch_lesson':
      return applyLessonPatch(prevData, mutation.eventID, (lesson) => ({
        ...lesson,
        ...(mutation.patch || {}),
      }))
    case 'replace_with_unscheduled':
      return replaceLessonWithUnscheduled(prevData, mutation.eventID)
    default:
      return prevData
  }
}

function isOptimisticMutationResolved(serverData, mutation) {
  if (!serverData || !mutation) return false
  switch (mutation.type) {
    case 'book_start': {
      const realLesson = findRealLessonAtDateTime(
        serverData,
        mutation.monthKey,
        mutation.date,
        mutation.time
      )
      if (!realLesson) return false
      return !isLessonCalendarSyncPending(realLesson)
    }
    case 'reschedule_start': {
      const sourceMonthKey = findLessonMonthKey(serverData, mutation.sourceEventID)
      const sourceLesson = sourceMonthKey
        ? (serverData[sourceMonthKey]?.lessons || []).find((l) => l.eventID === mutation.sourceEventID)
        : null
      const sourceRescheduled =
        !!sourceLesson?.rescheduledTo ||
        String(sourceLesson?.status || '').toLowerCase() === 'rescheduled'
      if (!sourceRescheduled) return false
      const targetLesson = findRealLessonAtDateTime(
        serverData,
        mutation.targetMonthKey,
        mutation.targetDate,
        mutation.targetTime
      )
      if (!targetLesson) return false
      return !isLessonCalendarSyncPending(targetLesson)
    }
    case 'patch_lesson': {
      const monthKey = findLessonMonthKey(serverData, mutation.eventID)
      const serverLesson = monthKey
        ? (serverData[monthKey]?.lessons || []).find((l) => l.eventID === mutation.eventID)
        : null
      // Keep transient labels visible until remove / confirm flow finishes.
      if (mutation.patch?.transientStatus === 'deleting') return false
      if (mutation.patch?.transientStatus === 'confirm_processing') return false
      if (!serverLesson) return mutation.patch?.status === 'unscheduled'
      return Object.entries(mutation.patch || {}).every(([key, value]) => {
        if (key === 'transientStatus' || key === 'optimisticRescheduledTo' || key === 'transientError') return true
        return serverLesson?.[key] === value
      })
    }
    case 'replace_with_unscheduled':
      return !findLessonMonthKey(serverData, mutation.eventID)
    default:
      return false
  }
}


function LessonCard({ lesson, year, monthIndex, onClick, size = 'normal' }) {
  const displayStatus = getLessonDisplayStatus(lesson)
  const isUnscheduled = lesson.status === 'unscheduled'
  const dayNum = parseInt(lesson.day, 10)
  const date = !isNaN(dayNum) && year != null && monthIndex >= 0
    ? new Date(year, monthIndex, dayNum)
    : null
  const dow = date && !isNaN(date.getTime()) ? DOW[date.getDay()] : ''
  const dayStr = isUnscheduled ? '--' : (lesson.day && lesson.day !== '--' ? `${parseInt(lesson.day)}日` : '--')
  const timeStr = isUnscheduled ? '--' : (lesson.time ? lesson.time.replace(':', '：') : '--')
  const styles = CARD_STYLES[displayStatus] || CARD_STYLES.scheduled
  const title = styles.label || (displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1))
  const sz = CARD_SIZES[size] || CARD_SIZES.normal
  const hasNote = !!lesson?.hasNote

  return (
    <button
      type="button"
      onClick={() => onClick?.(lesson)}
      className={`lr-card group relative inline-flex items-center gap-1 rounded-lg border border-gray-200 ${styles.bg} ${sz.pad} w-full h-full min-h-0 max-h-[108px] text-left shadow-sm hover:shadow-md transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-0 focus-visible:ring-0 ${styles.hoverRing} cursor-pointer overflow-hidden ${hasNote ? 'ring-2 ring-red-400' : ''}`}
      data-status={displayStatus}
      aria-label={`Lesson ${dayStr} ${timeStr} (${title})`}
    >
      <span className={`absolute left-0 top-0 h-full ${sz.accent} rounded-l-lg ${styles.accent}`} />
      {hasNote && (
        <span className="absolute top-1.5 right-1.5 inline-grid h-5 w-5 place-items-center rounded-full border border-red-500 bg-red-100 text-[11px] font-bold text-red-800 shadow-sm">
          <span className="block leading-[1]">!</span>
        </span>
      )}
      <span className="flex-1 min-w-0 overflow-hidden py-0.5">
        <span className={`block lr-date ${sz.date} font-semibold leading-tight truncate`}>
          {dayStr}
          {dow && <span className={`lr-dow ${sz.dow} font-semibold text-gray-500 ml-1`}>{dow}</span>}
        </span>
        <span className={`block lr-time ${sz.time} leading-tight text-gray-500 tabular-nums truncate`}>{timeStr}</span>
        <span className={`lr-status inline-flex items-center ${sz.status} text-gray-500 mt-0.5 truncate gap-1`}>
          <span className={`mr-0.5 ${sz.dot} rounded-full shrink-0 ${styles.dot}`} />
          {title}
        </span>
      </span>
    </button>
  )
}

const PENDING_SYNC_POLL_MS = 2000
const PENDING_SYNC_POLL_FAST_MS = 500
const PENDING_SYNC_POLL_FAST_TICKS = 60
const PENDING_SYNC_POLL_MAX = 120

function normalizePendingEventIds(ids) {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}

function lessonMatchesPendingEventId(lesson, pendingIds) {
  if (!lesson || pendingIds.length === 0) return false
  const eventID = String(lesson?.eventID || '').trim()
  if (!eventID) return false
  if (pendingIds.includes(eventID)) return true
  const base = eventID.replace(/_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/i, '')
  return pendingIds.some((id) => id.replace(/_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/i, '') === base)
}

function monthDataHasPendingCalendarSync(monthDataObj) {
  if (!monthDataObj) return false
  return Object.values(monthDataObj).some((m) =>
    (m?.lessons || []).some((l) => isLessonCalendarSyncPending(l))
  )
}

/**
 * @param {unknown} refreshTrigger - e.g. calendar poll `lastSynced`; changes trigger a normal refetch.
 * @param {number} [scheduleRefreshKey] - increment (e.g. after booking) to refetch schedule without waiting on poll.
 */
function useLatestByMonth(studentId, refreshTrigger, scheduleRefreshKey = 0) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeMonth, setActiveMonth] = useState(null)

  const fetchData = useCallback((opts = {}) => {
    const silent = !!opts.silent
    if (studentId == null) return Promise.resolve()
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    return api
      .getStudentLatestByMonth(studentId)
      .then((res) => {
        const latest = res.latestByMonth || {}
        const thisYyyyMm = getCurrentYyyyMmJst()
        const nextYyyyMm = addOneMonthYyyyMm(thisYyyyMm)
        const ordered = [thisYyyyMm, nextYyyyMm].filter((k) => k && k in latest)
        const filtered = Object.fromEntries(ordered.map((k) => [k, latest[k]]))
        setData(filtered)
        setActiveMonth((prev) => (prev == null ? thisYyyyMm : prev))
      })
      .catch((e) => {
        if (!silent) setError(e.message)
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [studentId])

  useEffect(() => {
    if (studentId == null) return
    fetchData({ silent: false })
  }, [studentId, refreshTrigger, fetchData])

  useEffect(() => {
    if (studentId == null || !scheduleRefreshKey) return
    fetchData({ silent: true })
  }, [scheduleRefreshKey, studentId, fetchData])

  return {
    data,
    setData,
    loading,
    error,
    activeMonth,
    setActiveMonth,
    refetch: () => fetchData({ silent: false }),
    refetchSilent: () => fetchData({ silent: true }),
  }
}

function findLessonInMonthData(monthDataObj, eventID) {
  if (!monthDataObj || !eventID) return null
  for (const key of Object.keys(monthDataObj)) {
    const lessons = monthDataObj[key]?.lessons || []
    const found = lessons.find((l) => l.eventID === eventID || l.lessonUUID === eventID)
    if (found) return found
  }
  return null
}

export default function LessonsThisMonth({
  studentId,
  student,
  onBookLesson,
  sectionClassName,
  onLoadingChange,
  onMonthLessonsUpdated,
  /** Called after lesson notes are saved/removed so parents (e.g. Dashboard) can refetch server truth. */
  onLessonNotesChanged,
  optimisticScheduleMutations = [],
  scheduleRefreshKey = 0,
  pendingCalendarEventIds = [],
  onPendingCalendarEventIdsChange,
}) {
  const { success } = useToast()
  const { lastSynced } = useCalendarPollingContext()
  const { data: serverData, setData, loading, error, activeMonth, setActiveMonth, refetch, refetchSilent } = useLatestByMonth(
    studentId,
    lastSynced,
    scheduleRefreshKey
  )
  const pendingPollCountRef = useRef(0)
  const pendingPollFastTicksRef = useRef(0)
  const processedOptimisticMutationCountRef = useRef(0)
  const unscheduledRemoveQueueRef = useRef(Promise.resolve())
  const normalizedPendingEventIds = useMemo(
    () => normalizePendingEventIds(pendingCalendarEventIds),
    [pendingCalendarEventIds]
  )
  const pendingEventIdsKey = normalizedPendingEventIds.join('|')
  const [activeOptimisticMutations, setActiveOptimisticMutations] = useState([])

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])
  const [selectedLesson, setSelectedLesson] = useState(null)
  const [confirmingSchedule, setConfirmingSchedule] = useState(false)
  const applyOptimisticMutation = useCallback((mutation) => {
    setActiveOptimisticMutations((prev) => [...prev, mutation])
  }, [])

  useEffect(() => {
    processedOptimisticMutationCountRef.current = 0
    setActiveOptimisticMutations([])
  }, [studentId])

  useEffect(() => {
    if (!scheduleRefreshKey) return
    setActiveOptimisticMutations([])
    pendingPollCountRef.current = 0
    pendingPollFastTicksRef.current = 0
  }, [scheduleRefreshKey])

  useEffect(() => {
    pendingPollCountRef.current = 0
    pendingPollFastTicksRef.current = 0
  }, [pendingEventIdsKey])

  useEffect(() => {
    if (!Array.isArray(optimisticScheduleMutations) || optimisticScheduleMutations.length === 0) return
    const start = processedOptimisticMutationCountRef.current
    const nextMutations = optimisticScheduleMutations.slice(start)
    if (nextMutations.length === 0) return
    for (const mutation of nextMutations) {
      applyOptimisticMutation(mutation)
    }
    processedOptimisticMutationCountRef.current = optimisticScheduleMutations.length
  }, [optimisticScheduleMutations, applyOptimisticMutation])

  useEffect(() => {
    if (!serverData || activeOptimisticMutations.length === 0) return
    setActiveOptimisticMutations((prev) => {
      const next = prev.filter((mutation) => !isOptimisticMutationResolved(serverData, mutation))
      return next.length === prev.length ? prev : next
    })
  }, [serverData, activeOptimisticMutations.length])

  const data = useMemo(() => {
    let next = serverData
    for (const mutation of activeOptimisticMutations) {
      next = applyOptimisticMutationToMonthData(next, mutation)
    }
    return stripOptimisticDuplicatesFromMonthData(next)
  }, [serverData, activeOptimisticMutations])

  const hasPendingCalendarSync = useMemo(() => {
    if (normalizedPendingEventIds.length > 0) return true
    return monthDataHasPendingCalendarSync(data)
  }, [data, normalizedPendingEventIds])

  useEffect(() => {
    if (!onPendingCalendarEventIdsChange || normalizedPendingEventIds.length === 0 || !serverData) return
    const stillPending = normalizedPendingEventIds.filter((id) => {
      const lesson = findLessonInMonthData(serverData, id)
      if (lesson) return isLessonCalendarSyncPending(lesson)
      for (const monthKey of Object.keys(serverData)) {
        for (const l of serverData[monthKey]?.lessons || []) {
          if (lessonMatchesPendingEventId(l, [id]) && isLessonCalendarSyncPending(l)) return true
        }
      }
      return true
    })
    if (stillPending.length !== normalizedPendingEventIds.length) {
      onPendingCalendarEventIdsChange(stillPending)
    }
  }, [serverData, normalizedPendingEventIds, onPendingCalendarEventIdsChange])

  useEffect(() => {
    if (!hasPendingCalendarSync || studentId == null) {
      pendingPollCountRef.current = 0
      pendingPollFastTicksRef.current = 0
      return
    }
    let cancelled = false
    let timerId = null
    const tick = () => {
      if (cancelled) return
      if (pendingPollCountRef.current >= PENDING_SYNC_POLL_MAX) return
      pendingPollCountRef.current += 1
      const useFast = pendingPollFastTicksRef.current < PENDING_SYNC_POLL_FAST_TICKS
      if (useFast) pendingPollFastTicksRef.current += 1
      refetchSilent()
      if (cancelled || pendingPollCountRef.current >= PENDING_SYNC_POLL_MAX) return
      const delay = useFast ? PENDING_SYNC_POLL_FAST_MS : PENDING_SYNC_POLL_MS
      timerId = window.setTimeout(tick, delay)
    }
    tick()
    return () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
    }
  }, [hasPendingCalendarSync, studentId, refetchSilent, pendingEventIdsKey])

  const selectedLessonKey = getLessonIdentityKey(selectedLesson)

  useEffect(() => {
    if (!data || !selectedLessonKey) return
    let fresh = null
    for (const monthKey of Object.keys(data)) {
      const lessons = data[monthKey]?.lessons || []
      fresh = lessons.find((lesson) => getLessonIdentityKey(lesson) === selectedLessonKey)
      if (fresh) break
    }
    if (!fresh && selectedLesson?.eventID) {
      fresh = findLessonInMonthData(data, selectedLesson.eventID)
    }
    if (fresh) {
      setSelectedLesson((prev) => (prev && getLessonIdentityKey(prev) === selectedLessonKey ? fresh : prev))
    }
  }, [data, selectedLessonKey, selectedLesson?.eventID])
  const [rescheduleChoiceLesson, setRescheduleChoiceLesson] = useState(null)
  const [pendingRemoveLesson, setPendingRemoveLesson] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [changeCountOpen, setChangeCountOpen] = useState(false)
  const [changeCountMonthKey, setChangeCountMonthKey] = useState(null)

  const handleCancel = async (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    applyOptimisticMutation({
      type: 'patch_lesson',
      eventID: lesson.eventID,
      patch: {
        transientStatus: 'sync_pending',
        calendarSyncError: null,
      },
    })
    try {
      await api.cancelScheduleEvent(lesson.eventID)
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: undefined,
          status: 'cancelled',
          awaitingRescheduleDate: false,
          calendarSyncStatus: 'synced',
          calendarSyncError: null,
        },
      })
      success('Lesson cancelled')
      try {
        await refetchSilent()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Cancelled, but refresh failed')
      }
      return true
    } catch (e) {
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: 'sync_failed',
          calendarSyncStatus: 'failed',
          calendarSyncError: e.message,
        },
      })
      setActionError(e.message)
      return false
    }
  }
  const handleUnreschedule = async (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    if (studentId == null) return
    setActionError(null)
    applyOptimisticMutation({
      type: 'patch_lesson',
      eventID: lesson.eventID,
      patch: {
        transientStatus: 'sync_pending',
        calendarSyncError: null,
      },
    })
    try {
      await api.unrescheduleLinkedLesson({
        source_event_id: lesson.eventID,
        student_id: studentId,
        source_student_name: student?.Name || student?.name || '',
      })
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: undefined,
          status: 'scheduled',
          awaitingRescheduleDate: false,
          rescheduledTo: undefined,
          optimisticRescheduledTo: undefined,
          calendarSyncStatus: 'synced',
          calendarSyncError: null,
        },
      })
      success('Reschedule undone')
      try {
        await refetchSilent()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Undone, but refresh failed')
      }
      return true
    } catch (e) {
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: 'sync_failed',
          calendarSyncStatus: 'failed',
          calendarSyncError: e.message,
        },
      })
      setActionError(e.message)
      return false
    }
  }
  const handleUncancel = async (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    applyOptimisticMutation({
      type: 'patch_lesson',
      eventID: lesson.eventID,
      patch: {
        transientStatus: 'sync_pending',
        calendarSyncError: null,
      },
    })
    try {
      await api.uncancelScheduleEvent(lesson.eventID)
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: undefined,
          status: 'scheduled',
          awaitingRescheduleDate: false,
          calendarSyncStatus: 'synced',
          calendarSyncError: null,
        },
      })
      success('Lesson uncancelled')
      try {
        await refetchSilent()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Uncancelled, but refresh failed')
      }
      return true
    } catch (e) {
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: 'sync_failed',
          calendarSyncStatus: 'failed',
          calendarSyncError: e.message,
        },
      })
      setActionError(e.message)
      return false
    }
  }
  const openBookingReschedule = (lesson) => {
    if (BOOKING_WIP_DISABLED) return
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    if (typeof onBookLesson !== 'function') {
      setActionError('Booking modal is not available for reschedule.')
      return
    }
    onBookLesson({ rescheduleSource: lesson })
  }
  const handleOpenRescheduleChoice = (lesson) => {
    if (BOOKING_WIP_DISABLED) return
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    setRescheduleChoiceLesson(lesson)
  }
  const handleSelectRescheduleDate = (lesson) => {
    if (BOOKING_WIP_DISABLED) return
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setSelectedLesson(null)
    openBookingReschedule(lesson)
  }
  const handleOpenMoveReservedDate = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    if (typeof onBookLesson !== 'function') {
      setActionError('Booking calendar is not available for Change date.')
      return
    }
    setSelectedLesson(null)
    onBookLesson({ moveReservedSource: lesson })
  }
  const handleRemove = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) {
      const monthKey = findLessonMonthKey(serverData, lesson.eventID) || activeMonth
      if (!monthKey) {
        setActionError('Could not determine the month for this lesson.')
        return
      }
      setActionError(null)
      setPendingRemoveLesson({ ...lesson, reduceMonthKey: monthKey })
      return
    }
    setActionError(null)
    setPendingRemoveLesson(lesson)
  }
  const handleSyncWithCalendar = async (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    applyOptimisticMutation({
      type: 'patch_lesson',
      eventID: lesson.eventID,
      patch: {
        transientStatus: 'sync_pending',
        calendarSyncStatus: 'pending',
        calendarSyncError: null,
      },
    })
    try {
      await api.syncScheduleEvent(lesson.eventID)
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: undefined,
          calendarSyncStatus: 'synced',
          calendarSyncError: null,
        },
      })
      success('Lesson synced with Calendar')
      try {
        await refetchSilent()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Synced, but refresh failed')
      }
      return true
    } catch (e) {
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lesson.eventID,
        patch: {
          transientStatus: 'sync_failed',
          calendarSyncStatus: 'failed',
          calendarSyncError: e.message,
        },
      })
      setActionError(e.message)
      return false
    }
  }

  const handleConfirmOneWeek = async (lesson) => {
    if (RESERVED_CONFIRM_WIP_DISABLED) return false
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return false
    if (confirmingSchedule) return false
    setActionError(null)
    const eventID = String(lesson?.eventID || '').trim()
    if (!eventID) {
      setActionError('Missing event id for confirm')
      return false
    }
    const monthKey = findLessonMonthKey(serverData, eventID) || activeMonth
    if (!monthKey) {
      setActionError('Could not determine month for confirm')
      return false
    }
    const monthEntry = serverData?.[monthKey]
    const paidPack = parseInt(monthEntry?.paidLessonsCount, 10)
    const confirmBody = {
      confirm_month: monthKey,
      finalize_series: false,
      ...(Number.isFinite(paidPack) && paidPack > 0 ? { pack_total: paidPack } : {}),
    }
    setConfirmingSchedule(true)
    try {
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID,
        patch: {
          status: 'reserved',
          calendarSyncStatus: 'pending',
          calendarSyncError: null,
          transientError: null,
          transientStatus: 'confirm_processing',
        },
      })
      try {
        await api.confirmReservedSchedule({ event_id: eventID, ...confirmBody })
        applyOptimisticMutation({
          type: 'patch_lesson',
          eventID,
          patch: {
            status: 'scheduled',
            calendarSyncStatus: 'synced',
            calendarSyncError: null,
            transientError: null,
            transientStatus: undefined,
          },
        })
      } catch (e) {
        applyOptimisticMutation({
          type: 'patch_lesson',
          eventID,
          patch: {
            status: 'reserved',
            calendarSyncStatus: 'failed',
            transientStatus: 'sync_failed',
            calendarSyncError: e.message,
            transientError: e.message,
          },
        })
        setActionError(e.message)
        return false
      }
      try {
        await refetchSilent()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Confirmed, but refresh failed')
      }
      setActiveOptimisticMutations((prev) =>
        prev.filter((m) => !(m.type === 'patch_lesson' && m.eventID === eventID))
      )
      success('Week confirmed')
      return true
    } finally {
      setConfirmingSchedule(false)
    }
  }

  const handleConfirmAllWeeks = async (lesson) => {
    if (RESERVED_CONFIRM_WIP_DISABLED) return false
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return false
    if (confirmingSchedule) return false
    setActionError(null)
    const monthKey = findLessonMonthKey(serverData, lesson?.eventID) || activeMonth
    if (!monthKey) {
      setActionError('Could not determine month for confirm')
      return false
    }
    const batchEventIds = listReservedBatchEventIds(serverData, monthKey, lesson)
    if (batchEventIds.length === 0) {
      setActionError('Could not determine reserved lessons for this month')
      return false
    }
    const monthEntry = serverData?.[monthKey]
    const paidPack = parseInt(monthEntry?.paidLessonsCount, 10)
    const confirmBodyBase = {
      confirm_month: monthKey,
      ...(Number.isFinite(paidPack) && paidPack > 0 ? { pack_total: paidPack } : {}),
    }
    setConfirmingSchedule(true)
    let confirmedCount = 0
    try {
      for (const eventID of batchEventIds) {
        applyOptimisticMutation({
          type: 'patch_lesson',
          eventID,
          patch: {
            status: 'reserved',
            calendarSyncStatus: 'pending',
            calendarSyncError: null,
            transientError: null,
            transientStatus: undefined,
          },
        })
      }
      for (let i = 0; i < batchEventIds.length; i++) {
        const eventID = batchEventIds[i]
        const isLastWeek = i === batchEventIds.length - 1
        applyOptimisticMutation({
          type: 'patch_lesson',
          eventID,
          patch: {
            status: 'reserved',
            calendarSyncStatus: 'pending',
            calendarSyncError: null,
            transientError: null,
            transientStatus: 'confirm_processing',
          },
        })
        try {
          await api.confirmReservedSchedule({
            event_id: eventID,
            ...confirmBodyBase,
            finalize_series: isLastWeek,
          })
          applyOptimisticMutation({
            type: 'patch_lesson',
            eventID,
            patch: {
              status: 'scheduled',
              calendarSyncStatus: 'synced',
              calendarSyncError: null,
              transientError: null,
              transientStatus: undefined,
            },
          })
          confirmedCount += 1
        } catch (e) {
          applyOptimisticMutation({
            type: 'patch_lesson',
            eventID,
            patch: {
              status: 'reserved',
              calendarSyncStatus: 'failed',
              transientStatus: 'sync_failed',
              calendarSyncError: e.message,
              transientError: e.message,
            },
          })
          setActionError(e.message)
          break
        }
      }
      try {
        await refetchSilent()
      } catch (refreshErr) {
        if (confirmedCount > 0) {
          setActionError(refreshErr?.message || 'Confirmed, but refresh failed')
        }
      }
      setActiveOptimisticMutations((prev) =>
        prev.filter((m) => !(m.type === 'patch_lesson' && batchEventIds.includes(m.eventID)))
      )
      if (confirmedCount === batchEventIds.length) {
        success('Schedule confirmed')
        return true
      }
      return false
    } finally {
      setConfirmingSchedule(false)
    }
  }

  const confirmRemoveLesson = async () => {
    if (!pendingRemoveLesson?.eventID) return
    const lessonToRemove = pendingRemoveLesson
    const eventId = lessonToRemove.eventID
    const isUnscheduledRemove = String(lessonToRemove.status || '').toLowerCase() === 'unscheduled'
    const isReservedRemove = String(lessonToRemove.status || '').toLowerCase() === 'reserved'
    const monthKeyForOcc =
      findLessonMonthKey(serverData, eventId) ||
      String(lessonToRemove.reduceMonthKey || activeMonth || '').trim()
    const dayRaw = String(lessonToRemove.day || '').trim()
    const occurrenceDate =
      /^\d{4}-\d{2}$/.test(monthKeyForOcc) && /^\d{1,2}$/.test(dayRaw)
        ? `${monthKeyForOcc}-${dayRaw.padStart(2, '0')}`
        : null
    setPendingRemoveLesson(null)
    setSelectedLesson(null)
    if (isUnscheduledRemove) {
      const monthKey = String(lessonToRemove.reduceMonthKey || '').trim()
      // Accept repeated removals immediately, but serialize the underlying count
      // updates so concurrent clicks cannot overwrite each other's decrement.
      const queuedRemove = unscheduledRemoveQueueRef.current.then(async () => {
        const latest = await api.getStudentLatestByMonth(studentId)
        const monthEntry = latest?.latestByMonth?.[monthKey] || serverData?.[monthKey]
        const currentCount = Math.max(0, parseInt(monthEntry?.paidLessonsCount, 10) || 0)
        const bookedCount = Math.max(0, parseInt(monthEntry?.bookedLessonsCount, 10) || 0)
        const nextCount = Math.max(bookedCount, currentCount - 1)
        await api.upsertStudentMonthLessons({
          student_id: studentId,
          month: monthKey,
          lessons: nextCount,
        })
        await refetch()
        onMonthLessonsUpdated?.()
        return nextCount
      })
      unscheduledRemoveQueueRef.current = queuedRemove.catch(() => {})
      try {
        const nextCount = await queuedRemove
        success(`Monthly lesson count reduced to ${nextCount}`)
      } catch (e) {
        setActionError(e?.message || 'Failed to reduce monthly lesson count')
      }
      return
    }
    applyOptimisticMutation({
      type: 'patch_lesson',
      eventID: eventId,
      patch: {
        transientStatus: 'deleting',
        calendarSyncError: null,
      },
    })
    try {
      const tryRemove = async (localOnly) =>
        api.removeScheduleEvent(eventId, { localOnly, occurrenceDate })
      let removeResult = null
      try {
        removeResult = await tryRemove(false)
      } catch (firstErr) {
        const msg = String(firstErr?.message || '')
        const calendarUnreachable = /etimedout|timed out|timeout|econnrefused|did not respond|fetch failed/i.test(
          msg
        )
        if (calendarUnreachable) {
          try {
            removeResult = await tryRemove(true)
          } catch {
            throw firstErr
          }
        } else {
          throw firstErr
        }
      }
      await refetchSilent()
      const calendarWarning = String(removeResult?.calendar_warning || '').trim()
      if (!isReservedRemove) {
        applyOptimisticMutation({
          type: 'replace_with_unscheduled',
          eventID: eventId,
        })
        success(
          calendarWarning
            ? 'Lesson removed from schedule (Google Calendar may still need cleanup)'
            : 'Lesson removed'
        )
      } else {
        success(
          removeResult?.calendar_already_gone
            ? '予約済みレッスンを削除しました（カレンダー上は既にありませんでした）'
            : calendarWarning
              ? '予約済みレッスンを削除しました（カレンダーは未反映の可能性があります）'
              : '予約済みレッスンを削除しました'
        )
      }
      if (
        calendarWarning &&
        !/not found|calendar\.events\.delete|calendar api remove failed/i.test(calendarWarning)
      ) {
        setActionError(calendarWarning)
      }
    } catch (e) {
      if (!isReservedRemove) {
        applyOptimisticMutation({
          type: 'patch_lesson',
          eventID: eventId,
          patch: {
            transientStatus: 'sync_failed',
            calendarSyncStatus: 'failed',
            calendarSyncError: e.message,
          },
        })
      }
      setActionError(e.message)
    } finally {
      setActiveOptimisticMutations((prev) =>
        prev.filter(
          (m) =>
            !(
              m.type === 'patch_lesson' &&
              m.eventID === eventId &&
              m.patch?.transientStatus === 'deleting'
            )
        )
      )
    }
  }

  const handleLessonNotesChanged = useCallback(({ lessonUUID, hasNote, lessonNotes = [] } = {}) => {
    if (!lessonUUID) return
    setData((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      for (const monthKey of Object.keys(next)) {
        const monthEntry = next[monthKey]
        if (!monthEntry?.lessons?.length) continue
        let touched = false
        const lessons = monthEntry.lessons.map((lesson) => {
          if (String(lesson?.lessonUUID || '') !== String(lessonUUID)) return lesson
          touched = true
          return { ...lesson, hasNote: !!hasNote }
        })
        if (touched) {
          next[monthKey] = { ...monthEntry, lessons }
        }
      }
      return next
    })
    setSelectedLesson((prev) => {
      if (!prev) return prev
      if (String(prev.lessonUUID || '') !== String(lessonUUID)) return prev
      return { ...prev, hasNote: !!hasNote, lessonNotes }
    })
    onLessonNotesChanged?.({ lessonUUID, hasNote, lessonNotes })
  }, [setData, onLessonNotesChanged])

  const openChangeLessonCount = (monthKey) => {
    if (studentId == null || !monthKey) return
    setActionError(null)
    setChangeCountMonthKey(monthKey)
    setChangeCountOpen(true)
  }

  const wrapSection = (inner) => {
    if (sectionClassName) {
      return (
        <section className={sectionClassName}>
          <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
            <h3 className="font-semibold text-sm">Lessons This Month</h3>
            {onBookLesson ? (
              <button
                type="button"
                onClick={onBookLesson}
                disabled={BOOKING_WIP_DISABLED}
                title={BOOKING_WIP_DISABLED ? 'Booking is temporarily disabled' : undefined}
                className={
                  BOOKING_WIP_DISABLED
                    ? 'inline-flex items-center gap-1.5 rounded-lg bg-gray-300 text-gray-500 px-2.5 py-1 text-xs font-semibold line-through cursor-not-allowed'
                    : 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer'
                }
              >
                <Calendar className="w-4 h-4" />
                {studentIsDemo(student) ? 'Book demo lesson' : 'Book lesson'}
              </button>
            ) : (
              <span className="w-[1px] shrink-0" aria-hidden />
            )}
          </header>
          {inner}
        </section>
      )
    }
    return inner
  }

  if (loading) {
    return wrapSection(<div className="flex flex-1 min-h-0" aria-hidden />)
  }

  if (error) {
    const is404 = /not found|404/i.test(error)
    return wrapSection(
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center px-4">
        <span className="text-red-600 text-sm font-medium">{error}</span>
        {is404 && (
          <span className="text-slate-500 text-xs">
            Restart the API server if you recently added the latest-by-month endpoint.
          </span>
        )}
      </div>
    )
  }

  const monthKeys = Object.keys(data || {})
  if (monthKeys.length === 0) {
    return wrapSection(
      <div className="flex flex-1 items-center justify-center text-slate-500 text-sm">
        No schedule data
      </div>
    )
  }

  const current = activeMonth || monthKeys[0]
  const monthData = data[current]
  const now = new Date()
  const year = monthData?.year ?? now.getFullYear()
  const monthIndex = monthData?.monthIndex ?? now.getMonth()

  const changeCountEntry = changeCountMonthKey ? data[changeCountMonthKey] : null
  const changeCountModal =
    changeCountOpen && studentId != null && changeCountMonthKey && changeCountEntry ? (
      <PreBookLessonModal
        key={changeCountMonthKey}
        overlayClassName="z-[10002]"
        initialPackTotal={
          changeCountEntry.paidLessonsCount > 0 ? changeCountEntry.paidLessonsCount : 4
        }
        description={`${changeCountEntry.label || changeCountMonthKey} の月の回数を保存し、アプリと Google Calendar のレッスンタイトル（1/N…）を開始時刻順に振り直します`}
        confirmLabel="Save & renumber"
        onClose={() => {
          setChangeCountOpen(false)
          setChangeCountMonthKey(null)
        }}
        onConfirm={async (n) => {
          try {
            await api.upsertStudentMonthLessons({
              student_id: studentId,
              month: changeCountMonthKey,
              lessons: n,
            })
            const renumberRes = await api.renumberMonthLessonTitles({
              student_id: studentId,
              month: changeCountMonthKey,
              pack_total: n,
            })
            const patched = Number(renumberRes?.calendar_patched) || 0
            const calErrs = Array.isArray(renumberRes?.calendar_errors)
              ? renumberRes.calendar_errors
              : []
            if (calErrs.length > 0) {
              success(
                `タイトルを振り直しました（Calendar ${patched}件更新、${calErrs.length}件失敗）`
              )
              setActionError(
                calErrs
                  .slice(0, 3)
                  .map((e) => e?.error || 'Calendar update failed')
                  .join('; ')
              )
            } else {
              success(
                patched > 0
                  ? `月の回数を保存し、タイトルを振り直しました（Calendar ${patched}件更新）`
                  : '月の回数を保存し、タイトルを振り直しました'
              )
            }
            setChangeCountOpen(false)
            setChangeCountMonthKey(null)
            await refetch()
            onMonthLessonsUpdated?.()
          } catch (e) {
            setActionError(e?.message || 'Save failed')
          }
        }}
      />
    ) : null

  const monthToggles = (
    <div className="flex items-center gap-1">
      {monthKeys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => setActiveMonth(key)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium cursor-pointer ${
            key === current
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {data[key]?.label ?? key}
        </button>
      ))}
    </div>
  )

  const pendingRemoveSync = String(pendingRemoveLesson?.calendarSyncStatus || '')
    .trim()
    .toLowerCase()
  const pendingRemoveIsLocalOnly = pendingRemoveSync === 'failed'
  const pendingRemoveIsReserved = String(pendingRemoveLesson?.status || '').toLowerCase() === 'reserved'
  const pendingRemoveIsUnscheduled =
    String(pendingRemoveLesson?.status || '').toLowerCase() === 'unscheduled'

  const content = (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-hidden px-2 py-1">
        {actionError && (
          <div className="text-red-600 text-sm shrink-0" role="alert">
            {actionError}
          </div>
        )}

        {monthData?.lessons?.length > 0 ? (
          (() => {
            const count = monthData.lessons.length
            const cardSize = count <= 5 ? 'large' : count <= 10 ? 'normal' : 'compact'
            return (
              <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
                <div
                  className="flex flex-col min-h-0 overflow-hidden flex-1"
                >
                  <div
                    className="lr-cards grid gap-1 py-1 px-1 h-full w-full grid-cols-[repeat(auto-fill,minmax(98px,1fr))]"
                    style={{ gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
                  >
                    {monthData.lessons.map((lesson, i) => (
                      <LessonCard
                        key={lesson.eventID || i}
                        lesson={lesson}
                        year={year}
                        monthIndex={monthIndex}
                        onClick={confirmingSchedule ? undefined : setSelectedLesson}
                        size={cardSize}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )
          })()
        ) : (
          <p className="text-slate-500 text-sm py-4">No lessons scheduled</p>
        )}
      </div>

      {selectedLesson && (
        <LessonDetailsModal
          lesson={selectedLesson}
          student={student}
          onClose={() => { setSelectedLesson(null); setActionError(null) }}
          onCancel={handleCancel}
          onUncancel={handleUncancel}
          onUnreschedule={handleUnreschedule}
          onOpenRescheduleChoice={handleOpenRescheduleChoice}
          onSelectRescheduleDate={handleSelectRescheduleDate}
          onSyncWithCalendar={handleSyncWithCalendar}
          onConfirmOneWeek={handleConfirmOneWeek}
          onConfirmAllWeeks={handleConfirmAllWeeks}
          confirmScheduleMonthKey={
            findLessonMonthKey(serverData, selectedLesson?.eventID) || activeMonth || ''
          }
          onRemove={handleRemove}
          onMoveReservedDate={handleOpenMoveReservedDate}
          onBookLesson={
            onBookLesson
              ? () => {
                  setSelectedLesson(null)
                  setActionError(null)
                  onBookLesson()
                }
              : undefined
          }
          onLessonNotesChanged={handleLessonNotesChanged}
        />
      )}
      {rescheduleChoiceLesson && (
        <RescheduleChoiceModal
          onClose={() => setRescheduleChoiceLesson(null)}
          onSelectNow={() => {
            const l = rescheduleChoiceLesson
            setRescheduleChoiceLesson(null)
            setSelectedLesson(null)
            openBookingReschedule(l)
          }}
          onSelectLater={async () => {
            const l = rescheduleChoiceLesson
            setActionError(null)
            applyOptimisticMutation({
              type: 'patch_lesson',
              eventID: l.eventID,
              patch: {
                transientStatus: 'sync_pending',
                calendarSyncError: null,
              },
            })
            try {
              await api.rescheduleAwaitingDate(l.eventID)
              applyOptimisticMutation({
                type: 'patch_lesson',
                eventID: l.eventID,
                patch: {
                  transientStatus: undefined,
                  status: 'rescheduled',
                  awaitingRescheduleDate: true,
                  calendarSyncStatus: 'synced',
                  calendarSyncError: null,
                },
              })
              success('Lesson marked as awaiting a new date')
              setRescheduleChoiceLesson(null)
              setSelectedLesson(null)
              await refetchSilent()
            } catch (e) {
              applyOptimisticMutation({
                type: 'patch_lesson',
                eventID: l.eventID,
                patch: {
                  transientStatus: 'sync_failed',
                  calendarSyncStatus: 'failed',
                  calendarSyncError: e?.message || 'Request failed',
                },
              })
              setActionError(e?.message || 'Request failed')
            }
          }}
        />
      )}
      {pendingRemoveLesson && (
        <ConfirmActionModal
          title={
            pendingRemoveIsUnscheduled
              ? 'Reduce Monthly Lesson Count'
              : pendingRemoveIsReserved
              ? '予約済みレッスンの削除'
              : pendingRemoveIsLocalOnly
                ? 'Remove from schedule only'
                : 'Remove Lesson'
          }
          message={
            pendingRemoveIsUnscheduled
              ? 'Remove this unscheduled lesson and reduce the lesson count for this month by 1?'
              : pendingRemoveIsReserved
              ? 'この予約済みレッスン（この回のみ）を削除します。他の予約済み回は残ります。Googleカレンダー上のその回も取り消されます。よろしいですか？'
              : pendingRemoveIsLocalOnly
                ? 'Calendar sync failed for this lesson. Remove it from the schedule only? Nothing will be deleted from Google Calendar.'
                : 'Remove this lesson from the schedule?'
          }
          confirmLabel={
            pendingRemoveIsUnscheduled
              ? 'Reduce by 1'
              : pendingRemoveIsReserved
                ? '削除'
                : pendingRemoveIsLocalOnly
                  ? 'Remove locally'
                  : 'Remove'
          }
          cancelLabel={pendingRemoveIsReserved ? 'キャンセル' : 'Cancel'}
          destructive
          busyConfirmLabel={
            pendingRemoveIsUnscheduled ? 'Reducing…' : pendingRemoveIsReserved ? '削除中…' : undefined
          }
          onConfirm={confirmRemoveLesson}
          onClose={() => setPendingRemoveLesson(null)}
        />
      )}
    </div>
  )

  if (sectionClassName) {
    return (
      <>
        <section className={sectionClassName}>
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0">
            <h3 className="font-semibold text-sm">Lessons This Month</h3>
            {monthKeys.length > 0 && monthToggles}
            <div className="flex items-center gap-1 shrink-0">
              {studentId != null && monthKeys.length > 0 && !studentIsDemo(student) ? (
                <button
                  type="button"
                  onClick={() => openChangeLessonCount(current)}
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-50 cursor-pointer"
                >
                  月回数変更
                </button>
              ) : null}
              {onBookLesson ? (
                <button
                  type="button"
                  onClick={onBookLesson}
                  disabled={BOOKING_WIP_DISABLED}
                  title={BOOKING_WIP_DISABLED ? 'Booking is temporarily disabled' : undefined}
                  className={
                    BOOKING_WIP_DISABLED
                      ? 'inline-flex items-center gap-1.5 rounded-lg bg-gray-300 text-gray-500 px-2.5 py-1 text-xs font-semibold line-through cursor-not-allowed'
                      : 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer'
                  }
                >
                  <Calendar className="w-4 h-4" />
                  {studentIsDemo(student) ? 'Book demo lesson' : 'Book lesson'}
                </button>
              ) : null}
            </div>
          </header>
          {content}
        </section>
        {changeCountModal}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-2 py-1.5">
          <div className="flex items-center gap-1 min-w-0">{monthToggles}</div>
          <div className="flex items-center gap-1 shrink-0">
            {studentId != null && monthKeys.length > 0 && !studentIsDemo(student) ? (
              <button
                type="button"
                onClick={() => openChangeLessonCount(current)}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-50 cursor-pointer"
              >
                月回数変更
              </button>
            ) : null}
            {onBookLesson ? (
              <button
                type="button"
                onClick={onBookLesson}
                disabled={BOOKING_WIP_DISABLED}
                title={BOOKING_WIP_DISABLED ? 'Booking is temporarily disabled' : undefined}
                className={
                  BOOKING_WIP_DISABLED
                    ? 'inline-flex items-center gap-1.5 rounded-lg bg-gray-300 text-gray-500 px-2 py-1 text-xs font-semibold line-through cursor-not-allowed'
                    : 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer'
                }
              >
                <Calendar className="w-4 h-4" />
                Book
              </button>
            ) : null}
          </div>
        </div>
        {content}
      </div>
      {changeCountModal}
    </>
  )
}
