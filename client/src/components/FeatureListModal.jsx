import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CalendarX, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from './StudentDetailsModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'

/**
 * Modal list: 未納 (unpaid) or 未定 (unscheduled).
 * Click row → open student details.
 */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function getCurrentMonthYYYYMM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function FeatureListModal({ mode, onClose, onOpenStudent }) {
  const isUnpaid = mode === 'unpaid'
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detailStudentId, setDetailStudentId] = useState(null)
  const [unpaidMonth, setUnpaidMonth] = useState(getCurrentMonthYYYYMM)

  const fetchList = () => {
    setLoading(true)
    setError(null)
    const promise = isUnpaid
      ? api.getUnpaidStudents(unpaidMonth)
      : api.getUnscheduledLessonsStudents()
    promise
      .then((rows) => setList(rows || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (mode) fetchList()
  }, [mode, isUnpaid ? unpaidMonth : undefined])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const handleRowClick = (id) => {
    if (onOpenStudent) onOpenStudent(id)
    else setDetailStudentId(id)
  }

  const title = isUnpaid ? '未納' : '未定'
  const accent = isUnpaid
    ? { iconBg: 'bg-red-500/20', icon: 'text-white', count: 'text-red-600' }
    : { iconBg: 'bg-white/15', icon: 'text-white', count: 'text-green-700' }

  const modal = (
    <div className="fixed inset-0 z-[50]" role="dialog" aria-modal="true" aria-labelledby="featureModalTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 flex flex-col max-h-[90vh] overflow-hidden">
          {loading && <ModalLoadingOverlay className="rounded-2xl" />}

          <header className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-white/20 ${accent.iconBg}`}
              >
                {isUnpaid ? (
                  <AlertCircle className={`h-5 w-5 ${accent.icon}`} />
                ) : (
                  <CalendarX className={`h-5 w-5 ${accent.icon}`} />
                )}
              </span>
              <div className="min-w-0">
                <h3 id="featureModalTitle" className="text-lg font-semibold leading-tight">
                  {title}
                </h3>
                <p className="text-xs text-white/80">
                  {loading ? 'Loading…' : `${list.length} student${list.length === 1 ? '' : 's'}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isUnpaid && (
                <select
                  id="unpaidMonthSelect"
                  value={unpaidMonth}
                  onChange={(e) => setUnpaidMonth(e.target.value)}
                  className="rounded-lg border border-white/25 bg-white/10 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 cursor-pointer [&>option]:text-gray-900"
                  aria-label="Month"
                >
                  {(() => {
                    const now = new Date()
                    const cur = getCurrentMonthYYYYMM()
                    const options = []
                    for (let i = -2; i <= 2; i++) {
                      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
                      const yyyyMm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}${yyyyMm === cur ? ' (Current)' : ''}`
                      options.push(
                        <option key={yyyyMm} value={yyyyMm}>
                          {label}
                        </option>
                      )
                    }
                    return options
                  })()}
                </select>
              )}
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

          <div className="p-5 flex flex-col flex-1 min-h-0">
            {error && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="relative overflow-auto max-h-[58vh] w-full rounded-xl border border-gray-200 bg-white shadow-sm flex-1 min-h-0">
              <table className="min-w-full">
                <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Student
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      ID
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!loading && !error && list.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-12 text-center text-sm text-gray-500">
                        {isUnpaid ? 'No unpaid students for this month.' : 'No unscheduled students this month.'}
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    !error &&
                    list.map((s, index) => (
                      <tr
                        key={s.ID}
                        onClick={() => handleRowClick(s.ID)}
                        className={`cursor-pointer transition-colors hover:bg-green-50/50 ${
                          index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
                        }`}
                      >
                        <td className="px-4 py-3 text-sm font-semibold text-green-700">{s.Name || '—'}</td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-500">{s.ID}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <footer className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 bg-gray-50 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-500">{title}</span>{' '}
              <span className={`font-semibold tabular-nums ${accent.count}`}>{list.length}</span>
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
    </>
  )
}
