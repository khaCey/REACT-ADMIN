import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CalendarX, RefreshCw } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from './StudentDetailsModal'

/**
 * Legacy-style modal: Unpaid Students or Unscheduled Students.
 * Two columns (Student Name, Student ID). Click row → open student details.
 */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

  const title = isUnpaid ? 'Unpaid Students' : 'Unscheduled Students'
  const subtitle = isUnpaid
    ? 'Students with Outstanding Payments'
    : 'Students with no Appointments this month'
  const countLabel = isUnpaid ? 'Total unpaid students' : 'Total unscheduled students'

  const modal = (
    <div className="fixed inset-0 z-[50]" role="dialog" aria-modal="true" aria-labelledby="featureModalTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 flex flex-col max-h-[90vh]">
          <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-green-600 text-white rounded-t-2xl">
            <h3 id="featureModalTitle" className="text-lg font-semibold">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20 cursor-pointer"
            >
              Close
            </button>
          </header>
          <div className="p-6 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  {isUnpaid ? (
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  ) : (
                    <CalendarX className="w-5 h-5 text-green-600" />
                  )}
                </div>
                <div>
                  <h4 className="text-lg font-medium text-gray-900">{subtitle}</h4>
                  <p className="text-sm text-gray-500">Click on a student to view their details</p>
                </div>
              </div>
              {isUnpaid && (
                <div className="flex items-center gap-2">
                  <label htmlFor="unpaidMonthSelect" className="text-sm text-gray-600">Month:</label>
                  <select
                    id="unpaidMonthSelect"
                    value={unpaidMonth}
                    onChange={(e) => setUnpaidMonth(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer"
                  >
                    {(() => {
                      const now = new Date()
                      const cur = getCurrentMonthYYYYMM()
                      const options = []
                      for (let i = -2; i <= 2; i++) {
                        const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
                        const yyyyMm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                        const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}${yyyyMm === cur ? ' (Current)' : ''}`
                        options.push(<option key={yyyyMm} value={yyyyMm}>{label}</option>)
                      }
                      return options
                    })()}
                  </select>
                  <button
                    type="button"
                    onClick={fetchList}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                </div>
              )}
            </div>

            <div className="relative overflow-auto max-h-[50vh] w-full rounded-xl border border-black/5 bg-white shadow-sm flex-1 min-h-0">
              <table className="min-w-full border-separate border-spacing-0">
                <thead className="sticky top-0 bg-green-600 text-white shadow">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Student Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Student ID</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-center text-gray-500">
                        <div className="flex justify-center items-center py-4">
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-green-600 border-t-transparent" />
                          <span className="ml-2">Loading...</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!loading && error && (
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-center text-red-600">
                        {error}
                      </td>
                    </tr>
                  )}
                  {!loading && !error && list.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-center text-gray-500">
                        {isUnpaid ? 'No unpaid entries in the Unpaid list.' : 'No unscheduled students this month.'}
                      </td>
                    </tr>
                  )}
                  {!loading && !error && list.length > 0 &&
                    list.map((s) => (
                      <tr
                        key={s.ID}
                        onClick={() => handleRowClick(s.ID)}
                        className="hover:bg-gray-50 cursor-pointer border-b border-gray-100"
                      >
                        <td className="px-3 py-2 text-sm text-gray-900">{s.Name || ''}</td>
                        <td className="px-3 py-2 text-sm">
                          <span className="text-blue-600 underline">{s.ID}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {!loading && list.length > 0 && (
              <div className="mt-4 text-sm text-gray-600">
                <span className="font-medium">{countLabel}: </span>
                <span className="font-semibold text-red-600">{list.length}</span>
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
    </>
  )
}
