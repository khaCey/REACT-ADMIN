import { useState, useEffect } from 'react'
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
  cancelled: { accent: 'bg-slate-500', bg: 'bg-slate-50', dot: 'bg-slate-500', hoverRing: 'hover:ring-slate-500/60', label: 'Cancelled' },
  reschedule_date_tbd: {
    accent: 'bg-orange-500',
    bg: 'bg-orange-50',
    dot: 'bg-orange-500',
    hoverRing: 'hover:ring-orange-500/60',
    label: 'Date TBD',
  },
  rescheduled: { accent: 'bg-amber-500', bg: 'bg-slate-50', dot: 'bg-amber-500', hoverRing: 'hover:ring-amber-500/60', label: 'Rescheduled' },
  demo: { accent: 'bg-orange-500', bg: 'bg-orange-50', dot: 'bg-orange-500', hoverRing: 'hover:ring-orange-500/60', label: 'Demo' },
  unscheduled: { accent: 'bg-red-500', bg: 'bg-red-100', dot: 'bg-red-500', hoverRing: 'hover:ring-red-500/60', label: 'Unscheduled' },
  sync_pending: { accent: 'bg-red-500', bg: 'bg-red-100', dot: 'bg-red-500', hoverRing: 'hover:ring-red-500/60', label: 'Syncing' },
  sync_failed: { accent: 'bg-red-600', bg: 'bg-red-100', dot: 'bg-red-600', hoverRing: 'hover:ring-red-500/60', label: 'Sync failed' },
}

const CARD_SIZES = {
  compact: { date: 'text-[0.7rem]', dow: 'text-[0.6rem]', time: 'text-[0.65rem]', status: 'text-[0.6rem]', dot: 'h-1 w-1', pad: 'px-1.5 py-0.5', accent: 'w-1' },
  normal: { date: 'text-[0.75rem]', dow: 'text-[0.65rem]', time: 'text-[0.7rem]', status: 'text-[0.65rem]', dot: 'h-1.5 w-1.5', pad: 'px-2 py-1', accent: 'w-1' },
  large: { date: 'text-[0.8rem]', dow: 'text-[0.7rem]', time: 'text-[0.75rem]', status: 'text-[0.7rem]', dot: 'h-2 w-2', pad: 'px-2 py-1.5', accent: 'w-1.5' },
}


function LessonCard({ lesson, year, monthIndex, onClick, size = 'normal' }) {
  const rawStatus = String(lesson.status || '').toLowerCase()
  const syncStatus = String(lesson.calendarSyncStatus || 'synced').toLowerCase()
  // Keep unscheduled and cancelled explicit; then show rescheduled source, then calendar sync state.
  const displayStatus =
    rawStatus === 'unscheduled'
      ? 'unscheduled'
      : rawStatus === 'cancelled' && lesson.awaitingRescheduleDate
        ? 'reschedule_date_tbd'
        : rawStatus === 'cancelled'
          ? 'cancelled'
          : lesson.rescheduledTo
          ? 'rescheduled'
          : syncStatus === 'failed'
            ? 'sync_failed'
            : syncStatus === 'pending'
              ? 'sync_pending'
              : rawStatus
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

  return (
    <button
      type="button"
      onClick={() => onClick?.(lesson)}
      className={`lr-card group relative inline-flex items-center gap-1 rounded-lg border border-gray-200 ${styles.bg} ${sz.pad} w-full h-full min-h-0 max-h-[108px] text-left shadow-sm hover:shadow-md transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-inset ${styles.hoverRing} cursor-pointer overflow-hidden`}
      data-status={displayStatus}
      aria-label={`Lesson ${dayStr} ${timeStr} (${title})`}
    >
      <span className={`absolute left-0 top-0 h-full ${sz.accent} rounded-l-lg ${styles.accent}`} />
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

function useLatestByMonth(studentId, refreshTrigger) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeMonth, setActiveMonth] = useState(null)

  const fetchData = () => {
    if (studentId == null) return
    setLoading(true)
    setError(null)
    api
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
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (studentId == null) return
    fetchData()
  }, [studentId, refreshTrigger])

  return { data, loading, error, activeMonth, setActiveMonth, refetch: fetchData }
}

export default function LessonsThisMonth({
  studentId,
  student,
  onBookLesson,
  sectionClassName,
  onLoadingChange,
  onMonthLessonsUpdated,
}) {
  const { success } = useToast()
  const { lastSynced } = useCalendarPollingContext()
  const { data, loading, error, activeMonth, setActiveMonth, refetch } = useLatestByMonth(studentId, lastSynced)

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])
  const [selectedLesson, setSelectedLesson] = useState(null)
  const [rescheduleChoiceLesson, setRescheduleChoiceLesson] = useState(null)
  const [pendingRemoveLesson, setPendingRemoveLesson] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [changeCountOpen, setChangeCountOpen] = useState(false)
  const [changeCountMonthKey, setChangeCountMonthKey] = useState(null)

  const handleCancel = async (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    try {
      await api.cancelScheduleEvent(lesson.eventID)
      success('Lesson cancelled')
      try {
        await refetch()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Cancelled, but refresh failed')
      }
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    }
  }
  const handleUncancel = async (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    try {
      await api.uncancelScheduleEvent(lesson.eventID)
      success('Lesson uncancelled')
      try {
        await refetch()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Uncancelled, but refresh failed')
      }
      return true
    } catch (e) {
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
    try {
      await api.syncScheduleEvent(lesson.eventID)
      success('Lesson synced with Calendar')
      try {
        await refetch()
      } catch (refreshErr) {
        setActionError(refreshErr?.message || 'Synced, but refresh failed')
      }
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    }
  }

  const confirmRemoveLesson = async () => {
    if (!pendingRemoveLesson?.eventID) return
    setRemoving(true)
    try {
      await api.removeScheduleEvent(pendingRemoveLesson.eventID)
      success('Lesson removed')
      setPendingRemoveLesson(null)
      setSelectedLesson(null)
      await refetch()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setRemoving(false)
    }
  }

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
          onOpenRescheduleChoice={handleOpenRescheduleChoice}
          onSelectRescheduleDate={handleSelectRescheduleDate}
          onSyncWithCalendar={handleSyncWithCalendar}
          onRemove={handleRemove}
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
            try {
              await api.rescheduleAwaitingDate(l.eventID)
              success('Lesson marked as awaiting a new date')
              setRescheduleChoiceLesson(null)
              setSelectedLesson(null)
              await refetch()
            } catch (e) {
              setActionError(e?.message || 'Request failed')
            }
          }}
        />
      )}
      {pendingRemoveLesson && (
        <ConfirmActionModal
          title="Remove Lesson"
          message="Remove this lesson from the schedule?"
          confirmLabel="Remove"
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
