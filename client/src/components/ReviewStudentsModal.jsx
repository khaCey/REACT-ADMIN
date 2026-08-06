import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquareQuote, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from './StudentDetailsModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import { useToast } from '../context/ToastContext'

/**
 * Sidebar list: students manually marked as having left a 口コミ (review).
 */
export default function ReviewStudentsModal({ onClose }) {
  const { success } = useToast()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detailStudentId, setDetailStudentId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const fetchList = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getReviewStudents()
      .then((rows) => setList(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && detailStudentId == null) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, detailStudentId])

  const handleClearReview = async (student) => {
    const id = student?.ID
    if (id == null) return
    setBusyId(id)
    setError(null)
    try {
      await api.patchStudentReview(id, { has_review: false })
      setList((prev) => prev.filter((s) => s.ID !== id))
      success(`${student.Name || 'Student'} removed from 口コミリスト`)
    } catch (e) {
      setError(e.message || 'Failed to clear 口コミ')
    } finally {
      setBusyId(null)
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[50]" role="dialog" aria-modal="true" aria-labelledby="reviewModalTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 flex flex-col max-h-[90vh] overflow-hidden">
          {loading && <ModalLoadingOverlay className="rounded-2xl" />}

          <header className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
            <div className="flex items-center gap-3 min-w-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <MessageSquareQuote className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 id="reviewModalTitle" className="text-lg font-semibold leading-tight">
                  口コミリスト
                </h3>
                <p className="text-xs text-white/80">
                  {loading ? 'Loading…' : `${list.length} student${list.length !== 1 ? 's' : ''} with a review`}
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
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!loading && list.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-5 py-12 text-center text-sm text-gray-500">
                        No students marked 口コミ済 yet.
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
                          {s.漢字 ? (
                            <div className="text-xs text-gray-500 mt-0.5">{s.漢字}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-gray-600">{s.ID}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => handleClearReview(s)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
                          >
                            Clear 口コミ
                          </button>
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
              <span className="font-medium text-gray-500">口コミリスト</span>{' '}
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
    </>
  )
}
