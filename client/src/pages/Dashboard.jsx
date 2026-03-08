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

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getDashboardMetrics()
      setMetrics(data)
    } catch (err) {
      setError(err.message || 'Failed to load dashboard metrics')
      setMetrics(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  return (
    <div className="w-full flex flex-col h-full min-h-0">
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
            onClick={fetchMetrics}
            className="text-red-700 underline font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-8 text-gray-500">Loading…</p>
      ) : metrics ? (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Metrics per month</h3>
          <p className="text-sm text-gray-500 mb-4">
            Regular students (with at least one regular lesson), demo lessons, and students who made their first payment in that month.
          </p>
          {mergeMetrics(metrics).length === 0 ? (
            <p className="text-sm text-gray-500 py-8">No data for this period.</p>
          ) : (
            <div className="h-80 w-full">
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
                    name="First payment (joined)"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
