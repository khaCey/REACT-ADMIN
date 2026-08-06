import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquareQuote, Plus, X } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from './StudentDetailsModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import ToggleSwitch from './ToggleSwitch'
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
  const [addOpen, setAddOpen] = useState(false)
  const [allStudents, setAllStudents] = useState([])
  const [allStudentsLoading, setAllStudentsLoading] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addingId, setAddingId] = useState(null)

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
    if (!addOpen) return undefined
    let cancelled = false
    setAllStudentsLoading(true)
    api
      .getStudents()
      .then((rows) => {
        if (!cancelled) setAllStudents(Array.isArray(rows) ? rows : [])
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load students')
      })
      .finally(() => {
        if (!cancelled) setAllStudentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [addOpen])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (detailStudentId != null) return
        if (addOpen) {
          setAddOpen(false)
          setAddQuery('')
          return
        }
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, detailStudentId, addOpen])

  const listedIds = useMemo(() => new Set(list.map((s) => s.ID)), [list])

  const addSuggestions = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    return (allStudents || [])
      .filter((s) => s?.ID != null && !listedIds.has(s.ID))
      .filter((s) => {
        if (!q) return true
        const hay = `${s.Name || ''} ${s.漢字 || ''} ${s.ID || ''} ${s.Email || ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 12)
  }, [allStudents, listedIds, addQuery])

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

  const handleFreeDrinkChange = async (student, checked) => {
    const id = student?.ID
    if (id == null) return
    setBusyId(id)
    setError(null)
    try {
      const res = await api.patchStudentReview(id, { free_drink: checked })
      const row = res?.student
      setList((prev) =>
        prev.map((s) => (s.ID === id ? { ...s, ...(row || { ReviewFreeDrink: checked }) } : s))
      )
    } catch (e) {
      setError(e.message || 'Failed to update Free Drink')
    } finally {
      setBusyId(null)
    }
  }

  const handleAddStudent = async (student) => {
    const id = student?.ID
    if (id == null || listedIds.has(id)) return
    setAddingId(id)
    setError(null)
    try {
      const res = await api.patchStudentReview(id, { has_review: true })
      const row = res?.student || student
      setList((prev) => {
        if (prev.some((s) => s.ID === row.ID)) return prev
        return [...prev, row].sort((a, b) =>
          String(a.Name || '').localeCompare(String(b.Name || ''), 'ja')
        )
      })
      success(`${row.Name || 'Student'} added to 口コミリスト`)
      setAddQuery('')
      setAddOpen(false)
    } catch (e) {
      setError(e.message || 'Failed to add to 口コミリスト')
    } finally {
      setAddingId(null)
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
                onClick={() => {
                  setAddOpen((open) => !open)
                  setAddQuery('')
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add student
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
            {addOpen && (
              <div className="px-5 py-3 border-b border-gray-100 bg-green-50/60">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Add student
                </label>
                <input
                  type="search"
                  autoFocus
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="Search by name or ID…"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                />
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  {allStudentsLoading ? (
                    <p className="px-3 py-3 text-sm text-gray-500">Loading students…</p>
                  ) : addSuggestions.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-gray-500">
                      {addQuery.trim() ? 'No matching students' : 'Type to search students not yet on this list'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {addSuggestions.map((s) => (
                        <li key={s.ID}>
                          <button
                            type="button"
                            disabled={addingId != null}
                            onClick={() => handleAddStudent(s)}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-green-50 cursor-pointer disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="font-medium text-gray-900">{s.Name || '—'}</span>
                              {s.漢字 ? (
                                <span className="ml-2 text-xs text-gray-500">{s.漢字}</span>
                              ) : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-xs text-gray-500">
                              {addingId === s.ID ? 'Adding…' : `ID ${s.ID}`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

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
                    <th className="px-4 py-3 text-center text-xs font-semibold tracking-wide text-gray-500">
                      Free Drink
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!loading && list.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-sm text-gray-500">
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
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex justify-center">
                            <ToggleSwitch
                              checked={!!s.ReviewFreeDrink}
                              disabled={rowBusy}
                              onChange={(next) => handleFreeDrinkChange(s, next)}
                              aria-label={`Free Drink ${s.Name || s.ID}`}
                            />
                          </div>
                        </td>
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
