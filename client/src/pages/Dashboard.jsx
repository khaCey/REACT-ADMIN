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
import { LayoutDashboard } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from '../components/StudentDetailsModal'

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
  return `${w} - ${d}日${m}月`
}

function getHourLabel(startTime) {
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return '時間未設定'
  return `${startTime.slice(0, 2)}:00`
}

const HOURLY_TIMELINE = Array.from({ length: 11 }, (_, i) => `${String(10 + i).padStart(2, '0')}:00`)

function groupLessonsByHour(lessons) {
  const groups = new Map()
  for (const lesson of lessons || []) {
    const label = getHourLabel(lesson.start_time)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(lesson)
  }
  return HOURLY_TIMELINE.map((hour) => [hour, groups.get(hour) || []])
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
  const [metrics, setMetrics] = useState(null)
  const [todayLessons, setTodayLessons] = useState([])
  const [todayDate, setTodayDate] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [metricsData, todayData] = await Promise.all([
        api.getDashboardMetrics(),
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
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  return (
    <div className="w-full flex flex-col h-full min-h-0 overflow-y-auto pr-1">
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

      {loading ? (
        <p className="py-8 text-gray-500">Loading…</p>
      ) : metrics ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold text-gray-900">Today's lessons</h3>
              <p className="text-xl font-semibold text-gray-700">
                {todayDate ? formatJapaneseDateLabel(todayDate) : ''}
              </p>
            </div>
            {todayLessons.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No lessons scheduled for today.</p>
            ) : (
              <div className="space-y-4">
                {groupLessonsByHour(todayLessons).map(([hourLabel, lessons]) => (
                  <div key={hourLabel}>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">{hourLabel}</h4>
                    {lessons.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 text-xs text-gray-400">
                        No lessons
                      </div>
                    ) : (
                      <div className={lessons.length === 1 ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
                        {lessons.map((lesson) => (
                          <article
                            key={`${lesson.event_id}_${lesson.student_name}`}
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
                            className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 ${
                              lesson.student_id ? 'cursor-pointer hover:bg-white hover:shadow-sm' : ''
                            }`}
                          >
                            <p className="text-sm font-semibold text-gray-900 truncate">{lesson.student_name}</p>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs text-gray-600 truncate">{lesson.status || 'scheduled'}</span>
                              <div className="flex items-center gap-1.5">
                                {lessonModeLabel(lesson.lesson_mode) && (
                                  <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${lessonModeBadgeClass(lesson.lesson_mode)}`}>
                                    {lessonModeLabel(lesson.lesson_mode)}
                                  </span>
                                )}
                                <span
                                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                                    lesson.paid_this_month ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                  }`}
                                >
                                  {lesson.paid_this_month ? 'お月謝済' : 'お月謝未'}
                                </span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Metrics per month</h3>
            <p className="text-sm text-gray-500 mb-4">
              Regular students (with at least one regular lesson), demo lessons, and students who made their first payment in that month.
            </p>
            {mergeMetrics(metrics).length === 0 ? (
              <p className="text-sm text-gray-500 py-8">No data for this period.</p>
            ) : (
              <div className="h-40 w-full">
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
                      name="Regular students"
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
