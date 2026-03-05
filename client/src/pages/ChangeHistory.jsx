import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { History, Download } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import BackfillScheduleModal from '../components/BackfillScheduleModal'

const ENTITY_LABELS = {
  students: 'Student',
  payments: 'Payment',
  notes: 'Note',
  lessons: 'Lesson count',
  monthly_schedule: 'Schedule',
}

const ACTION_LABELS = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  redo: 'Redone',
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const FIELD_LABELS = {
  name: 'Name',
  name_kanji: 'Kanji',
  email: 'Email',
  phone: 'Phone',
  phone_secondary: 'Phone (secondary)',
  same_day_cancel: '当日',
  status: 'Status',
  payment: 'Payment',
  group_type: 'Group',
  group_size: '人数',
  is_child: 'Child',
  student_id: 'Student ID',
  transaction_id: 'Transaction ID',
  year: 'Year',
  month: 'Month',
  amount: 'Amount',
  discount: 'Discount',
  total: 'Total',
  date: 'Date',
  method: 'Method',
  staff: 'Staff',
  note: 'Note',
  lessons: 'Lessons',
  event_id: 'Event ID',
  title: 'Title',
  start: 'Start',
  end: 'End',
  student_name: 'Student',
  is_kids_lesson: 'Kids lesson',
  teacher_name: 'Teacher',
}

function getEntityDisplayLabel(change) {
  if (!change) return null
  const oldData = change.old_data
  const newData = change.new_data
  const getVal = (obj, ...keys) => {
    if (!obj) return null
    for (const k of keys) {
      const v = obj[k]
      if (v != null && v !== '') return String(v)
    }
    return null
  }
  if (change.entity_type === 'students') {
    return getVal(oldData, 'name', 'Name') ?? getVal(newData, 'name', 'Name')
      ?? (change.entity_label && change.entity_label !== change.entity_key ? change.entity_label : null)
      ?? change.entity_key
  }
  if (change.entity_type === 'monthly_schedule') {
    return getVal(oldData, 'student_name', 'studentName') ?? getVal(newData, 'student_name', 'studentName')
      ?? change.entity_key
  }
  if (change.entity_label && change.entity_label !== change.entity_key) return change.entity_label
  return change.entity_key
}

function getChangeDiffs(oldData, newData, action) {
  const skip = new Set(['created_at', 'updated_at'])
  const oldObj = oldData && typeof oldData === 'object' ? oldData : {}
  const newObj = newData && typeof newData === 'object' ? newData : {}
  const diffs = []
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  for (const k of allKeys) {
    if (skip.has(k)) continue
    const ov = oldObj[k]
    const nv = newObj[k]
    const oStr = ov === null || ov === undefined ? '' : String(ov)
    const nStr = nv === null || nv === undefined ? '' : String(nv)
    const label = FIELD_LABELS[k] || k
    if (action === 'create' && nStr) {
      diffs.push({ field: label, oldValue: null, newValue: nStr })
    } else if (action === 'delete' && oStr) {
      diffs.push({ field: label, oldValue: oStr, newValue: null })
    } else if (action === 'update' && oStr !== nStr) {
      diffs.push({ field: label, oldValue: oStr, newValue: nStr })
    }
  }
  return diffs
}

function ChangeDetailsModal({ change, onClose, onUndo, onRedo, highlightToggle = false }) {
  const [toggling, setToggling] = useState(false)
  const [actionError, setActionError] = useState(null)

  if (!change) return null

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const isUndone = !!change.is_undone

  const handleToggle = async () => {
    setActionError(null)
    setToggling(true)
    try {
      if (isUndone) {
        await onRedo?.(change)
      } else {
        await onUndo?.(change)
      }
    } catch (e) {
      setActionError(e.message || (isUndone ? 'Redo failed' : 'Undo failed'))
    } finally {
      setToggling(false)
    }
  }

  const canToggle = !['undo', 'redo'].includes(change.action)
  const diffs = getChangeDiffs(change.old_data, change.new_data, change.action)
  const hasDiffs = diffs.length > 0

  const renderJson = (obj) => {
    if (obj == null) return <span className="text-gray-400 italic">—</span>
    return (
      <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-x-auto max-h-32 overflow-y-auto font-mono text-gray-600">
        {JSON.stringify(obj, null, 2)}
      </pre>
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">Change details</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="p-4 overflow-auto space-y-5">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
              {actionError}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="min-w-0">
              <span className="text-gray-500 text-xs uppercase tracking-wide">Time</span>
              <p className="font-medium text-gray-900 truncate">{formatDateTime(change.created_at)}</p>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 text-xs uppercase tracking-wide">Entity</span>
              <p className="font-medium text-gray-900 truncate">
                {ENTITY_LABELS[change.entity_type] || change.entity_type}{' '}
                <span className="text-gray-600 font-normal">
                  ({getEntityDisplayLabel(change)})
                </span>
              </p>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 text-xs uppercase tracking-wide">Action</span>
              <span
                className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                  change.action === 'create'
                    ? 'bg-emerald-100 text-emerald-800'
                    : change.action === 'delete'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {ACTION_LABELS[change.action] || change.action}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-gray-500 text-xs uppercase tracking-wide">Staff</span>
              <p className="font-medium text-gray-900 truncate">{change.staff_name || '—'}</p>
            </div>
          </div>

          {hasDiffs && (
            <div>
              <h4 className="text-gray-700 font-medium text-sm mb-3">Summary</h4>
              <div className="space-y-2">
                {diffs.map((d, i) => {
                  const isMemoOrPayment =
                    change.entity_type === 'notes' || change.entity_type === 'payments'
                  const stripe =
                    isMemoOrPayment && i % 2 === 1 ? 'bg-slate-200' : 'bg-gray-50'
                  return (
                  <div
                    key={i}
                    className={`flex flex-wrap items-center gap-2 py-2.5 px-3 rounded-lg ${stripe} border border-gray-100`}
                  >
                    <span className="text-gray-600 font-medium text-sm shrink-0 w-28">
                      {d.field}
                    </span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {d.oldValue != null ? (
                        <span className="px-2 py-0.5 rounded text-sm bg-red-50 text-red-700 line-through">
                          {d.oldValue}
                        </span>
                      ) : null}
                      {d.oldValue != null && d.newValue != null && (
                        <span className="text-gray-400 shrink-0">→</span>
                      )}
                      {d.newValue != null ? (
                        <span className="px-2 py-0.5 rounded text-sm bg-emerald-50 text-emerald-800 font-medium">
                          {d.newValue}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          <details className="group">
            <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700 list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform">›</span>
              Raw data (old_data / new_data)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-500 text-xs block mb-1">Before</span>
                {renderJson(change.old_data)}
              </div>
              <div>
                <span className="text-gray-500 text-xs block mb-1">After</span>
                {renderJson(change.new_data)}
              </div>
            </div>
          </details>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 shrink-0">
          {canToggle && (
            <button
              type="button"
              onClick={handleToggle}
              disabled={toggling}
              className={`px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors ${
                isUndone ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
              } ${highlightToggle ? 'ring-4 ring-yellow-300 animate-pulse' : ''}`}
            >
              {toggling ? (isUndone ? 'Redoing…' : 'Undoing…') : (isUndone ? 'Redo' : 'Undo')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

export default function ChangeHistory() {
  const location = useLocation()
  const navigate = useNavigate()
  const { success } = useToast()
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [entityFilter, setEntityFilter] = useState('')
  const [selectedChange, setSelectedChange] = useState(null)
  const [guideHighlightToggle, setGuideHighlightToggle] = useState(false)
  const [showBackfillModal, setShowBackfillModal] = useState(false)

  const fetchChanges = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    const params = { limit: 100 }
    if (entityFilter) params.entity_type = entityFilter
    api
      .getChangeLog(params)
      .then((res) => setChanges(res.changes || []))
      .catch((e) => {
        if (!silent) {
          setChanges([])
          setError(e.message || 'Could not load change history')
        }
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [entityFilter])

  useEffect(() => {
    fetchChanges()
  }, [fetchChanges])

  useEffect(() => {
    const action = location.state?.guideAction
    if (action !== 'change-history.undo-redo') return
    // Keep modal open between guide transitions when already active.
    if (selectedChange) {
      setGuideHighlightToggle(true)
    } else if (changes.length > 0) {
      setSelectedChange(changes[0])
      setGuideHighlightToggle(true)
    }
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state?.guideAction, location.pathname, navigate, changes, selectedChange])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setSelectedChange(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const handleGuideEnded = () => {
      setSelectedChange(null)
      setGuideHighlightToggle(false)
    }
    window.addEventListener('guide:ended', handleGuideEnded)
    return () => window.removeEventListener('guide:ended', handleGuideEnded)
  }, [])

  return (
    <div className="w-full flex flex-col h-full min-h-0">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <History className="w-6 h-6 text-green-600" />
          Change History
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowBackfillModal(true)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Backfill past schedule
          </button>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All entities</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
          {error}
        </div>
      )}
      {loading ? (
        <p className="py-8 text-gray-500">Loading…</p>
      ) : changes.length === 0 ? (
        <p className="py-8 text-gray-500">No changes recorded yet.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Time</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Entity</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Change</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Staff</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const diffs = getChangeDiffs(c.old_data, c.new_data, c.action)
                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        setGuideHighlightToggle(false)
                        setSelectedChange(c)
                      }}
                      className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                        {formatDateTime(c.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-gray-900">
                          {ENTITY_LABELS[c.entity_type] || c.entity_type}
                        </span>
                        <span className="text-gray-600 text-xs ml-1">
                          ({getEntityDisplayLabel(c)})
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            c.action === 'create'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.action === 'delete'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {ACTION_LABELS[c.action] || c.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 min-w-[200px]">
                        <div className="flex flex-wrap gap-1.5">
                          {diffs.length > 0 ? (
                            diffs.map((d, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200"
                                title={
                                  d.oldValue != null && d.newValue != null
                                    ? `${d.oldValue} → ${d.newValue}`
                                    : d.newValue ?? d.oldValue
                                }
                              >
                                <span className="text-gray-500 font-medium shrink-0">{d.field}:</span>
                                {d.oldValue != null && d.newValue != null ? (
                                  <>
                                    <span className="text-red-600 line-through truncate max-w-[6rem]">
                                      {d.oldValue}
                                    </span>
                                    <span className="text-gray-400 shrink-0">→</span>
                                    <span className="text-emerald-700 font-medium truncate max-w-[6rem]">
                                      {d.newValue}
                                    </span>
                                  </>
                                ) : (
                                  <span className="truncate max-w-[8rem]">{d.newValue ?? d.oldValue}</span>
                                )}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{c.staff_name || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedChange && (
        <ChangeDetailsModal
          change={selectedChange}
          highlightToggle={guideHighlightToggle}
          onClose={() => {
            setGuideHighlightToggle(false)
            setSelectedChange(null)
          }}
          onUndo={async (c) => {
            await api.undoChange(c.id)
            setChanges((prev) => prev.map((item) => (item.id === c.id ? { ...item, is_undone: true } : item)))
            setSelectedChange((prev) => (prev && prev.id === c.id ? { ...prev, is_undone: true } : prev))
            success('Undo successful')
            fetchChanges({ silent: true })
          }}
          onRedo={async (c) => {
            await api.redoChange(c.id)
            setChanges((prev) => prev.map((item) => (item.id === c.id ? { ...item, is_undone: false } : item)))
            setSelectedChange((prev) => (prev && prev.id === c.id ? { ...prev, is_undone: false } : prev))
            success('Redo successful')
            fetchChanges({ silent: true })
          }}
        />
      )}
      {showBackfillModal && (
        <BackfillScheduleModal onClose={() => setShowBackfillModal(false)} />
      )}
    </div>
  )
}
