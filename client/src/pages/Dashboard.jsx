import { useState, useEffect, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { LayoutDashboard, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from '../components/StudentDetailsModal'
import FullPageLoading from '../components/FullPageLoading'

function formatMonthLabel(yyyyMm) {
  if (!yyyyMm) return ''
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** Merge three per-month series into one array: { month, label, regularStudents, demoLessons, studentsJoined } */
function mergeMetrics(metrics) {
  if (!metrics) return []
  const regular = new Map((metrics.regularStudentsPerMonth || []).map((d) => [d.month, d.count]))
  const demo = new Map((metrics.demoLessonsPerMonth || []).map((d) => [d.month, d.count]))
  const joined = new Map((metrics.studentsJoinedPerMonth || []).map((d) => [d.month, d.count]))
  const months = [
    ...new Set([
      ...regular.keys(),
      ...demo.keys(),
      ...joined.keys(),
    ]),
  ].sort()
  return months.map((month) => ({
    month,
    label: formatMonthLabel(month),
    regularStudents: regular.get(month) ?? 0,
    demoLessons: demo.get(month) ?? 0,
    studentsJoined: joined.get(month) ?? 0,
  }))
}

function formatJapaneseDateLabel(yyyyMmDd) {
  if (!yyyyMmDd) return ''
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const w = weekdays[date.getDay()] || ''
  return `${w} - ${m}月${d}日`
}

function getHourLabel(startTime) {
  if (!startTime || typeof startTime !== 'string') return null
  const trimmed = startTime.trim()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = String(parseInt(match[1], 10)).padStart(2, '0')
  return `${hour}:00`
}

const HOURLY_TIMELINE = Array.from({ length: 11 }, (_, i) => `${String(10 + i).padStart(2, '0')}:00`)

const MIN_CHART_END_MONTH = '2015-01'
const CHART_RANGE_YEARS_OPTIONS = [1, 2, 3, 4, 5]

function getCurrentMonthYYYYMM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Subtract n months from YYYY-MM, return YYYY-MM */
function subtractMonths(yyyyMm, n) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Add one month to YYYY-MM, return YYYY-MM */
function addOneMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatEndMonthLabel(yyyyMm) {
  if (!yyyyMm) return ''
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function groupLessonsByHour(lessons) {
  const groups = new Map()
  for (const lesson of lessons || []) {
    const label = getHourLabel(lesson.start_time)
    if (label) {
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(lesson)
    }
  }
  const timelineSet = new Set(HOURLY_TIMELINE)
  const extraHours = [...groups.keys()].filter((h) => !timelineSet.has(h)).sort()
  const orderedHours = [...HOURLY_TIMELINE, ...extraHours]
  return orderedHours.map((hour) => [hour, groups.get(hour) || []])
}

/** Group lessons that share the same event_id (one slot = one card: group or individual). */
function slotsByEventId(lessons) {
  if (!lessons || lessons.length === 0) return []
  const byEvent = new Map()
  for (const lesson of lessons) {
    const id = lesson.event_id || `single-${lesson.student_name}-${lesson.start_time}`
    if (!byEvent.has(id)) byEvent.set(id, [])
    byEvent.get(id).push(lesson)
  }
  return [...byEvent.values()]
}

function lessonModeBadgeClass(mode) {
  const normalized = String(mode || 'unknown').toLowerCase()
  if (normalized === 'cafe') return 'bg-amber-100 text-amber-800'
  if (normalized === 'online') return 'bg-blue-100 text-blue-800'
  return 'bg-slate-100 text-slate-700'
}

function lessonModeLabel(mode) {
  const normalized = String(mode || 'unknown').toLowerCase()
  if (normalized === 'cafe') return 'Cafe'
  if (normalized === 'online') return 'Online'
  return ''
}

export default function Dashboard() {
  const currentMonth = getCurrentMonthYYYYMM()
  const [chartEndMonth, setChartEndMonth] = useState(() => currentMonth)
  const [chartRangeYears, setChartRangeYears] = useState(1)
  const [metrics, setMetrics] = useState(null)
  const [todayLessons, setTodayLessons] = useState([])
  const [todayDate, setTodayDate] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError('')
    const monthsBack = chartRangeYears * 12 - 1
    const from = subtractMonths(chartEndMonth, monthsBack)
    const to = chartEndMonth
    try {
      const [metricsData, todayData] = await Promise.all([
        api.getDashboardMetrics(from, to),
        api.getTodayLessons(),
      ])
      setMetrics(metricsData)
      setTodayLessons(Array.isArray(todayData?.lessons) ? todayData.lessons : [])
      setTodayDate(todayData?.date || '')
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data')
      setMetrics(null)
      setTodayLessons([])
      setTodayDate('')
    } finally {
      setLoading(false)
    }
  }, [chartEndMonth, chartRangeYears])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  const showPaymentBadges = (lesson) =>
    lesson.is_last_lesson_of_month === true || lesson.is_last_lesson_of_month === 't'

  const isDemoLesson = (lesson) =>
    (lesson.lesson_kind || '').toString().trim().toLowerCase() === 'demo'

  if (loading) {
    return <FullPageLoading />
  }

  return (
    <div className="w-full flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-green-600" />
          Dashboard
        </h2>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchDashboard}
            className="text-red-700 underline font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {metrics ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full min-h-0">
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm h-full min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold text-gray-900">Today's lessons</h3>
              <p className="text-xl font-semibold text-gray-700">
                {todayDate ? formatJapaneseDateLabel(todayDate) : ''}
              </p>
            </div>
            {todayLessons.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No lessons scheduled for today.</p>
            ) : (
              <div className="space-y-0 flex-1 min-h-0 overflow-y-auto pr-1">
                {groupLessonsByHour(todayLessons).map(([hourLabel, lessons]) => {
                  const slots = slotsByEventId(lessons)
                  return (
                  <div key={hourLabel} className="h-[60px] p-0 m-0 flex items-start border-b border-gray-100">
                    <div className="w-14 h-[60px] leading-[60px] text-sm font-semibold text-gray-700 p-0 m-0">
                      {hourLabel}
                    </div>
                    <div className="flex-1 h-[60px] p-0 m-0">
                      {slots.length > 0 ? (
                        <div className="grid grid-cols-4 gap-1 h-[50px]">
                          {slots.map((slot, idx) => {
                            const lesson = slot.length === 1
                              ? slot[0]
                              : {
                                  event_id: slot[0].event_id,
                                  student_name: slot.map((l) => l.student_name).join(', '),
                                  student_id: slot[0].student_id,
                                  paid_this_month: slot.every((l) => l.paid_this_month),
                                  is_last_lesson_of_month: slot[0].is_last_lesson_of_month,
                                  lesson_mode: slot[0].lesson_mode,
                                  lesson_kind: slot[0].lesson_kind,
                                }
                            const isGroupSlot = slot.length > 1
                            const n = slots.length
                            let colSpan
                            if (n === 1) colSpan = 'col-span-4'
                            else if (n === 2) colSpan = 'col-span-2'
                            else if (n === 3) colSpan = idx < 2 ? 'col-span-1' : 'col-span-2'
                            else colSpan = 'col-span-1'
                            return (
                            <article
                              key={lesson.event_id + (slot.length > 1 ? '_group' : '_' + lesson.student_name)}
                              role={lesson.student_id ? 'button' : undefined}
                              tabIndex={lesson.student_id ? 0 : -1}
                              onClick={() => {
                                if (!lesson.student_id) return
                                setSelectedStudentId(lesson.student_id)
                              }}
                              onKeyDown={(e) => {
                                if (!lesson.student_id) return
                                if (e.key === 'Enter') setSelectedStudentId(lesson.student_id)
                              }}
                              className={`dashboard-lesson-card h-[50px] rounded border flex items-center justify-between overflow-hidden ${isGroupSlot ? 'px-1' : 'px-2'} ${colSpan} border-gray-200 bg-gray-50 ${lesson.student_id ? 'cursor-pointer hover:bg-white' : ''}`}
                            >
                              <span className="dashboard-lesson-card-name font-semibold text-gray-900 min-w-0">
                                {isGroupSlot ? `グループ: ${lesson.student_name}` : lesson.student_name}
                              </span>
                              <div className="flex items-center gap-1">
                                {lessonModeLabel(lesson.lesson_mode) && (
                                  <span className={`dashboard-lesson-card-badge inline-flex rounded font-medium ${isGroupSlot ? 'px-1 py-0' : 'px-1.5 py-0'} ${lessonModeBadgeClass(lesson.lesson_mode)}`}>
                                    {lessonModeLabel(lesson.lesson_mode)}
                                  </span>
                                )}
                                {!isDemoLesson(lesson) && (
                                <span
                                  className={`dashboard-lesson-card-badge inline-flex rounded font-medium ${isGroupSlot ? 'px-1 py-0' : 'px-1.5 py-0'} ${lesson.paid_this_month ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
                                >
                                  {lesson.paid_this_month ? 'お月謝済' : 'お月謝未'}
                                </span>
                                )}
                                {!isDemoLesson(lesson) && showPaymentBadges(lesson) && todayDate && (
                                  <span
                                    className={`dashboard-lesson-card-badge inline-flex rounded font-medium ${isGroupSlot ? 'px-1 py-0' : 'px-1.5 py-0'} bg-slate-100 text-slate-700`}
                                  >
                                    {(() => {
                                      const [y, m] = todayDate.slice(0, 10).split('-').map(Number)
                                      const next = new Date(y, m, 1)
                                      return `${next.getMonth() + 1}月分のお月謝`
                                    })()}
                                  </span>
                                )}
                              </div>
                            </article>
                          )})}
                        </div>
                      ) : (
                        <div className="h-[50px] rounded border border-dashed border-gray-200 bg-gray-50/60 px-2 flex items-center">
                          <span className="text-xs text-gray-400">No lessons</span>
                        </div>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 pb-8 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h3 className="text-lg font-semibold text-gray-900">
                Metrics per month ({chartRangeYears} {chartRangeYears === 1 ? 'year' : 'years'} ending {formatEndMonthLabel(chartEndMonth)})
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-600">Range:</span>
                <select
                  value={chartRangeYears}
                  onChange={(e) => setChartRangeYears(Number(e.target.value))}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
                >
                  {CHART_RANGE_YEARS_OPTIONS.map((years) => (
                    <option key={years} value={years}>
                      {years} {years === 1 ? 'year' : 'years'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setChartEndMonth((m) => (m <= MIN_CHART_END_MONTH ? m : subtractMonths(m, 1)))}
                  disabled={chartEndMonth <= MIN_CHART_END_MONTH}
                  className="p-1.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="min-w-[5.5rem] text-center text-sm font-medium text-gray-900">
                  {formatEndMonthLabel(chartEndMonth)}
                </span>
                <button
                  type="button"
                  onClick={() => setChartEndMonth((m) => (m >= currentMonth ? m : addOneMonth(m)))}
                  disabled={chartEndMonth >= currentMonth}
                  className="p-1.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Students (with at least one regular lesson), demo lessons, and students who made their first payment in that month.
            </p>
            {mergeMetrics(metrics).length === 0 ? (
              <p className="text-sm text-gray-500 py-8">No data for this period.</p>
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={mergeMetrics(metrics)}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="regularStudents"
                      name="Students"
                      stroke="#16a34a"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="demoLessons"
                      name="Demo lessons"
                      stroke="#d50000"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="studentsJoined"
                      name="Joined"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {selectedStudentId != null && (
        <StudentDetailsModal
          studentId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          onStudentDeleted={fetchDashboard}
          onStudentUpdated={fetchDashboard}
        />
      )}
    </div>
  )
}
