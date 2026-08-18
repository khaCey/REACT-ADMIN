import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { api } from '../api'
import { sendStudentLineLinkEmail } from '../api/studentLineEmail'
import FullPageLoading from '../components/FullPageLoading'
import { formatMonth, formatDate, formatDateUTC } from '../utils/format'

import StudentStatusBadge from '../components/StudentStatusBadge'

export default function StudentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [payments, setPayments] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lineEmailSending, setLineEmailSending] = useState(false)
  const [lineEmailResult, setLineEmailResult] = useState(null)

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

  const handleSendLineEmail = async () => {
    const email = String(student?.Email || '').trim()
    if (!email) {
      setLineEmailResult({
        type: 'error',
        message: 'この生徒にはメールアドレスが登録されていません。',
      })
      return
    }

    const confirmed = window.confirm(
      `${student.Name || 'この生徒'}の登録メールアドレス（${email}）にLINE連携のテストメールを送信します。\n\n現在のメールにはテスト用リンクが入ります。送信しますか？`
    )
    if (!confirmed) return

    setLineEmailSending(true)
    setLineEmailResult(null)
    try {
      const result = await sendStudentLineLinkEmail(id)
      setLineEmailResult({
        type: 'success',
        message: `LINE連携メールを送信しました。送信先: ${result.recipientMasked || email}`,
      })
    } catch (err) {
      setLineEmailResult({
        type: 'error',
        message: err?.message || 'LINE連携メールを送信できませんでした。',
      })
    } finally {
      setLineEmailSending(false)
    }
  }

  if (loading) {
    return <FullPageLoading />
  }
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
            <StudentStatusBadge status={student.Status} />
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

        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-emerald-700" />
                <h2 className="font-semibold text-slate-900">LINE連携</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  メール送信テスト
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                登録されているメールアドレスへ、LINE予約サービスの連携案内を送信します。
                現在はメール機能確認用のテストリンクを送信します。
              </p>
            </div>
            <button
              type="button"
              onClick={handleSendLineEmail}
              disabled={lineEmailSending || !String(student.Email || '').trim()}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mail className="h-4 w-4" />
              {lineEmailSending ? '送信中...' : 'LINE連携メールを送信'}
            </button>
          </div>

          {!String(student.Email || '').trim() && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              メールアドレスが登録されていないため送信できません。
            </p>
          )}

          {lineEmailResult && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                lineEmailResult.type === 'success'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {lineEmailResult.message}
            </p>
          )}
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
                    <td className="min-w-[7rem] whitespace-nowrap">{formatDateUTC(n.Date)}</td>
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
