/**
 * Calendar Events modal — compare this month’s Google Calendar snapshot to local
 * monthly_schedule, then add missing / remove local-only rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Calendar, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import { getCurrentYyyyMmJst } from '../utils/jstMonth'
import ModalLoadingOverlay from './ModalLoadingOverlay'

function formatReconcileLessonWhen(row) {
  const dateStr = row?.date ? String(row.date).slice(0, 10) : '—'
  if (!row?.start) return dateStr
  const d = new Date(row.start)
  if (Number.isNaN(d.getTime())) return dateStr
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${dateStr} ${timeStr}`
}

function reconcileRowKey(row) {
  return `${row?.event_id || ''}\t${row?.student_name || ''}`
}

function applyComparePayload(prev, res) {
  return {
    ...(prev || {}),
    month: res.month,
    missing: res.missing || [],
    disappeared: res.disappeared || [],
    calendar_only: res.calendar_only || res.missing || [],
    local_only: res.local_only || res.disappeared || [],
    calendarCount: res.calendarCount,
    localCount: res.localCount,
    fetched: res.fetched,
  }
}

function ReconcileLessonTable({
  rows,
  emptyText,
  headClassName,
  onAddRow,
  onRemoveRow,
  rowBusyKey,
  disableActions,
}) {
  const list = Array.isArray(rows) ? rows : []
  const showAdd = typeof onAddRow === 'function'
  const showRemove = typeof onRemoveRow === 'function'
  const showAction = showAdd || showRemove
  return (
    <div className="max-h-56 overflow-auto">
      <table className="min-w-full text-sm">
        <thead className={`sticky top-0 ${headClassName}`}>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Student</th>
            <th className="px-3 py-2">Teacher</th>
            {showAction ? <th className="px-3 py-2 text-right">Action</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {list.length === 0 ? (
            <tr>
              <td
                colSpan={3 + (showAction ? 1 : 0)}
                className="px-3 py-6 text-center text-gray-500"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            list.map((row, i) => {
              const key = reconcileRowKey(row)
              const busy = rowBusyKey === key
              return (
                <tr key={`${key}-${i}`}>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                    {formatReconcileLessonWhen(row)}
                  </td>
                  <td className="px-3 py-2">{row.student_name || '—'}</td>
                  <td className="px-3 py-2">
                    {row.teacher_name || '—'}
                    {row.dismissed ? (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        Was removed
                      </span>
                    ) : null}
                  </td>
                  {showAction ? (
                    <td className="px-3 py-2 text-right">
                      {showAdd ? (
                        <button
                          type="button"
                          disabled={disableActions || busy || !row.event_id || !row.student_name}
                          onClick={() => onAddRow(row)}
                          className="px-2 py-1 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 cursor-pointer disabled:opacity-50"
                        >
                          {busy ? 'Adding…' : 'Add to local'}
                        </button>
                      ) : null}
                      {showRemove ? (
                        <button
                          type="button"
                          disabled={disableActions || busy || !row.event_id || !row.student_name}
                          onClick={() => onRemoveRow(row)}
                          className="px-2 py-1 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          {busy ? 'Removing…' : 'Remove from local'}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function CalendarEventsModal({ onClose, onApplied }) {
  const { success } = useToast()
  const month = getCurrentYyyyMmJst()
  const [compareLoading, setCompareLoading] = useState(true)
  const [applyLoading, setApplyLoading] = useState('')
  const [rowBusy, setRowBusy] = useState('')
  const [error, setError] = useState('')
  const [compare, setCompare] = useState(null)
  const [applyResult, setApplyResult] = useState(null)

  const runCompare = useCallback(async () => {
    setError('')
    setApplyResult(null)
    setCompareLoading(true)
    try {
      const res = await api.reconcileCalendarMonth({ month, action: 'compare' })
      setCompare(applyComparePayload(null, res))
    } catch (err) {
      setError(err.message || 'Compare failed')
      setCompare(null)
    } finally {
      setCompareLoading(false)
    }
  }, [month])

  useEffect(() => {
    runCompare()
  }, [runCompare])

  const busy = compareLoading || !!applyLoading || !!rowBusy

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-xl border border-gray-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {busy && <ModalLoadingOverlay className="rounded-xl" />}
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-green-600" />
              Calendar Events
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Compare {month} Google Calendar with local schedule — add missing or remove local-only.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={runCompare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${compareLoading ? 'animate-spin' : ''}`} />
              {compareLoading ? 'Comparing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {error && (
            <p className="text-sm text-red-600 rounded-lg border border-red-200 bg-red-50 px-3 py-2">{error}</p>
          )}
          {applyResult && (
            <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Last apply ({applyResult.action}): local {applyResult.localBefore ?? '—'} →{' '}
              {applyResult.localAfter ?? '—'}
              {applyResult.action === 'add'
                ? ` · added ~${applyResult.added ?? 0}`
                : ` · removed ${applyResult.removed ?? 0}`}
            </p>
          )}

          {compare && (
            <>
              <p className="text-sm text-gray-700">
                <strong>{compare.month}</strong>: Calendar {compare.calendarCount ?? 0} · local{' '}
                {compare.localCount ?? 0} · calendar only{' '}
                <strong className="text-amber-700">
                  {(compare.calendar_only || compare.missing)?.length ?? 0}
                </strong>{' '}
                · local only{' '}
                <strong className="text-red-700">
                  {(compare.local_only || compare.disappeared)?.length ?? 0}
                </strong>
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50/40 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-amber-200">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">
                        Calendar only ({(compare.calendar_only || compare.missing)?.length ?? 0})
                      </h4>
                      <p className="text-xs text-gray-500">
                        On Calendar, not in local — add these. Rows marked “Was removed” were deleted in-app earlier
                        (dismissal); Add clears that and restores them.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        busy || !((compare.calendar_only || compare.missing)?.length > 0)
                      }
                      onClick={async () => {
                        setError('')
                        setApplyLoading('add')
                        try {
                          const res = await api.reconcileCalendarMonth({ month, action: 'add' })
                          setApplyResult(res)
                          setCompare((prev) => applyComparePayload(prev, res))
                          success(`Added missing lessons for ${res.month} (~${res.added ?? 0})`)
                          onApplied?.(res)
                        } catch (err) {
                          setError(err.message || 'Add missing failed')
                        } finally {
                          setApplyLoading('')
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 cursor-pointer disabled:opacity-50"
                    >
                      {applyLoading === 'add' ? 'Adding…' : 'Add to local'}
                    </button>
                  </div>
                  <ReconcileLessonTable
                    rows={compare.calendar_only || compare.missing}
                    emptyText="None — local has everything from Calendar"
                    headClassName="bg-amber-50"
                    disableActions={busy}
                    rowBusyKey={rowBusy}
                    onAddRow={async (row) => {
                      const key = reconcileRowKey(row)
                      setError('')
                      setRowBusy(key)
                      try {
                        const res = await api.reconcileCalendarMonth({
                          month,
                          action: 'add',
                          entries: [
                            {
                              event_id: row.event_id,
                              student_name: row.student_name,
                            },
                          ],
                        })
                        setApplyResult(res)
                        setCompare((prev) => applyComparePayload(prev, res))
                        success(`Added ${row.student_name || 'lesson'} to local`)
                        onApplied?.(res)
                      } catch (err) {
                        setError(err.message || 'Add to local failed')
                      } finally {
                        setRowBusy('')
                      }
                    }}
                  />
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50/40 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-red-200">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">
                        Local only ({(compare.local_only || compare.disappeared)?.length ?? 0})
                      </h4>
                      <p className="text-xs text-gray-500">In local, not on Calendar — remove these</p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        busy || !((compare.local_only || compare.disappeared)?.length > 0)
                      }
                      onClick={async () => {
                        setError('')
                        setApplyLoading('remove')
                        try {
                          const res = await api.reconcileCalendarMonth({ month, action: 'remove' })
                          setApplyResult(res)
                          setCompare((prev) => applyComparePayload(prev, res))
                          success(`Removed ${res.removed ?? 0} local-only lessons for ${res.month}`)
                          onApplied?.(res)
                        } catch (err) {
                          setError(err.message || 'Remove local-only failed')
                        } finally {
                          setApplyLoading('')
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-50"
                    >
                      {applyLoading === 'remove' ? 'Removing…' : 'Remove from local'}
                    </button>
                  </div>
                  <ReconcileLessonTable
                    rows={compare.local_only || compare.disappeared}
                    emptyText="None — no extra local synced rows"
                    headClassName="bg-red-50"
                    showSource={false}
                    disableActions={busy}
                    rowBusyKey={rowBusy}
                    onRemoveRow={async (row) => {
                      const key = reconcileRowKey(row)
                      setError('')
                      setRowBusy(key)
                      try {
                        const res = await api.reconcileCalendarMonth({
                          month,
                          action: 'remove',
                          entries: [
                            {
                              event_id: row.event_id,
                              student_name: row.student_name,
                            },
                          ],
                        })
                        setApplyResult(res)
                        setCompare((prev) => applyComparePayload(prev, res))
                        success(`Removed ${row.student_name || 'lesson'} from local`)
                        onApplied?.(res)
                      } catch (err) {
                        setError(err.message || 'Remove from local failed')
                      } finally {
                        setRowBusy('')
                      }
                    }}
                  />
                </div>
              </div>
            </>
          )}

          {!compare && !compareLoading && !error && (
            <p className="text-sm text-gray-500 text-center py-8">No compare data yet. Click Refresh.</p>
          )}
        </div>
      </div>
    </div>
  )
}
