import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Calendar } from 'lucide-react'
import { api } from '../api'
import { useCalendarPollingContext } from '../context/CalendarPollingContext'
import LessonDetailsModal from './LessonDetailsModal'
import ConfirmActionModal from './ConfirmActionModal'
import PreBookLessonModal from './PreBookLessonModal'
import RescheduleChoiceModal from './RescheduleChoiceModal'
import { useToast } from '../context/ToastContext'

const DOW = ['日', '月', '火', '水', '木', '金', '土']

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** Match server `/students/:id/latest-by-month` window (Asia/Tokyo calendar month). */
function getCurrentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

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

const CARD_STYLES = {
  scheduled: { accent: 'bg-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-600', hoverRing: 'hover:ring-emerald-500/60', label: 'Scheduled' },
  calendar_pending: {
    accent: 'bg-sky-600',
    bg: 'bg-sky-50',
    dot: 'bg-sky-600',
    hoverRing: 'hover:ring-sky-500/60',
    label: 'Pending',
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
  if (transientStatus === 'sync_pending') return 'sync_pending'
  if (rawStatus === 'unscheduled') return 'unscheduled'
  if ((rawStatus === 'rescheduled' || rawStatus === 'cancelled') && lesson?.awaitingRescheduleDate) return 'reschedule_date_tbd'
  if (lesson?.optimisticRescheduledTo || lesson?.rescheduledTo) return 'rescheduled'
  if (rawStatus === 'rescheduled') return 'rescheduled'
  if (rawStatus === 'cancelled') return 'cancelled'
  if (syncStatus === 'failed') return 'sync_failed'
  if (syncStatus === 'pending' && rawStatus === 'scheduled') return 'calendar_pending'
  if (isDemoLesson) return 'demo'
  return rawStatus || 'scheduled'
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
        optimisticRescheduledTo: {
          date: mutation.targetDate || null,
          time: mutation.targetTime || null,
        },
        calendarSyncError: null,
      }))
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
    case 'book_start':
      return hasRealLessonAtDateTime(
        serverData,
        mutation.monthKey,
        mutation.date,
        mutation.time,
        mutation.lesson?.eventID
      )
    case 'reschedule_start': {
      const sourceMonthKey = findLessonMonthKey(serverData, mutation.sourceEventID)
      const sourceLesson = sourceMonthKey
        ? (serverData[sourceMonthKey]?.lessons || []).find((l) => l.eventID === mutation.sourceEventID)
        : null
      return !!sourceLesson?.rescheduledTo
    }
    case 'patch_lesson': {
      const monthKey = findLessonMonthKey(serverData, mutation.eventID)
      const serverLesson = monthKey
        ? (serverData[monthKey]?.lessons || []).find((l) => l.eventID === mutation.eventID)
        : null
      if (mutation.patch?.transientStatus === 'deleting') return !serverLesson
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
  const styles = CARD_STYLES[displayStatus] || CARD_STYLES.cancelled
  const title = styles.label || (displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1))
  const sz = CARD_SIZES[size] || CARD_SIZES.normal
  const hasNote = !!lesson?.hasNote

  return (
    <button
      type="button"
      onClick={() => onClick?.(lesson)}
      className={`lr-card group relative inline-flex items-center gap-1 rounded-lg border border-gray-200 ${styles.bg} ${sz.pad} w-full h-full min-h-0 max-h-[108px] text-left shadow-sm hover:shadow-md transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-0 focus-visible:ring-0 ${styles.hoverRing} cursor-pointer overflow-hidden ${hasNote ? 'ring-1 ring-amber-200' : ''}`}
      data-status={displayStatus}
      aria-label={`Lesson ${dayStr} ${timeStr} (${title})`}
    >
      <span className={`absolute left-0 top-0 h-full ${sz.accent} rounded-l-lg ${styles.accent}`} />
      {hasNote && (
        <span className="absolute top-1.5 right-1.5 inline-grid h-5 w-5 place-items-center rounded-full border border-amber-300 bg-amber-50 text-[11px] font-bold text-amber-700 shadow-sm">
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
          {hasNote && (
            <span
              className="ml-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700"
              title="Has lesson note"
              aria-label="Has lesson note"
            />
          )}
        </span>
      </span>
    </button>
  )
}

const PENDING_SYNC_POLL_MS = 2000
const PENDING_SYNC_POLL_MAX = 90

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
  optimisticScheduleMutations = [],
  scheduleRefreshKey = 0,
}) {
  const { success } = useToast()
  const { lastSynced } = useCalendarPollingContext()
  const { data: serverData, setData, loading, error, activeMonth, setActiveMonth, refetch, refetchSilent } = useLatestByMonth(
    studentId,
    lastSynced,
    scheduleRefreshKey
  )
  const pendingPollCountRef = useRef(0)
  const processedOptimisticMutationCountRef = useRef(0)
  const [activeOptimisticMutations, setActiveOptimisticMutations] = useState([])

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])
  const [selectedLesson, setSelectedLesson] = useState(null)

  const applyOptimisticMutation = useCallback((mutation) => {
    setActiveOptimisticMutations((prev) => [...prev, mutation])
  }, [])

  useEffect(() => {
    processedOptimisticMutationCountRef.current = 0
    setActiveOptimisticMutations([])
  }, [studentId])

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
    return next
  }, [serverData, activeOptimisticMutations])

  const hasPendingCalendarSync =
    !!data &&
    Object.values(data).some((m) =>
      (m?.lessons || []).some((l) => String(l.calendarSyncStatus || '').toLowerCase() === 'pending')
    )

  useEffect(() => {
    if (!hasPendingCalendarSync || studentId == null) {
      pendingPollCountRef.current = 0
      return
    }
    const tick = () => {
      if (pendingPollCountRef.current >= PENDING_SYNC_POLL_MAX) return
      pendingPollCountRef.current += 1
      refetchSilent()
    }
    tick()
    const id = setInterval(tick, PENDING_SYNC_POLL_MS)
    return () => clearInterval(id)
  }, [hasPendingCalendarSync, studentId, refetchSilent])

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
  const [removing, setRemoving] = useState(false)
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
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    if (typeof onBookLesson !== 'function') {
      setActionError('Booking modal is not available for reschedule.')
      return
    }
    onBookLesson({ rescheduleSource: lesson })
  }
  const handleOpenRescheduleChoice = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    setRescheduleChoiceLesson(lesson)
  }
  const handleSelectRescheduleDate = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setSelectedLesson(null)
    openBookingReschedule(lesson)
  }
  const handleRemove = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) {
      setActionError('Cannot remove an unscheduled placeholder.')
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

  const confirmRemoveLesson = async () => {
    if (!pendingRemoveLesson?.eventID) return
    const lessonToRemove = pendingRemoveLesson
    setRemoving(true)
    setPendingRemoveLesson(null)
    setSelectedLesson(null)
    applyOptimisticMutation({
      type: 'patch_lesson',
      eventID: lessonToRemove.eventID,
      patch: {
        transientStatus: 'deleting',
        calendarSyncError: null,
      },
    })
    try {
      const rmSync = String(lessonToRemove.calendarSyncStatus || '').trim().toLowerCase()
      const removeLocalOnly = rmSync === 'failed'
      await api.removeScheduleEvent(lessonToRemove.eventID, { localOnly: removeLocalOnly })
      applyOptimisticMutation({
        type: 'replace_with_unscheduled',
        eventID: lessonToRemove.eventID,
      })
      success('Lesson removed')
      await refetchSilent()
    } catch (e) {
      applyOptimisticMutation({
        type: 'patch_lesson',
        eventID: lessonToRemove.eventID,
        patch: {
          transientStatus: 'sync_failed',
          calendarSyncStatus: 'failed',
          calendarSyncError: e.message,
        },
      })
      setActionError(e.message)
    } finally {
      setRemoving(false)
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
  }, [setData])

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
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer"
              >
                <Calendar className="w-4 h-4" />
                Book lesson
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
        description={`${changeCountEntry.label || changeCountMonthKey} の月の回数（保存すると予約タイトルと未設定枠に反映されます）`}
        confirmLabel="Save"
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
            success('月の回数を保存しました')
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
                    className="lr-cards grid gap-1 py-1 pr-1 h-full w-full overflow-hidden grid-cols-[repeat(auto-fill,minmax(98px,1fr))]"
                    style={{ gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
                  >
                    {monthData.lessons.map((lesson, i) => (
                      <LessonCard
                        key={lesson.eventID || i}
                        lesson={lesson}
                        year={year}
                        monthIndex={monthIndex}
                        onClick={setSelectedLesson}
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
          onRemove={handleRemove}
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
          title={pendingRemoveIsLocalOnly ? 'Remove from schedule only' : 'Remove Lesson'}
          message={
            pendingRemoveIsLocalOnly
              ? 'Calendar sync failed for this lesson. Remove it from the schedule only? Nothing will be deleted from Google Calendar.'
              : 'Remove this lesson from the schedule?'
          }
          confirmLabel={pendingRemoveIsLocalOnly ? 'Remove locally' : 'Remove'}
          destructive
          confirming={removing}
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
              {studentId != null && monthKeys.length > 0 ? (
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  Book lesson
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
            {studentId != null && monthKeys.length > 0 ? (
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer"
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
