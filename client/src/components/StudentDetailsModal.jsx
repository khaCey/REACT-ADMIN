import { useState, useEffect, Component } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Calendar } from 'lucide-react'
import { api } from '../api'
import { formatMonth, formatNumber, formatDate } from '../utils/format'
import PaymentModal from './PaymentModal'
import NoteModal from './NoteModal'
import EditStudentModal from './EditStudentModal'
import LessonsThisMonth from './LessonsThisMonth'
import BookLessonModal from './BookLessonModal'

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

export default function StudentDetailsModal({ studentId, onClose, onStudentDeleted, onStudentUpdated }) {
  const [student, setStudent] = useState(null)
  const [payments, setPayments] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [paymentModal, setPaymentModal] = useState(null)
  const [noteModal, setNoteModal] = useState(null)
  const [editStudentModal, setEditStudentModal] = useState(false)
  const [bookLessonModal, setBookLessonModal] = useState(false)
  const [noteSearch, setNoteSearch] = useState('')

  const fetchData = () => {
    if (!studentId) return
    setLoading(true)
    setError(null)
    Promise.all([
      api.getStudent(studentId),
      api.getPayments(),
      api.getNotes(studentId),
    ])
      .then(([s, p, n]) => {
        setStudent(s)
        setPayments((p || []).filter((x) => String(x['Student ID']) === String(studentId)))
        setNotes(n || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchData()
  }, [studentId])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  useEffect(() => {
    if (!studentId) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [studentId, onClose])

  if (!studentId) return null

  return createPortal(
    <>
    <div
      id="detailsModalRoot"
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 sm:p-8 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-[1400px] h-[90vh] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-green-600 animate-spin" />
          </div>
        )}

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
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {student.Group === 'Group' && <span className="badge bg-purple-600 text-white">Group</span>}
                {(student.Payment || '').toLowerCase().includes('owner') && <span className="badge bg-black text-white">Owner</span>}
                <StatusBadge status={student.Status} />
                {student.子 && <span className="badge badge-child">子</span>}
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
                  onBookLesson={() => setBookLessonModal(true)}
                  sectionClassName="hidden xl:flex rounded-xl border border-gray-200 bg-white shadow-card h-[200px] flex-col overflow-hidden w-[576px]"
                />

                <section className="rounded-xl border border-gray-200 bg-white shadow h-[200px] flex flex-col overflow-hidden">
                  <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
                    <h3 className="font-semibold text-sm">All Payments</h3>
                    <button
                      type="button"
                      onClick={() => setPaymentModal({ mode: 'add' })}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-green-700 cursor-pointer"
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
                            className={`cursor-pointer hover:bg-gray-200 ${i % 2 === 1 ? 'bg-slate-200' : 'bg-white'}`}
                            onClick={() => setPaymentModal({ mode: 'edit', payment: p })}
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
                      onClick={() => setNoteModal({ mode: 'add' })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 cursor-pointer"
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
                              className={`cursor-pointer hover:bg-gray-200 ${i % 2 === 1 ? 'bg-slate-200' : 'bg-white'}`}
                              onClick={() => setNoteModal({ mode: 'edit', note: n })}
                            >
                              <td className="px-3 py-2 whitespace-nowrap">{formatDate(n.Date)}</td>
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
                  onClick={() => setBookLessonModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-blue-700 cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  Book lesson
                </button>
                <button
                  onClick={() => setEditStudentModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 cursor-pointer"
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
        onSave={fetchData}
        onClose={() => setPaymentModal(null)}
      />
    )}
    {noteModal && (
      <NoteModal
        studentId={studentId}
        mode={noteModal.mode}
        note={noteModal.note}
        onSave={fetchData}
        onClose={() => setNoteModal(null)}
      />
    )}
    {editStudentModal && (
      <EditStudentModal
        studentId={studentId}
        student={student}
        onSave={() => {
          fetchData()
          onStudentUpdated?.()
        }}
        onDeleted={() => {
          onStudentDeleted?.()
          onClose()
        }}
        onClose={() => setEditStudentModal(false)}
      />
    )}
    {bookLessonModal && (
      <BookLessonModal
        studentId={studentId}
        student={student}
        onClose={() => setBookLessonModal(false)}
        onBooked={fetchData}
      />
    )}
    </>,
    document.body
  )
}
