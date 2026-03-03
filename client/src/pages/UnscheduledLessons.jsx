import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import StudentDetailsModal from '../components/StudentDetailsModal'

function StatusBadge({ status }) {
  const cls =
    status === 'Active'
      ? 'badge-status-active'
      : status === 'Dormant'
        ? 'badge-status-dormant'
        : 'badge-status-demo'
  return <span className={`badge ${cls}`}>{status || 'Active'}</span>
}

export default function UnscheduledLessons() {
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedStudentId, setSelectedStudentId] = useState(null)

  useEffect(() => {
    api
      .getUnscheduledLessonsStudents()
      .then(setStudents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const fetchStudents = () => {
    api.getUnscheduledLessonsStudents().then(setStudents).catch((e) => setError(e.message))
  }

  return (
    <div className="w-full flex flex-col">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900">未定 (No lessons this month)</h2>
        <Link
          to="/students"
          className="text-green-600 font-medium hover:underline cursor-pointer"
        >
          ← All Students
        </Link>
      </div>
      {loading && <div className="py-8 text-slate-500">Loading...</div>}
      {error && (
        <div className="py-4 text-red-600">
          {/postgres|connection|ECONNREFUSED|28P01|password/i.test(error)
            ? 'Database connection failed. Check PostgreSQL and .env.'
            : `Error: ${error}`}
        </div>
      )}
      {!loading && !error && (
        <>
          <p className="mb-2 text-slate-600 text-sm">
            Active students with no scheduled lessons for the current month.
          </p>
          <div className="relative overflow-auto max-h-[70vh] w-full rounded-xl border border-black/5 bg-white shadow-sm">
            <table className="min-w-full border-separate border-spacing-0">
              <thead className="sticky top-0 bg-green-600 text-white shadow">
                <tr>
                  <th className="px-3 py-2 text-center font-semibold">ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-semibold">漢字</th>
                  <th className="px-3 py-2 text-left font-semibold">Email</th>
                  <th className="px-3 py-2 text-left font-semibold">Phone</th>
                  <th className="px-3 py-2 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
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
                      <span className="text-green-700 font-medium">{s.Name}</span>
                    </td>
                    <td className="text-left px-3 py-2">{s.漢字}</td>
                    <td className="text-left px-3 py-2">{s.Email}</td>
                    <td className="text-left px-3 py-2">{s.Phone}</td>
                    <td className="text-center px-3 py-2">
                      <StatusBadge status={s.Status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-slate-600 text-sm">
            {students.length} student{students.length !== 1 ? 's' : ''} (未定)
          </p>
        </>
      )}
      {selectedStudentId && (
        <StudentDetailsModal
          studentId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          onStudentDeleted={fetchStudents}
        />
      )}
    </div>
  )
}
