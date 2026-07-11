import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { PauseCircle, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { HIATUS_STATUS } from './StudentStatusBadge'
import StudentDetailsModal from './StudentDetailsModal'
import ConfirmActionModal from './ConfirmActionModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
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
    <div className="flex items-center gap-1">
      <select
        value={month}
        disabled={disabled}
        onChange={(e) => commit(e.target.value, year || String(new Date().getFullYear()))}
        className="rounded-md border border-gray-300 px-1.5 py-1 text-sm bg-white disabled:opacity-50 cursor-pointer"
        aria-label="Month"
      >
        <option value="">--</option>
        {MONTH_OPTIONS.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
      <span className="text-gray-500 text-sm">/</span>
      <select
        value={year}
        disabled={disabled}
        onChange={(e) => commit(month || '01', e.target.value)}
        className="rounded-md border border-gray-300 px-1.5 py-1 text-sm bg-white disabled:opacity-50 cursor-pointer"
        aria-label="Year"
      >
        <option value="">----</option>
        {yearChoices.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      {value ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('')}
          className="ml-1 text-xs text-gray-500 hover:text-gray-800 underline cursor-pointer disabled:opacity-50"
          title="Clear to 未定"
        >
          未定
        </button>
      ) : (
        <span className="ml-1 text-xs text-gray-400">未定</span>
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
        <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 flex flex-col max-h-[90vh]">
          {loading && <ModalLoadingOverlay className="rounded-2xl" />}
          <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-green-600 text-white rounded-t-2xl">
            <h3 id="hiatusModalTitle" className="text-lg font-semibold">休会中 — Students on break</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20 cursor-pointer"
            >
              Close
            </button>
          </header>
          <div className="p-6 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <PauseCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h4 className="text-lg font-medium text-gray-900">Temporary break from lessons</h4>
                  <p className="text-sm text-gray-500">Track outreach and return. Click a name to open student details.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={fetchList}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

            <div className="relative overflow-auto max-h-[50vh] w-full rounded-xl border border-black/5 bg-white shadow-sm flex-1 min-h-0">
              <table className="min-w-full border-separate border-spacing-0">
                <thead className="sticky top-0 bg-green-600 text-white shadow z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Student</th>
                    <th className="px-3 py-2 text-left font-semibold">ID</th>
                    <th className="px-3 py-2 text-left font-semibold">再開予定</th>
                    <th className="px-3 py-2 text-center font-semibold">連絡</th>
                    <th className="px-3 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && list.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                        No students on break ({HIATUS_STATUS}).
                      </td>
                    </tr>
                  )}
                  {list.map((s) => {
                    const rowBusy = busyId === s.ID
                    return (
                      <tr key={s.ID} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm">
                          <button
                            type="button"
                            onClick={() => setDetailStudentId(s.ID)}
                            className="text-left text-blue-700 hover:underline font-medium cursor-pointer"
                          >
                            {s.Name || '—'}
                          </button>
                          {s.漢字 ? <div className="text-xs text-gray-500">{s.漢字}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">{s.ID}</td>
                        <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">
                          <ExpectedReturnEditors
                            value={s.HiatusExpectedReturn}
                            disabled={rowBusy}
                            onChange={(monthValue) => handleExpectedReturnChange(s, monthValue)}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 cursor-pointer disabled:opacity-50"
                            checked={!!s.HiatusContacted}
                            disabled={rowBusy}
                            onChange={(e) => handleContactedChange(s, e.target.checked)}
                            aria-label={`連絡 ${s.Name}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => handleReturned(s)}
                              className="rounded-md border border-green-600 bg-white px-2.5 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 cursor-pointer disabled:opacity-50"
                            >
                              Set Active
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => setDormantTarget(s)}
                              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
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

            {!loading && (
              <div className="mt-4 text-sm text-gray-600">
                <span className="font-medium">Total on break: </span>
                <span className="font-semibold text-green-700">{list.length}</span>
              </div>
            )}
          </div>
          <footer className="flex-shrink-0 flex justify-end gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200 rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
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
          message={`Move ${dormantTarget.Name || 'this student'} from 休会中 to Dormant? They will be removed from the break list.`}
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
