import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Coffee, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from './StudentDetailsModal'
import ConfirmActionModal from './ConfirmActionModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import ToggleSwitch from './ToggleSwitch'
import { useToast } from '../context/ToastContext'

/** Display 再開予定 as mm/yyyy, or 未定 when unset. */
function formatReturnDate(iso) {
  if (!iso) return '未定'
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[2]}/${m[1]}`
  return '未定'
}

function parseYearMonth(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})/)
  if (!m) return { year: '', month: '' }
  return { year: m[1], month: m[2] }
}

function buildYearOptions() {
  const now = new Date()
  const y = now.getFullYear()
  const years = []
  for (let i = y - 1; i <= y + 3; i += 1) years.push(String(i))
  return years
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))

function ExpectedReturnEditors({ value, disabled, onChange }) {
  const { year, month } = parseYearMonth(value)
  const years = buildYearOptions()
  const yearChoices = year && !years.includes(year) ? [year, ...years] : years

  const commit = (nextMonth, nextYear) => {
    if (!nextMonth || !nextYear) {
      onChange('')
      return
    }
    onChange(`${nextYear}-${nextMonth}`)
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={month}
        disabled={disabled}
        onChange={(e) => commit(e.target.value, year || String(new Date().getFullYear()))}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm disabled:opacity-50 cursor-pointer hover:border-gray-300"
        aria-label="Month"
      >
        <option value="">MM</option>
        {MONTH_OPTIONS.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
      <span className="text-gray-400 text-sm font-medium">/</span>
      <select
        value={year}
        disabled={disabled}
        onChange={(e) => commit(month || '01', e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm disabled:opacity-50 cursor-pointer hover:border-gray-300"
        aria-label="Year"
      >
        <option value="">YYYY</option>
        {yearChoices.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      {value ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('')}
          className="ml-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 cursor-pointer disabled:opacity-50"
          title="Clear to 未定"
        >
          未定
        </button>
      ) : (
        <span className="ml-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
          未定
        </span>
      )}
    </div>
  )
}

export default function HiatusStudentsModal({ onClose }) {
  const { success } = useToast()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detailStudentId, setDetailStudentId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [dormantTarget, setDormantTarget] = useState(null)
  const [dormantConfirming, setDormantConfirming] = useState(false)

  const fetchList = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getHiatusStudents()
      .then((rows) => setList(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !dormantTarget) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, dormantTarget])

  const runHiatusAction = async (studentId, body, successMsg) => {
    setBusyId(studentId)
    try {
      await api.patchStudentHiatus(studentId, body)
      if (successMsg) success(successMsg)
      fetchList()
    } catch (e) {
      setError(e.message || 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const handleContactedChange = (student, checked) => {
    runHiatusAction(student.ID, { action: 'update', contacted: checked })
  }

  const handleOtsukishaChange = (student, checked) => {
    runHiatusAction(student.ID, { action: 'update', otsukisha: checked })
  }

  const handleExpectedReturnChange = (student, monthValue) => {
    const next = monthValue ? `${monthValue}-01` : null
    const prev = student.HiatusExpectedReturn
      ? `${String(student.HiatusExpectedReturn).slice(0, 7)}-01`
      : null
    if (next === prev || (!next && !prev)) return
    runHiatusAction(
      student.ID,
      { action: 'update', expected_return: next },
      next ? `再開予定 updated to ${formatReturnDate(next)}` : '再開予定 cleared (未定)'
    )
  }

  const handleReturned = async (student) => {
    await runHiatusAction(
      student.ID,
      { action: 'returned' },
      `${student.Name || 'Student'} set to Active (再開)`
    )
  }

  const handleDormantConfirm = async () => {
    if (!dormantTarget) return
    setDormantConfirming(true)
    try {
      await api.patchStudentHiatus(dormantTarget.ID, { action: 'dormant' })
      success(`${dormantTarget.Name || 'Student'} set to Dormant`)
      setDormantTarget(null)
      fetchList()
    } catch (e) {
      setError(e.message || 'Failed to set Dormant')
    } finally {
      setDormantConfirming(false)
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[50]" role="dialog" aria-modal="true" aria-labelledby="hiatusModalTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 flex flex-col max-h-[90vh] overflow-hidden">
          {loading && <ModalLoadingOverlay className="rounded-2xl" />}

          <header className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
            <div className="flex items-center gap-3 min-w-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <Coffee className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 id="hiatusModalTitle" className="text-lg font-semibold leading-tight">
                  休会中
                </h3>
                <p className="text-xs text-white/80">
                  {loading ? 'Loading…' : `${list.length} on temporary break`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={fetchList}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-lg border border-white/25 bg-white/10 hover:bg-white/20 cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="flex flex-col flex-1 min-h-0">
            {error && (
              <p className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="relative overflow-auto max-h-[58vh] w-full flex-1 min-h-0 border-t border-gray-100">
              <table className="min-w-full">
                <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Student
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500">
                      再開予定
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold tracking-wide text-gray-500">
                      連絡
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold tracking-wide text-gray-500">
                      お月謝
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!loading && list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-500">
                        No students on break.
                      </td>
                    </tr>
                  )}
                  {list.map((s, index) => {
                    const rowBusy = busyId === s.ID
                    return (
                      <tr
                        key={s.ID}
                        className={`transition-colors hover:bg-green-50/40 ${
                          index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
                        }`}
                      >
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            onClick={() => setDetailStudentId(s.ID)}
                            className="text-left text-sm font-semibold text-green-700 hover:text-green-800 hover:underline cursor-pointer"
                          >
                            {s.Name || '—'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-gray-600">{s.ID}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <ExpectedReturnEditors
                            value={s.HiatusExpectedReturn}
                            disabled={rowBusy}
                            onChange={(monthValue) => handleExpectedReturnChange(s, monthValue)}
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex justify-center">
                            <ToggleSwitch
                              checked={!!s.HiatusContacted}
                              disabled={rowBusy}
                              onChange={(next) => handleContactedChange(s, next)}
                              aria-label={`連絡 ${s.Name}`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex justify-center">
                            <ToggleSwitch
                              checked={!!s.HiatusOtsukisha}
                              disabled={rowBusy}
                              onChange={(next) => handleOtsukishaChange(s, next)}
                              aria-label={`お月謝 ${s.Name}`}
                            />
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => handleReturned(s)}
                              className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-700 cursor-pointer disabled:opacity-50"
                            >
                              Set Active
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => setDormantTarget(s)}
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
                            >
                              Set Dormant
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <footer className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 bg-gray-50 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-500">休会中</span>{' '}
              <span className="font-semibold text-green-700 tabular-nums">{list.length}</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Close
            </button>
          </footer>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(modal, document.body)}
      {detailStudentId != null && (
        <StudentDetailsModal
          studentId={detailStudentId}
          onClose={() => setDetailStudentId(null)}
          onStudentDeleted={() => {
            setDetailStudentId(null)
            fetchList()
          }}
          onStudentUpdated={fetchList}
        />
      )}
      {dormantTarget && (
        <ConfirmActionModal
          title="Set Dormant"
          message={`Move ${dormantTarget.Name || 'this student'} from 休会中 to Dormant? They will be removed from this list.`}
          confirmLabel="Set Dormant"
          destructive
          confirming={dormantConfirming}
          onConfirm={handleDormantConfirm}
          onClose={() => !dormantConfirming && setDormantTarget(null)}
        />
      )}
    </>
  )
}
