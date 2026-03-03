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
  const cls = payment === 'NEO' ? 'badge-pay-neo' : 'badge-pay-old'
  return <span className={`badge ${cls}`}>{payment || 'NEO'}</span>
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

  useEffect(() => {
    if (location.state?.openAddModal) {
      setShowAddModal(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state?.openAddModal, location.pathname, navigate])

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
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-green-600 border border-white text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium cursor-pointer"
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
              <th className="px-3 py-2 text-center font-semibold">子</th>
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
                onClick={() => setSelectedStudentId(s.ID)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedStudentId(s.ID)}
                className="cursor-pointer"
              >
                <td className="text-center px-3 py-2">{s.ID}</td>
                <td className="text-left px-3 py-2">
                  <span className="text-green-700 font-medium">
                    {s.Name}
                  </span>
                </td>
                <td className="text-center px-3 py-2">{s.漢字}</td>
                <td className="text-center px-3 py-2">{s.子 ? '子' : ''}</td>
                <td className="text-center px-3 py-2">{s.Email}</td>
                <td className="text-center px-3 py-2">{s.Phone}</td>
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
      {selectedStudentId && (
        <StudentDetailsModal
          studentId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          onStudentDeleted={fetchStudents}
          onStudentUpdated={fetchStudents}
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
    </div>
  )
}
