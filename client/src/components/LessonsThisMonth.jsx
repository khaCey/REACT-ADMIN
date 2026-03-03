import { useState, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { api } from '../api'
import { useCalendarPollingContext } from '../context/CalendarPollingContext'
import LessonDetailsModal from './LessonDetailsModal'
import ConfirmActionModal from './ConfirmActionModal'
import { useToast } from '../context/ToastContext'

const DOW = ['日', '月', '火', '水', '木', '金', '土']

const CARD_STYLES = {
  scheduled: { accent: 'bg-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-600', hoverRing: 'hover:ring-emerald-500/60' },
  cancelled: { accent: 'bg-slate-500', bg: 'bg-slate-50', dot: 'bg-slate-500', hoverRing: 'hover:ring-slate-500/60' },
  rescheduled: { accent: 'bg-amber-500', bg: 'bg-amber-50', dot: 'bg-amber-500', hoverRing: 'hover:ring-amber-500/60' },
  demo: { accent: 'bg-orange-500', bg: 'bg-orange-50', dot: 'bg-orange-500', hoverRing: 'hover:ring-orange-500/60' },
  unscheduled: { accent: 'bg-red-500', bg: 'bg-red-50', dot: 'bg-red-500', hoverRing: 'hover:ring-red-500/60' },
}

const CARD_SIZES = {
  compact: { date: 'text-[0.7rem]', dow: 'text-[0.6rem]', time: 'text-[0.65rem]', status: 'text-[0.6rem]', dot: 'h-1 w-1', pad: 'px-1.5 py-0.5', accent: 'w-1' },
  normal: { date: 'text-[0.75rem]', dow: 'text-[0.65rem]', time: 'text-[0.7rem]', status: 'text-[0.65rem]', dot: 'h-1.5 w-1.5', pad: 'px-2 py-1', accent: 'w-1' },
  large: { date: 'text-[0.8rem]', dow: 'text-[0.7rem]', time: 'text-[0.75rem]', status: 'text-[0.7rem]', dot: 'h-2 w-2', pad: 'px-2 py-1.5', accent: 'w-1.5' },
}

function LessonCard({ lesson, year, monthIndex, onClick, size = 'normal' }) {
  const isUnscheduled = lesson.status === 'unscheduled'
  const dayNum = parseInt(lesson.day, 10)
  const date = !isNaN(dayNum) && year != null && monthIndex >= 0
    ? new Date(year, monthIndex, dayNum)
    : null
  const dow = date && !isNaN(date.getTime()) ? DOW[date.getDay()] : ''
  const dayStr = isUnscheduled ? '--' : (lesson.day && lesson.day !== '--' ? `${parseInt(lesson.day)}日` : '--')
  const timeStr = isUnscheduled ? '--' : (lesson.time ? lesson.time.replace(':', '：') : '--')
  const title = (lesson.status || '').charAt(0).toUpperCase() + (lesson.status || '').slice(1)
  const styles = CARD_STYLES[lesson.status] || CARD_STYLES.cancelled
  const sz = CARD_SIZES[size] || CARD_SIZES.normal

  return (
    <button
      type="button"
      onClick={() => onClick?.(lesson)}
      className={`lr-card group relative inline-flex items-center gap-1 rounded-lg border border-gray-200 ${styles.bg} ${sz.pad} w-full h-full min-h-0 text-left shadow-sm hover:shadow-md transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-inset ${styles.hoverRing} cursor-pointer overflow-hidden`}
      data-status={lesson.status}
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
          {lesson.isGroup && <span className="badge bg-purple-600 text-white text-[0.55rem] px-1 py-0 shrink-0">Group</span>}
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
    if (!studentId) return
    setLoading(true)
    setError(null)
    api
      .getStudentLatestByMonth(studentId)
      .then((res) => {
        const latest = res.latestByMonth || {}
        const now = new Date()
        const thisYyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const nextYyyyMm = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`
        const ordered = [thisYyyyMm, nextYyyyMm].filter((k) => k in latest)
        const filtered = Object.fromEntries(ordered.map((k) => [k, latest[k]]))
        setData(filtered)
        setActiveMonth((prev) => (prev == null ? thisYyyyMm : prev))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!studentId) return
    fetchData()
  }, [studentId, refreshTrigger])

  return { data, loading, error, activeMonth, setActiveMonth, refetch: fetchData }
}

export default function LessonsThisMonth({ studentId, student, onBookLesson, sectionClassName }) {
  const { success } = useToast()
  const { lastSynced } = useCalendarPollingContext()
  const { data, loading, error, activeMonth, setActiveMonth, refetch } = useLatestByMonth(studentId, lastSynced)
  const [selectedLesson, setSelectedLesson] = useState(null)
  const [pendingRemoveLesson, setPendingRemoveLesson] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [actionError, setActionError] = useState(null)

  const handleCancel = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    api.cancelScheduleEvent(lesson.eventID).then(() => {
      success('Lesson cancelled')
      return refetch()
    }).catch((e) => setActionError(e.message))
  }
  const handleUncancel = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    api.uncancelScheduleEvent(lesson.eventID).then(() => {
      success('Lesson uncancelled')
      return refetch()
    }).catch((e) => setActionError(e.message))
  }
  const handleReschedule = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) return
    setActionError(null)
    // Reschedule requires new date/time – for now just open a simple prompt; could be a proper modal later
    const newDate = prompt('New date (YYYY-MM-DD):')
    if (!newDate) return
    api.rescheduleScheduleEvent(lesson.eventID, { date: newDate }).then(() => {
      success('Lesson rescheduled')
      return refetch()
    }).catch((e) => setActionError(e.message))
  }
  const handleRemove = (lesson) => {
    if ((lesson?.eventID || '').startsWith('unscheduled-')) {
      setActionError('Cannot remove an unscheduled placeholder.')
      return
    }
    setActionError(null)
    setPendingRemoveLesson(lesson)
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

  const wrapSection = (inner) => {
    if (sectionClassName && onBookLesson) {
      return (
        <section className={sectionClassName}>
          <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
            <h3 className="font-semibold text-sm">Lessons This Month</h3>
            <button
              type="button"
              onClick={onBookLesson}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer"
            >
              <Calendar className="w-4 h-4" />
              Book lesson
            </button>
          </header>
          {inner}
        </section>
      )
    }
    return inner
  }

  if (loading) {
    return wrapSection(
      <div className="flex flex-1 items-center justify-center text-slate-500 text-sm">
        Loading…
      </div>
    )
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
            const oneRow = count <= 6
            const twoRows = count >= 7
            return (
              <div className="flex flex-1 flex-col justify-center min-h-0 overflow-hidden">
                <div
                  className={`flex flex-col min-h-0 overflow-hidden ${oneRow ? 'h-1/2' : 'flex-1'}`}
                >
                  <div
                    className="lr-cards grid gap-1 py-1 pr-1 h-full w-full overflow-hidden grid-cols-[repeat(auto-fill,minmax(88px,1fr))]"
                    style={twoRows ? { gridTemplateRows: 'repeat(2, 1fr)' } : undefined}
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
          onReschedule={handleReschedule}
          onRemove={handleRemove}
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

  if (sectionClassName && onBookLesson) {
    return (
      <section className={sectionClassName}>
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0">
          <h3 className="font-semibold text-sm">Lessons This Month</h3>
          {monthKeys.length > 0 && monthToggles}
          <button
            type="button"
            onClick={onBookLesson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-blue-700 cursor-pointer shrink-0"
          >
            <Calendar className="w-4 h-4" />
            Book lesson
          </button>
        </header>
        {content}
      </section>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center gap-1 border-b border-gray-200 px-2 py-1.5">
        {monthToggles}
      </div>
      {content}
    </div>
  )
}
