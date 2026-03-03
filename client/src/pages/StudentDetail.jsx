import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api } from '../api'
import { formatMonth, formatDate } from '../utils/format'

function StatusBadge({ status }) {
  const cls =
    status === 'Active'
      ? 'badge-status-active'
      : status === 'Dormant'
        ? 'badge-status-dormant'
        : 'badge-status-demo'
  return <span className={`badge ${cls}`}>{status || 'Active'}</span>
}

export default function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [payments, setPayments] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    if (id === 'new') {
      setLoading(false)
      navigate('/students', { replace: true, state: { openAddModal: true } })
      return
    }
    Promise.all([
      api.getStudent(id),
      api.getPayments(),
      api.getNotes(id),
    ])
      .then(([s, p, n]) => {
        setStudent(s)
        setPayments((p || []).filter((x) => String(x['Student ID']) === String(id)))
        setNotes(n || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, navigate])

  if (loading) return <div className="p-4">Loading...</div>
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>
  if (!student) return <div className="p-4">Student not found</div>

  return (
    <div className="p-4">
      <Link
        to="/students"
        className="inline-flex items-center gap-2 text-green-600 hover:underline mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Students
      </Link>
      <div className="details-card">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold">
              {student.Name}
              {student.子 && <span className="badge-child ml-2">子</span>}
            </h1>
            <p className="text-slate-600">{student.漢字}</p>
          </div>
          <div className="flex gap-2">
            <StatusBadge status={student.Status} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-slate-600 text-sm">Email</p>
            <p>{student.Email}</p>
          </div>
          <div>
            <p className="text-slate-600 text-sm">Phone</p>
            <p>{student.Phone}</p>
          </div>
          <div>
            <p className="text-slate-600 text-sm">Payment</p>
            <p>{student.Payment}</p>
          </div>
          <div>
            <p className="text-slate-600 text-sm">Group</p>
            <p>{student.Group} {student.人数 && `(${student.人数})`}</p>
          </div>
        </div>
        <div className="mb-6">
          <h2 className="font-semibold mb-2">Payments</h2>
          <div className="payments-scroll max-h-40 overflow-auto border rounded">
            <table className="table w-full text-sm">
              <thead>
                <tr className="bg-blue-600 text-white">
                  <th className="min-w-[7rem] whitespace-nowrap">Date</th>
                  <th>Month</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 10).map((p) => (
                  <tr key={p['Transaction ID']}>
                    <td className="min-w-[7rem] whitespace-nowrap">{formatDate(p.Date)}</td>
                    <td>{formatMonth(p.Month)}</td>
                    <td>¥{Number(p.Total).toLocaleString()}</td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-slate-500 text-center py-4">
                      No payments
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Notes</h2>
          <div className="notes-scroll max-h-40 overflow-auto border rounded">
            <table className="table w-full text-sm">
              <thead>
                <tr className="bg-green-600 text-white">
                  <th className="min-w-[7rem] whitespace-nowrap">Date</th>
                  <th>Staff</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {notes.slice(0, 10).map((n) => (
                  <tr key={n.ID}>
                    <td className="min-w-[7rem] whitespace-nowrap">{formatDate(n.Date)}</td>
                    <td>{n.Staff}</td>
                    <td>{n.Note}</td>
                  </tr>
                ))}
                {notes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-slate-500 text-center py-4">
                      No notes
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
