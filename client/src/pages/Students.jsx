import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from '../components/StudentDetailsModal'
import AddStudentModal from '../components/AddStudentModal'

function StatusBadge({ status }) {
  const cls =
    status === 'Active'
      ? 'badge-status-active'
      : status === 'Dormant'
        ? 'badge-status-dormant'
        : 'badge-status-demo'
  return <span className={`badge ${cls}`}>{status || 'Active'}</span>
}

function PaymentBadge({ payment }) {
  const normalized = String(payment || 'NEO')
  const cls = normalized === 'NEO' ? 'badge-pay-neo' : 'badge-pay-old'
  const label =
    normalized === "Owner's Course" || normalized === "Owner's Lesson"
      ? 'Owner'
      : normalized
  return <span className={`badge ${cls}`}>{label}</span>
}

function pickGuideStudent(students) {
  if (!Array.isArray(students) || students.length === 0) return null

  const byTarouTanaka = students.find((s) => String(s?.Name || '').trim().toLowerCase() === 'tarou tanaka')
  if (byTarouTanaka) return byTarouTanaka

  const byExactAdmin = students.find((s) => String(s?.Name || '').trim().toLowerCase() === 'admin')
  if (byExactAdmin) return byExactAdmin

  const byAdminKeyword = students.find((s) =>
    /admin/i.test(`${s?.Name || ''} ${s?.漢字 || ''} ${s?.Email || ''}`)
  )
  if (byAdminKeyword) return byAdminKeyword

  const byTrialOrDemo = students.find((s) => {
    const status = String(s?.Status || '').toLowerCase()
    return status.includes('trial') || status.includes('demo')
  })
  if (byTrialOrDemo) return byTrialOrDemo

  return students[0]
}

export default function Students() {
  const location = useLocation()
  const navigate = useNavigate()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [guideAction, setGuideAction] = useState(null)
  const [highlightAddButton, setHighlightAddButton] = useState(false)
  const [guideTargetStudentId, setGuideTargetStudentId] = useState(null)

  useEffect(() => {
    if (location.state?.openAddModal) {
      setShowAddModal(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state?.openAddModal, location.pathname, navigate])

  useEffect(() => {
    const handleGuideEnded = () => {
      setShowAddModal(false)
      setSelectedStudentId(null)
      setGuideTargetStudentId(null)
      setGuideAction(null)
      setHighlightAddButton(false)
    }
    window.addEventListener('guide:ended', handleGuideEnded)
    return () => window.removeEventListener('guide:ended', handleGuideEnded)
  }, [])

  useEffect(() => {
    const action = location.state?.guideAction
    if (!action) return

    const isStudentFlowAction =
      action.startsWith('students.') || action.startsWith('payments.') || action.startsWith('notes.')
    const keepDetailsOpenIfAlreadyOpen =
      action === 'students.edit' || action === 'students.delete'

    // Reset transient highlight state each step.
    setGuideTargetStudentId(null)
    setGuideAction(null)
    setHighlightAddButton(false)

    if (action === 'students.create') {
      // Create step always starts from list + Add button highlight.
      setShowAddModal(false)
      setSelectedStudentId(null)
      setHighlightAddButton(true)
      navigate(location.pathname, { replace: true, state: {} })
      return
    }

    if (isStudentFlowAction) {
      // Close Add modal for non-create steps.
      setShowAddModal(false)
      // For edit/delete step transitions, keep details modal if user already has it open.
      // If it's closed, this stays null and row highlight fallback will drive reopening.
      if (!(keepDetailsOpenIfAlreadyOpen && selectedStudentId !== null)) {
        setSelectedStudentId(null)
      }
      setGuideAction(action)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state?.guideAction, location.state?.guideNonce, location.pathname, navigate, selectedStudentId])

  useEffect(() => {
    if (!highlightAddButton) return
    const t = setTimeout(() => setHighlightAddButton(false), 5000)
    return () => clearTimeout(t)
  }, [highlightAddButton])

  useEffect(() => {
    if (!guideAction || selectedStudentId !== null) return
    if (students.length === 0) {
      setError('Guide step needs at least one student record.')
      return
    }
    const target = pickGuideStudent(students)
    setGuideTargetStudentId(target?.ID ?? null)
  }, [guideAction, selectedStudentId, students])

  useEffect(() => {
    if (guideTargetStudentId == null) return
    const t = setTimeout(() => setGuideTargetStudentId(null), 7000)
    return () => clearTimeout(t)
  }, [guideTargetStudentId])

  useEffect(() => {
    const minDelay = new Promise((r) => setTimeout(r, 1000))
    Promise.all([api.getStudents(), minDelay])
      .then(([data]) => setStudents(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const fetchStudents = () => {
    api.getStudents().then(setStudents).catch((e) => setError(e.message))
  }

  const filtered = students.filter(
    (s) =>
      !search ||
      (s.Name || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.漢字 || '').includes(search) ||
      (s.Email || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.Phone || '').includes(search)
  )

  const headerAndSearch = (
    <>
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900">Student List</h2>
        <button
          type="button"
          id="guide-add-student-button"
          onClick={() => {
            setShowAddModal(true)
            setHighlightAddButton(false)
          }}
          className={`px-4 py-2 bg-green-600 border border-white text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium cursor-pointer ${
            highlightAddButton ? 'relative z-[70] ring-4 ring-yellow-300 animate-pulse shadow-2xl' : ''
          }`}
        >
          <UserPlus className="w-4 h-4" />
          <span>Add Student</span>
        </button>
      </div>
      <div className="mb-4 search-container">
        <label htmlFor="searchInput" className="sr-only">Search</label>
        <input
          id="searchInput"
          type="search"
          placeholder="Search by name, kana, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          style={{ fontSize: '1.5rem', height: '3.5rem' }}
        />
      </div>
    </>
  );

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-gray-100"
        aria-label="Loading"
      >
        <div className="relative w-24 h-24 flex items-center justify-center">
          <div className="students-loading-spinner-ring absolute inset-0 rounded-full border-4 border-gray-200 border-t-green-600" />
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-sm font-medium text-gray-700 whitespace-nowrap"
            style={{ pointerEvents: 'none' }}
          >
            Green Square
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col h-full min-h-0">
      {headerAndSearch}
      {error && (
        <div className="py-4 text-red-600 flex-shrink-0">
          {/postgres|connection|ECONNREFUSED|28P01|password/i.test(error)
            ? 'Database connection failed. Check PostgreSQL is running and .env has correct DATABASE_URL. Restart the API server.'
            : `Error: ${error}`}
        </div>
      )}
      {!error && (
      <>
      <div className="student-table-container relative flex-1 min-h-0 overflow-auto w-full rounded-xl border border-black/5 shadow-sm">
        <table id="studentTable" className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 bg-green-600 text-white shadow">
            <tr>
              <th className="px-3 py-2 text-center font-semibold">ID</th>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-center font-semibold">漢字</th>
              <th className="px-3 py-2 text-center font-semibold">email</th>
              <th className="px-3 py-2 text-center font-semibold">phone</th>
              <th className="px-3 py-2 text-center font-semibold">当日 Cancellation</th>
              <th className="px-3 py-2 text-center font-semibold">Status</th>
              <th className="px-3 py-2 text-center font-semibold">Payment</th>
              <th className="px-3 py-2 text-center font-semibold">Group</th>
              <th className="px-3 py-2 text-center font-semibold">人数</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.ID}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setGuideTargetStudentId(null)
                  setSelectedStudentId(s.ID)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  setGuideTargetStudentId(null)
                  setSelectedStudentId(s.ID)
                }}
                className={`cursor-pointer ${guideTargetStudentId === s.ID ? 'relative z-[70] outline outline-4 outline-yellow-300 animate-pulse bg-yellow-50/80' : ''}`}
              >
                <td className="text-center px-3 py-2">{s.ID}</td>
                <td className="text-left px-3 py-2">
                  <span className="text-green-700 font-medium">
                    {s.Name}
                  </span>
                </td>
                <td className="text-center px-3 py-2">{s.漢字}</td>
                <td className="text-center px-3 py-2">{s.Email}</td>
                <td className="text-center px-3 py-2">
                  <span>{s.Phone}</span>
                  {s.子 && (
                    <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      子
                    </span>
                  )}
                </td>
                <td className="text-center px-3 py-2">{s.当日}</td>
                <td className="text-center px-3 py-2">
                  <StatusBadge status={s.Status} />
                </td>
                <td className="text-center px-3 py-2">
                  <PaymentBadge payment={s.Payment} />
                </td>
                <td className="text-center px-3 py-2">{s.Group}</td>
                <td className="text-center px-3 py-2">{s.人数}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-slate-600 text-sm flex-shrink-0">
        {filtered.length} student{filtered.length !== 1 ? 's' : ''}
      </p>
      </>
      )}
      {selectedStudentId !== null && (
        <StudentDetailsModal
          studentId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          onStudentDeleted={fetchStudents}
          onStudentUpdated={fetchStudents}
          guideAction={guideAction}
          onGuideActionHandled={() => setGuideAction(null)}
        />
      )}
      {showAddModal && (
        <AddStudentModal
          onClose={() => setShowAddModal(false)}
          onAdded={(id) => {
            fetchStudents()
            setSelectedStudentId(id)
            setShowAddModal(false)
          }}
        />
      )}
      {(highlightAddButton || guideTargetStudentId != null) && (
        <div
          className="fixed inset-0 bg-black/45 z-[60]"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
