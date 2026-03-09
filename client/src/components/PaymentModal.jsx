import { useState, useEffect } from 'react'
import { api } from '../api'
import { STAFF_OPTIONS } from '../constants/staff'
import { formatNumber } from '../utils/format'
import { calculatePrice } from '../../../shared/feeTable.js'
import { useToast } from '../context/ToastContext'
import { useGuideTour } from '../context/GuideTourContext'
import ConfirmActionModal from './ConfirmActionModal'
import { useAuth } from '../context/AuthContext'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function generateTransactionId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return `TXN_${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`
    }
  } catch {
    // Fall through to deterministic fallback
  }
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase()
  return `TXN_${fallback.slice(0, 8)}`
}

export default function PaymentModal({ studentId, student, mode = 'add', payment = null, onSave, onClose }) {
  const { success } = useToast()
  const { activeGuideSlug } = useGuideTour()
  const { staff: currentStaff } = useAuth()
  const preventDelete = !!activeGuideSlug
  const [form, setForm] = useState({
    transactionId: '',
    date: new Date().toISOString().slice(0, 10),
    month: MONTHS[new Date().getMonth()],
    year: String(new Date().getFullYear()),
    lessons: '',
    price: '',
    discount: '0',
    total: '',
    method: 'Card',
    staff: 'Staff',
  })
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState(null)

  const monthFromValue = (val) => {
    if (!val) return MONTHS[new Date().getMonth()]
    if (MONTHS.includes(val)) return val
    const m = String(val).match(/^\d{4}-(\d{2})$/)
    if (m) return MONTHS[parseInt(m[1], 10) - 1] || val
    return val
  }

  const defaultStaffName = currentStaff?.name && String(currentStaff.name).trim()
    ? String(currentStaff.name).trim()
    : 'Staff'

  useEffect(() => {
    if (mode === 'edit' && payment) {
      const d = payment.Date || payment.date || ''
      const dateStr = d ? new Date(d).toISOString().slice(0, 10) : ''
      const month = monthFromValue(payment.Month || payment.month)
      const year = payment.Year || payment.year || String(new Date().getFullYear())
      setForm({
        transactionId: payment['Transaction ID'] || payment.transactionId || '',
        date: dateStr,
        month: month,
        year: year,
        lessons: (() => { const a = payment.Amount ?? payment.lessons; return a != null && a !== '' ? formatNumber(a) : '' })(),
        price: payment.Total ?? payment.price ?? '',
        discount: String(payment.Discount ?? payment.discount ?? '0'),
        total: payment.Total ?? payment.price ?? '',
        method: payment.Method || payment.method || 'Card',
        staff: payment.Staff || payment.staff || defaultStaffName,
      })
    } else {
      setForm((f) => ({
        ...f,
        transactionId: generateTransactionId(),
        date: new Date().toISOString().slice(0, 10),
        month: MONTHS[new Date().getMonth()],
        staff: defaultStaffName,
        year: String(new Date().getFullYear()),
      }))
    }
  }, [mode, payment, defaultStaffName])

  const discountNum = Number(form.discount) || 0
  const priceNum = Number(form.price) || 0
  const totalValue = Math.round(priceNum * (1 - discountNum / 100))

  const handleLessonsChange = (val) => {
    const n = Number(val) || 0
    if (n > 0 && student) {
      const ratePerLesson = calculatePrice(n, student.Payment || 'NEO', student.Group || 'Single', student.人数 || 2, '4x')
      const totalPrice = n * ratePerLesson
      setForm((f) => ({ ...f, lessons: val, price: String(totalPrice) }))
    } else {
      setForm((f) => ({ ...f, lessons: val, price: '' }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const monthIdx = MONTHS.indexOf(form.month) + 1
      const monthCanonical = monthIdx >= 1 ? `${form.year}-${String(monthIdx).padStart(2, '0')}` : form.month
      const payload = {
        'Student ID': studentId,
        'Transaction ID': form.transactionId,
        Date: form.date,
        Year: form.year,
        Month: monthCanonical,
        Amount: form.lessons || 0,
        Discount: form.discount,
        Total: String(totalValue),
        Method: form.method,
        Staff: form.staff,
      }
      if (mode === 'add') {
        await api.addPayment(payload)
        success('Payment created')
      } else {
        await api.updatePayment(form.transactionId, payload)
        success('Payment updated')
      }
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleDelete = async () => {
    if (preventDelete) {
      setShowDeleteConfirm(false)
      return
    }
    if (!form.transactionId) return
    setDeleting(true)
    setError(null)
    try {
      await api.deletePayment(form.transactionId)
      success('Payment deleted')
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8 bg-black/50"
      onClick={handleBackdropClick}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold">{mode === 'edit' ? 'Edit Payment' : 'Add Payment'}</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 cursor-pointer">
            Close
          </button>
        </header>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="sm:col-span-2">
            <label className="block text-gray-600 mb-1">Transaction ID</label>
            <input
              value={form.transactionId}
              readOnly
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Month</label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.month}
                onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
              >
                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Lessons</label>
            <input
              type="number"
              min="0"
              value={form.lessons}
              onChange={(e) => handleLessonsChange(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Price</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.price}
              readOnly
              className="w-full rounded-md border border-gray-300 px-3 py-2 bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Discount</label>
            <select
              value={form.discount}
              onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="0">No Discount (0%)</option>
              <option value="10">10%</option>
              <option value="20">20%</option>
              <option value="25">25%</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Total</label>
            <input
              type="number"
              min="0"
              step="1"
              value={totalValue}
              readOnly
              className="w-full rounded-md border border-gray-300 px-3 py-2 bg-gray-100 font-semibold"
            />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Method</label>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option>Card</option>
              <option>Cash</option>
              <option>Bank</option>
              <option>PayPay</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Staff</label>
            <select
              value={form.staff}
              onChange={(e) => setForm((f) => ({ ...f, staff: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              {(STAFF_OPTIONS.includes(form.staff) ? STAFF_OPTIONS : [...STAFF_OPTIONS, form.staff]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="px-4 text-red-600 text-sm">{error}</p>}
        <footer className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
                className="rounded-md bg-rose-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-green-600 text-white px-4 py-1.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </form>
      {showDeleteConfirm && (
        <ConfirmActionModal
          title="Delete Payment"
          message="Are you sure you want to delete this payment?"
          confirmLabel="Delete"
          destructive
          confirming={deleting}
          onConfirm={handleDelete}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
