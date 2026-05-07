import { useState, useEffect, useCallback, Component, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Calendar } from 'lucide-react'
import { api } from '../api'
import { isStudentExcludedFromBooking, studentIsDemoOrTrial } from '../config/booking'
import { formatMonth, formatNumber, formatDate, formatDateUTC } from '../utils/format'
import { useToast } from '../context/ToastContext'
import PaymentModal from './PaymentModal'
import NoteModal from './NoteModal'
import EditStudentModal from './EditStudentModal'
import LessonsThisMonth from './LessonsThisMonth'
import BookLessonModal from './BookLessonModal'
import PreBookLessonModal from './PreBookLessonModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import GroupLinkModal from './GroupLinkModal'

function StatusBadge({ status }) {
  const cls =
    status === 'Active'
      ? 'badge-status-active'
      : status === 'Dormant'
        ? 'badge-status-dormant'
        : 'badge-status-demo'
  return <span className={`badge ${cls}`}>{status || 'Active'}</span>
}

class ModalErrorBoundary extends Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-red-600">
          Something went wrong loading this view. {this.state.error?.message || ''}
        </div>
      )
    }
    return this.props.children
  }
}

export default function StudentDetailsModal({
  studentId,
  onClose,
  onStudentDeleted,
  onStudentUpdated,
  /** Optional: e.g. Dashboard refetches today-lessons when lesson notes change (has-note badge). */
  onLessonNotesChanged,
  guideAction = null,
  onGuideActionHandled,
}) {
  const { success } = useToast()
  const [student, setStudent] = useState(null)
  const [payments, setPayments] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [lessonsLoading, setLessonsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [paymentModal, setPaymentModal] = useState(null)
  const [noteModal, setNoteModal] = useState(null)
  const [editStudentModal, setEditStudentModal] = useState(false)
  const [bookLessonModal, setBookLessonModal] = useState(false)
  const [preBookLessonModal, setPreBookLessonModal] = useState(false)
  const [groupLinkModalOpen, setGroupLinkModalOpen] = useState(false)
  const [overridePaidLessons, setOverridePaidLessons] = useState(null)
  const [rescheduleSourceLesson, setRescheduleSourceLesson] = useState(null)
  /** Preload for BookLessonModal (latest-by-month) to avoid layout shift when opening booking. */
  const [bookingLatestByMonth, setBookingLatestByMonth] = useState(null)
  const [studentGroup, setStudentGroup] = useState(null)
  /** Bumped after a successful book so LessonsThisMonth refetches (independent of calendar poll). */
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0)
  /** Queue of optimistic lesson-card mutations consumed by LessonsThisMonth. */
  const [optimisticScheduleMutations, setOptimisticScheduleMutations] = useState([])
  const [noteSearch, setNoteSearch] = useState('')
  const [syncingGoogleContact, setSyncingGoogleContact] = useState(false)
  const [guideFocusKey, setGuideFocusKey] = useState(null)
  const [guideHighlightDeleteInEdit, setGuideHighlightDeleteInEdit] = useState(false)
  const lastGuideActionRef = useRef(null)
  const nextOptimisticMutationIdRef = useRef(1)

  /** Uses modal `studentId` + loaded `student` record (`ID`) — not schedule rows. */
  const bookingExcluded = isStudentExcludedFromBooking(studentId, student)

  useEffect(() => {
    if (bookingExcluded) setBookLessonModal(false)
  }, [bookingExcluded])

  useEffect(() => {
    setScheduleRefreshKey(0)
    setOptimisticScheduleMutations([])
  }, [studentId])

  const handleOptimisticScheduleMutation = useCallback((mutation) => {
    if (!mutation || typeof mutation !== 'object') return
    const id = nextOptimisticMutationIdRef.current++
    setOptimisticScheduleMutations((prev) => [...prev, { id, ...mutation }])
  }, [])

  /** @param {{ silent?: boolean }} [opts] - silent: refresh data without full-modal loading (avoids white flash while modal is open). */
  const fetchData = useCallback((opts = {}) => {
    const silent = !!opts.silent
    if (studentId == null) return Promise.resolve()
    if (!silent) {
      setLoading(true)
      setError(null)
      setBookingLatestByMonth(null)
    }
    return Promise.all([
      api.getStudent(studentId),
      api.getPayments(),
      api.getNotes(studentId),
      api.getStudentLatestByMonth(studentId).catch(() => ({ latestByMonth: null })),
      api.getStudentGroup(studentId).catch(() => null),
    ])
      .then(([s, p, n, latestRes, groupRes]) => {
        setStudent(s)
        setPayments((p || []).filter((x) => String(x['Student ID']) === String(studentId)))
        setNotes(n || [])
        setBookingLatestByMonth(latestRes?.latestByMonth ?? null)
        setStudentGroup(groupRes || null)
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [studentId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setLessonsLoading(true)
  }, [studentId])

  useEffect(() => {
    if (!guideAction || !student || loading || lessonsLoading) return
    if (lastGuideActionRef.current === guideAction) return
    lastGuideActionRef.current = guideAction
    if (guideAction === 'students.edit') {
      // If edit modal is already open, don't push user back to the Edit button.
      if (editStudentModal) {
        setGuideFocusKey(null)
      } else {
        setGuideFocusKey('student-edit')
      }
      setGuideHighlightDeleteInEdit(false)
      onGuideActionHandled?.()
      return
    }
    if (guideAction === 'students.delete') {
      // Step 3 -> 4 behavior:
      // - Keep edit modal open if already open and highlight Delete there.
      // - Otherwise, highlight Edit first so user can open the edit modal.
      if (editStudentModal) {
        setGuideFocusKey(null)
      } else {
        setGuideFocusKey('student-delete')
      }
      setGuideHighlightDeleteInEdit(true)
      onGuideActionHandled?.()
      return
    }
    if (guideAction === 'payments.add') {
      setGuideFocusKey('payments-add')
      onGuideActionHandled?.()
      return
    }
    if (guideAction === 'payments.edit' || guideAction === 'payments.delete') {
      setGuideFocusKey(payments.length > 0 ? 'payments-first-row' : 'payments-add')
      onGuideActionHandled?.()
      return
    }
    if (guideAction === 'notes.add') {
      setGuideFocusKey('notes-add')
      onGuideActionHandled?.()
      return
    }
    if (guideAction === 'notes.edit' || guideAction === 'notes.delete') {
      setGuideFocusKey(notes.length > 0 ? 'notes-first-row' : 'notes-add')
      onGuideActionHandled?.()
      return
    }
    if (guideAction === 'students.view') {
      onGuideActionHandled?.()
    }
  }, [guideAction, student, loading, lessonsLoading, payments, notes, editStudentModal, onGuideActionHandled])

  useEffect(() => {
    if (!guideFocusKey) return
    const t = setTimeout(() => setGuideFocusKey(null), 7000)
    return () => clearTimeout(t)
  }, [guideFocusKey])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSyncGoogleContact = async () => {
    if (studentId == null || syncingGoogleContact) return
    setSyncingGoogleContact(true)
    setError(null)
    try {
      const res = await api.syncStudentGoogleContact(studentId)
      const action = res?.actionTaken === 'created' ? 'created' : res?.actionTaken === 'updated' ? 'updated' : 'synced'
      success(`Google Contact ${action}`)
      fetchData({ silent: true })
    } catch (e) {
      setError(e.message || 'Google Contact sync failed')
    } finally {
      setSyncingGoogleContact(false)
    }
  }

  const getCurrentJstYyyyMm = () => {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const y = jst.getUTCFullYear()
    const m = jst.getUTCMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}`
  }

  const hasKnownPaidLessonsThisMonth = () => {
    if (!bookingLatestByMonth || typeof bookingLatestByMonth !== 'object') return false
    const ym = getCurrentJstYyyyMm()
    const paid = bookingLatestByMonth?.[ym]?.paidLessonsCount
    return typeof paid === 'number' && paid > 0
  }

  const openBookingFlow = (opts = {}) => {
    const source = opts?.rescheduleSource || null
    setGuideFocusKey(null)
    setRescheduleSourceLesson(source)
    if (source) {
      setOverridePaidLessons(null)
      setBookLessonModal(true)
      return
    }
    if (student && studentIsDemoOrTrial(student)) {
      setOverridePaidLessons(null)
      setBookLessonModal(true)
      return
    }
    if (hasKnownPaidLessonsThisMonth()) {
      setOverridePaidLessons(null)
      setBookLessonModal(true)
      return
    }
    setPreBookLessonModal(true)
  }

  const handleOpenGroupLinkLesson = useCallback(() => {
    setGuideFocusKey(null)
    setGroupLinkModalOpen(true)
  }, [])

  const handleSaveGroupLesson = useCallback(async ({ memberIds, expectedSize }) => {
    const size =
      expectedSize ??
      Math.max(
        2,
        parseInt(student?.人数 ?? student?.group_size, 10) || studentGroup?.expectedSize || 2
      )
    const savedGroup = await api.saveStudentGroup(studentId, {
      member_ids: memberIds,
      expected_size: size,
    })
    setStudentGroup(savedGroup || null)
    success('Group members saved')
    setGroupLinkModalOpen(false)
    await fetchData({ silent: true })
  }, [fetchData, student, studentGroup, studentId, success])

  const handleUnlinkGroupLesson = useCallback(async () => {
    const unlinked = await api.unlinkStudentGroup(studentId)
    setStudentGroup(unlinked || null)
    success('Group link removed')
    setGroupLinkModalOpen(false)
    await fetchData({ silent: true })
  }, [fetchData, studentId, success])

  useEffect(() => {
    if (studentId == null) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [studentId, onClose])

  if (studentId == null) return null

  const blockingOverlay =
    loading || (!!student && lessonsLoading && !error)

  return createPortal(
    <>
    <div
      id="detailsModalRoot"
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 sm:p-8 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-[1400px] h-[90vh] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col">
        {guideFocusKey && <div className="absolute inset-0 z-[20] bg-black/45 pointer-events-none" aria-hidden="true" />}
        {blockingOverlay && <ModalLoadingOverlay />}

        {error && (
          <div className="p-6 text-red-600">
            Error: {error}
          </div>
        )}

        {!loading && !error && !student && (
          <div className="p-6 text-slate-600">
            Student not found or data could not be loaded.
          </div>
        )}

        {!loading && !error && student && (
          <ModalErrorBoundary>
          <>
            <div className="flex items-start justify-between bg-green-600 text-white px-4 py-2 flex-shrink-0">
              <div className="min-w-0 pr-4">
                <h2 className="text-lg sm:text-xl font-semibold truncate">
                  {student.Name}
                </h2>
                <p className="text-white/90 text-xs sm:text-sm truncate mt-0.5">
                  <span>{student.漢字}</span>
                  <span className="ml-2 text-white/80 text-xs sm:text-sm">
                    <span>{student.Email}</span>
                    <span className="mx-1">•</span>
                    <span>{student.Phone}</span>
                    {student.子 && (
                      <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        子
                      </span>
                    )}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {student.Group === 'Group' && <span className="badge bg-purple-600 text-white">Group</span>}
                {(student.Payment || '').toLowerCase().includes('owner') && <span className="badge bg-black text-white">Owner</span>}
                <StatusBadge status={student.Status} />
                <button
                  onClick={onClose}
                  className="p-1 rounded hover:bg-white/20 cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-hidden flex flex-col">
              <div className="grid grid-cols-1 xl:grid-cols-[576px_1fr] gap-6 flex-shrink-0">
                <LessonsThisMonth
                  studentId={studentId}
                  student={student}
                  onBookLesson={bookingExcluded ? undefined : openBookingFlow}
                  onMonthLessonsUpdated={() => fetchData({ silent: true })}
                  onLessonNotesChanged={onLessonNotesChanged}
                  onLoadingChange={setLessonsLoading}
                  optimisticScheduleMutations={optimisticScheduleMutations}
                  scheduleRefreshKey={scheduleRefreshKey}
                  sectionClassName="hidden xl:flex rounded-xl border border-gray-200 bg-white shadow-card h-[200px] flex-col overflow-hidden w-[576px]"
                />

                <section className="rounded-xl border border-gray-200 bg-white shadow h-[200px] flex flex-col overflow-hidden">
                  <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
                    <h3 className="font-semibold text-sm">All Payments</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setGuideFocusKey(null)
                        setPaymentModal({ mode: 'add' })
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg bg-green-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-green-700 cursor-pointer ${
                        guideFocusKey === 'payments-add' ? 'relative z-[30] ring-4 ring-yellow-300 animate-pulse shadow-xl' : ''
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      Add Payment
                    </button>
                  </header>
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-green-600 text-white z-10">
                        <tr>
                          <th className="px-3 py-2 text-left">Transaction ID</th>
                          <th className="min-w-[7rem] px-3 py-2 text-left whitespace-nowrap">Date</th>
                          <th className="px-3 py-2 text-left">Year</th>
                          <th className="px-3 py-2 text-left">Month</th>
                          <th className="px-3 py-2 text-left">Price</th>
                          <th className="px-3 py-2 text-left">Lessons</th>
                          <th className="px-3 py-2 text-left">Method</th>
                          <th className="px-3 py-2 text-left">Staff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {payments.map((p, i) => (
                          <tr
                            key={p['Transaction ID']}
                            className={`cursor-pointer hover:bg-gray-200 ${i % 2 === 1 ? 'bg-slate-200' : 'bg-white'} ${
                              i === 0 && guideFocusKey === 'payments-first-row'
                                ? 'relative z-[30] outline outline-4 outline-yellow-300 animate-pulse bg-yellow-50'
                                : ''
                            }`}
                            onClick={() => {
                              setGuideFocusKey(null)
                              setPaymentModal({ mode: 'edit', payment: p })
                            }}
                          >
                            <td className="px-3 py-2">{p['Transaction ID']}</td>
                            <td className="min-w-[7rem] px-3 py-2 whitespace-nowrap">{formatDate(p.Date)}</td>
                            <td className="px-3 py-2">{p.Year}</td>
                            <td className="px-3 py-2">{formatMonth(p.Month)}</td>
                            <td className="px-3 py-2">¥{Number(p.Total).toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">{formatNumber(p.Amount)}</td>
                            <td className="px-3 py-2">{p.Method}</td>
                            <td className="px-3 py-2">{p.Staff}</td>
                          </tr>
                        ))}
                        {payments.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-3 py-8 text-slate-500 text-center">
                              No payments
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <section className="mt-5 rounded-xl border border-gray-200 bg-white shadow flex-1 min-h-[280px] flex flex-col overflow-hidden">
                <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
                  <h3 className="font-semibold text-sm">All Notes</h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="search"
                      placeholder="Search notes"
                      value={noteSearch}
                      onChange={(e) => setNoteSearch(e.target.value)}
                      className="hidden sm:block w-48 rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setGuideFocusKey(null)
                        setNoteModal({ mode: 'add' })
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 cursor-pointer ${
                        guideFocusKey === 'notes-add' ? 'relative z-[30] ring-4 ring-yellow-300 animate-pulse shadow-xl bg-yellow-50' : ''
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      Add Note
                    </button>
                  </div>
                </header>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <table className="min-w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-28" />
                      <col className="min-w-0" />
                      <col className="w-24" />
                    </colgroup>
                    <thead className="sticky top-0 bg-green-600 text-white z-10">
                      <tr>
                        <th className="px-3 py-2 text-left whitespace-nowrap">Date</th>
                        <th className="px-3 py-2 text-left">Note</th>
                        <th className="px-3 py-2 text-left whitespace-nowrap">Staff</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const filtered = noteSearch.trim()
                          ? notes.filter((n) =>
                              `${n.Note || ''} ${n.Staff || ''} ${n.Date || ''}`.toLowerCase().includes(noteSearch.toLowerCase())
                            )
                          : notes
                        return filtered.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-8 text-slate-500 text-center">
                              {notes.length === 0 ? 'No notes' : 'No matching notes'}
                            </td>
                          </tr>
                        ) : (
                          filtered.map((n, i) => (
                            <tr
                              key={n.ID}
                              className={`cursor-pointer hover:bg-gray-200 ${i % 2 === 1 ? 'bg-slate-200' : 'bg-white'} ${
                                i === 0 && guideFocusKey === 'notes-first-row'
                                  ? 'relative z-[30] outline outline-4 outline-yellow-300 animate-pulse bg-yellow-50'
                                  : ''
                              }`}
                              onClick={() => {
                                setGuideFocusKey(null)
                                setNoteModal({ mode: 'edit', note: n })
                              }}
                            >
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateUTC(n.Date)}</td>
                              <td className="px-3 py-2 break-words align-top">{n.Note}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{n.Staff}</td>
                            </tr>
                          ))
                        )
                      })()}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between px-4 sm:px-6 py-2 bg-gray-50 border-t border-gray-200 flex-shrink-0">
              <div />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncGoogleContact}
                  disabled={syncingGoogleContact}
                  className={`inline-flex items-center gap-1.5 rounded-lg bg-green-600 text-white px-3 py-1.5 text-sm font-semibold ${
                    syncingGoogleContact ? 'opacity-70 cursor-not-allowed' : 'hover:bg-green-700 cursor-pointer'
                  }`}
                  title="Create or resync this student's Google Contact"
                >
                  {syncingGoogleContact ? 'Syncing...' : 'Create/Resync Google Contact'}
                </button>
                {!bookingExcluded && (
                  <button
                    type="button"
                    onClick={openBookingFlow}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-blue-700 cursor-pointer"
                  >
                    <Calendar className="w-4 h-4" />
                    Book lesson
                  </button>
                )}
                {student?.Group === 'Group' && (
                  <button
                    type="button"
                    onClick={handleOpenGroupLinkLesson}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-purple-600 bg-white px-3 py-1.5 text-sm font-semibold text-purple-700 hover:bg-purple-50 cursor-pointer"
                  >
                    Manage Group Members
                  </button>
                )}
                <button
                  onClick={() => {
                    setGuideHighlightDeleteInEdit(guideFocusKey === 'student-delete')
                    setGuideFocusKey(null)
                    setEditStudentModal(true)
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 cursor-pointer ${
                    guideFocusKey === 'student-edit' || guideFocusKey === 'student-delete'
                      ? 'relative z-[30] ring-4 ring-yellow-300 animate-pulse shadow-xl bg-yellow-50'
                      : ''
                  }`}
                >
                  Edit
                </button>
                <button
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 text-white px-3 py-1.5 text-sm font-semibold hover:bg-black cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </>
          </ModalErrorBoundary>
        )}
      </div>
    </div>

    {paymentModal && (
      <PaymentModal
        studentId={studentId}
        student={student}
        mode={paymentModal.mode}
        payment={paymentModal.payment}
        onSave={() => fetchData({ silent: true })}
        onClose={() => setPaymentModal(null)}
      />
    )}
    {noteModal && (
      <NoteModal
        studentId={studentId}
        mode={noteModal.mode}
        note={noteModal.note}
        onSave={() => fetchData({ silent: true })}
        onClose={() => setNoteModal(null)}
      />
    )}
    {editStudentModal && (
      <EditStudentModal
        studentId={studentId}
        student={student}
        highlightDeleteButton={guideHighlightDeleteInEdit}
        onSave={() => {
          fetchData()
          onStudentUpdated?.()
        }}
        onDeleted={() => {
          setGuideHighlightDeleteInEdit(false)
          onStudentDeleted?.()
          onClose()
        }}
        onClose={() => {
          setGuideHighlightDeleteInEdit(false)
          setEditStudentModal(false)
        }}
      />
    )}
    {bookLessonModal && !bookingExcluded && (
      <BookLessonModal
        studentId={studentId}
        student={student}
        preloadedLatestByMonth={bookingLatestByMonth}
        studentGroup={studentGroup}
        overridePaidLessons={overridePaidLessons}
        onClose={() => {
          setBookLessonModal(false)
          setOverridePaidLessons(null)
          setRescheduleSourceLesson(null)
        }}
        onBooked={() => {
          fetchData({ silent: true })
          setScheduleRefreshKey((k) => k + 1)
        }}
        onOptimisticScheduleMutation={handleOptimisticScheduleMutation}
        rescheduleSource={rescheduleSourceLesson}
      />
    )}
    {preBookLessonModal && !bookingExcluded && (
      <PreBookLessonModal
        onClose={() => {
          setPreBookLessonModal(false)
          setOverridePaidLessons(null)
        }}
        onConfirm={async (x) => {
          try {
            await api.upsertStudentMonthLessons({
              student_id: studentId,
              month: getCurrentJstYyyyMm(),
              lessons: x,
            })
          } catch (e) {
            setError(e?.message || 'Failed to save monthly lesson count')
            return
          }
          setOverridePaidLessons(x)
          setPreBookLessonModal(false)
          setBookLessonModal(true)
          await fetchData({ silent: true })
        }}
      />
    )}
    {groupLinkModalOpen && student && (
      <GroupLinkModal
        student={student}
        initialGroup={studentGroup}
        onClose={() => {
          setGroupLinkModalOpen(false)
        }}
        onSave={handleSaveGroupLesson}
        onUnlink={handleUnlinkGroupLesson}
      />
    )}
    </>,
    document.body
  )
}
