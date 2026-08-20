import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarSearch, CheckCircle2, Info, ShieldCheck } from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'
import { getCalendarStudentIdBackfillPreview } from '../api/calendarStudentIdBackfillApi'
import { getCurrentYyyyMmJst } from '../utils/jstMonth'

const STATUS_META = {
  safe_to_tag: {
    label: 'Safe to tag',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  already_tagged: {
    label: 'Already tagged',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  tag_mismatch: {
    label: 'ID mismatch',
    className: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  calendar_missing: {
    label: 'Calendar missing',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  ambiguous_calendar_match: {
    label: 'Ambiguous',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  not_synced: {
    label: 'Not synced',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  local_only: {
    label: 'Local only',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  missing_student_id: {
    label: 'Missing student ID',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || {
    label: status || 'Unknown',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

export default function CalendarStudentIdBackfill() {
  const [month, setMonth] = useState(() => getCurrentYyyyMmJst())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')

  const runPreview = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getCalendarStudentIdBackfillPreview(month)
      setResult(data)
    } catch (err) {
      setResult(null)
      setError(err.message || 'Failed to build preview')
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = useMemo(() => {
    const items = Array.isArray(result?.items) ? result.items : []
    if (!statusFilter) return items
    return items.filter((item) => item.status === statusFilter)
  }, [result, statusFilter])

  const counts = result?.counts || {}
  const issueCount =
    (counts.tag_mismatch || 0) +
    (counts.calendar_missing || 0) +
    (counts.ambiguous_calendar_match || 0) +
    (counts.missing_student_id || 0)

  return (
    <div className="w-full space-y-5 pb-8">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CalendarSearch className="h-6 w-6 text-green-600" />
            Calendar Student ID Backfill
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Read-only migration preview for matching monthly_schedule student IDs to existing Google Calendar events.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
          <ShieldCheck className="h-4 w-4" />
          READ ONLY
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">This page cannot modify Google Calendar.</p>
            <p className="mt-1">
              It uses Calendar read-only access and only reports which events would be safe to tag later. No create, update, patch, or delete operation is available here.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
            />
          </label>
          <button
            type="button"
            onClick={runPreview}
            disabled={loading || !/^\d{4}-\d{2}$/.test(month)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <LoadingSpinner size="xs" /> : <CalendarSearch className="h-4 w-4" />}
            {loading ? 'Scanning…' : 'Run read-only preview'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </section>

      {result && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Calendar events fetched</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{result.calendarEventsFetched || 0}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Safe to tag later</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{counts.safe_to_tag || 0}</p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Already tagged</p>
              <p className="mt-1 text-2xl font-bold text-blue-900">{counts.already_tagged || 0}</p>
            </div>
            <div className={`rounded-lg border p-4 shadow-sm ${issueCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${issueCount > 0 ? 'text-amber-700' : 'text-gray-500'}`}>Needs review</p>
              <p className={`mt-1 text-2xl font-bold ${issueCount > 0 ? 'text-amber-900' : 'text-gray-900'}`}>{issueCount}</p>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Preview results</h3>
                <p className="text-xs text-gray-500">
                  {result.monthlyScheduleRows || 0} monthly_schedule rows scanned for {result.month}.
                </p>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
            </div>

            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No matching preview rows.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Event</th>
                      <th className="px-4 py-3">Student IDs</th>
                      <th className="px-4 py-3">Calendar IDs</th>
                      <th className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {filteredItems.map((item, index) => (
                      <tr key={`${item.calendarEventId || item.eventId || 'row'}-${index}`} className="align-top">
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="min-w-[18rem] px-4 py-3">
                          <p className="font-semibold text-gray-900">{item.title || '(untitled)'}</p>
                          <p className="mt-1 text-xs text-gray-500">{formatDateTime(item.start)}</p>
                          <p className="mt-1 break-all font-mono text-[11px] text-gray-400">{item.calendarEventId || item.eventId || '—'}</p>
                        </td>
                        <td className="min-w-[10rem] px-4 py-3">
                          <p className="font-mono text-xs text-gray-900">{item.studentIds?.join(', ') || '—'}</p>
                          {item.studentNames?.length > 0 && (
                            <p className="mt-1 text-xs text-gray-500">{item.studentNames.join(', ')}</p>
                          )}
                        </td>
                        <td className="min-w-[10rem] px-4 py-3">
                          <p className="font-mono text-xs text-gray-900">{item.calendarStudentIds?.join(', ') || '—'}</p>
                          {item.description && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium text-gray-500">Current description</summary>
                              <pre className="mt-2 max-w-sm whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-[11px] text-gray-600">{item.description}</pre>
                            </details>
                          )}
                        </td>
                        <td className="min-w-[18rem] px-4 py-3 text-xs text-gray-600">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <Info className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              Only <strong>Safe to tag</strong> rows should ever be eligible for the later write phase. Mismatches, missing Calendar events, local-only rows, and ambiguous matches must remain skipped until reviewed.
            </p>
          </div>

          {issueCount === 0 && (counts.safe_to_tag || 0) > 0 && (
            <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <p>The preview found no blocking mismatches in this month. No Calendar data has been changed.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
