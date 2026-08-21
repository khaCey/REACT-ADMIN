import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarSearch, CheckCircle2, Info, ShieldCheck, Tags, X } from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  applyOneCalendarStudentIdBackfill,
  getCalendarStudentIdBackfillPreview,
} from '../api/calendarStudentIdBackfillApi'
import { getCurrentYyyyMmJst } from '../utils/jstMonth'

const STATUS_META = {
  safe_to_tag: {
    label: 'Ready to tag',
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
  api_error: {
    label: 'API error',
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

function CalendarTagModal({ modal, onClose, onConfirm }) {
  if (!modal.open || !modal.item) return null

  const item = modal.item
  const working = modal.phase === 'working'
  const studentLabel = item.studentNames?.length
    ? item.studentNames.join(', ')
    : item.studentIds?.join(', ') || '—'
  const exactEventId = item.calendarGoogleEventId || item.calendarEventId || item.eventId || '—'

  const title = modal.phase === 'success'
    ? 'Student ID tagged'
    : modal.phase === 'error'
      ? 'Tagging failed'
      : working
        ? 'Tagging Calendar event…'
        : 'Tag this Calendar event?'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-tag-modal-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              modal.phase === 'success'
                ? 'bg-emerald-100 text-emerald-700'
                : modal.phase === 'error'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-emerald-50 text-emerald-700'
            }`}>
              {modal.phase === 'success' ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : modal.phase === 'error' ? (
                <AlertTriangle className="h-5 w-5" />
              ) : working ? (
                <LoadingSpinner size="xs" />
              ) : (
                <Tags className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3 id="calendar-tag-modal-title" className="text-lg font-bold text-gray-900">{title}</h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {modal.phase === 'success'
                  ? 'The exact Calendar event and monthlyLessons mirror were verified.'
                  : modal.phase === 'error'
                    ? 'No success has been recorded for this action.'
                    : working
                      ? 'Please keep this window open while verification completes.'
                      : 'Only this exact Calendar event will be updated.'}
              </p>
            </div>
          </div>
          {!working && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="font-semibold text-gray-900">{item.title || '(untitled)'}</p>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Date & time</p>
                <p className="mt-1 text-gray-700">{formatDateTime(item.start)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Student</p>
                <p className="mt-1 text-gray-700">{studentLabel}</p>
              </div>
            </div>
            <div className="mt-3 border-t border-gray-200 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Exact Google event ID</p>
              <p className="mt-1 break-all font-mono text-[11px] text-gray-600">{exactEventId}</p>
            </div>
          </div>

          {modal.phase === 'confirm' && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-950">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <p>
                Google Calendar is accessed only after you confirm. Only the event description is changed. After exact verification, the <code>monthlyLessons</code> mirror is updated and checked again.
              </p>
            </div>
          )}

          {working && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <LoadingSpinner size="sm" />
              <div>
                <p className="font-semibold">Verifying exact Calendar event</p>
                <p className="mt-0.5 text-blue-800">Writing the student tag and confirming the mirror update…</p>
              </div>
            </div>
          )}

          {modal.phase === 'success' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <p className="font-semibold">Tagging completed successfully.</p>
              <p className="mt-1">
                {modal.result?.tagged ? 'The student ID was added to Calendar.' : 'Calendar already contained the expected student ID.'}
                {' '}The exact event was verified and <code>monthlyLessons</code> was confirmed afterward.
              </p>
            </div>
          )}

          {modal.phase === 'error' && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-semibold">The event was not marked as successfully tagged.</p>
              <p className="mt-1 break-words">{modal.message || 'Failed to tag this Calendar event.'}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50/70 px-5 py-4 sm:flex-row sm:justify-end">
          {modal.phase === 'confirm' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                <Tags className="h-4 w-4" />
                Tag this event
              </button>
            </>
          ) : working ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-500"
            >
              <LoadingSpinner size="xs" />
              Tagging…
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CalendarStudentIdBackfill() {
  const [month, setMonth] = useState(() => getCurrentYyyyMmJst())
  const [loading, setLoading] = useState(false)
  const [applyingOneKey, setApplyingOneKey] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [tagModal, setTagModal] = useState({
    open: false,
    phase: 'confirm',
    item: null,
    message: '',
    result: null,
  })

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

  const openTagModal = (item) => {
    if (!item?.groupKey || item.status !== 'safe_to_tag') return
    setTagModal({
      open: true,
      phase: 'confirm',
      item,
      message: '',
      result: null,
    })
  }

  const closeTagModal = () => {
    if (tagModal.phase === 'working') return
    setTagModal({
      open: false,
      phase: 'confirm',
      item: null,
      message: '',
      result: null,
    })
  }

  const confirmTag = async () => {
    const item = tagModal.item
    if (!item?.groupKey || item.status !== 'safe_to_tag' || tagModal.phase !== 'confirm') return

    setApplyingOneKey(item.groupKey)
    setError('')
    setTagModal((current) => ({ ...current, phase: 'working', message: '', result: null }))

    try {
      const applied = await applyOneCalendarStudentIdBackfill(month, item.groupKey)
      const refreshed = await getCalendarStudentIdBackfillPreview(month)
      setResult(refreshed)
      setTagModal((current) => ({ ...current, phase: 'success', result: applied }))
    } catch (err) {
      setTagModal((current) => ({
        ...current,
        phase: 'error',
        message: err.message || 'Failed to tag this Calendar event',
      }))
    } finally {
      setApplyingOneKey('')
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
    (counts.api_error || 0) +
    (counts.missing_student_id || 0)
  const safeCount = Number(counts.safe_to_tag || 0)
  const busy = loading || !!applyingOneKey

  return (
    <div className="w-full space-y-5 pb-8">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CalendarSearch className="h-6 w-6 text-green-600" />
            Calendar Student ID Backfill
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Check PostgreSQL student IDs against the monthlyLessons mirror and tag only the Calendar events that still need them.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
          <ShieldCheck className="h-4 w-4" />
          DESCRIPTION ONLY
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Calendar access is deliberately restricted.</p>
            <p className="mt-1">
              Preview reads PostgreSQL and the <code>monthlyLessons</code> mirror only. Google Calendar is contacted only when you click <strong>Tag this event</strong>. After the exact event is verified, its student ID is saved back into the mirror.
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
              onChange={(e) => {
                setMonth(e.target.value)
                setResult(null)
              }}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={runPreview}
            disabled={busy || !/^\d{4}-\d{2}$/.test(month)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <LoadingSpinner size="xs" /> : <CalendarSearch className="h-4 w-4" />}
            {loading ? 'Loading Sheet…' : 'Run preview'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </section>

      {result && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cached lesson events</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{result.lessonEventsScanned || 0}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ready to tag</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{safeCount}</p>
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
                <h3 className="font-semibold text-gray-900">monthlyLessons preview</h3>
                <p className="text-xs text-gray-500">
                  {result.monthlyScheduleRows || 0} PostgreSQL rows and {result.sheetRows || 0} mirror rows checked for {result.month}. No Calendar fetch is performed here.
                </p>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                disabled={busy}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-50"
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
                      <th className="px-4 py-3">Expected student IDs</th>
                      <th className="px-4 py-3">Sheet student IDs</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Action</th>
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
                          <p className="font-mono text-xs text-gray-900">{item.sheetStudentIds?.join(', ') || '—'}</p>
                          {item.description && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium text-gray-500">Verified Calendar description</summary>
                              <pre className="mt-2 max-w-sm whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-[11px] text-gray-600">{item.description}</pre>
                            </details>
                          )}
                        </td>
                        <td className="min-w-[18rem] px-4 py-3 text-xs text-gray-600">{item.reason}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {item.status === 'safe_to_tag' ? (
                            <button
                              type="button"
                              onClick={() => openTagModal(item)}
                              disabled={busy}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {applyingOneKey === item.groupKey ? <LoadingSpinner size="xs" /> : <Tags className="h-3.5 w-3.5" />}
                              {applyingOneKey === item.groupKey ? 'Tagging…' : 'Tag this event'}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
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
              <strong>Run preview</strong> compares PostgreSQL student IDs with the <code>monthlyLessons</code> mirror. Blank mirror IDs mean ready to tag; matching IDs mean already tagged. <strong>Tag this event</strong> is the only action that contacts Google Calendar.
            </p>
          </div>

          {issueCount === 0 && safeCount > 0 && (
            <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <p>The mirror has no blocking mismatches for these rows. Calendar-side validation still happens when each event is tagged.</p>
            </div>
          )}
        </>
      )}

      <CalendarTagModal
        modal={tagModal}
        onClose={closeTagModal}
        onConfirm={confirmTag}
      />
    </div>
  )
}
