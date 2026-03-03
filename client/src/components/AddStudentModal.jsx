import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'

const initialForm = {
  Name: '',
  漢字: '',
  phone1: '',
  phone2: '',
  phone3: '',
  Email: '',
  Group: 'Individual',
  人数: '2',
  子: false,
}

export default function AddStudentModal({ onClose, onAdded }) {
  const { success } = useToast()
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState(null)

  const combinePhone = () => {
    const p1 = (form.phone1 || '').trim()
    const p2 = (form.phone2 || '').trim()
    const p3 = (form.phone3 || '').trim()
    if (!p1 && !p2 && !p3) return ''
    return `${p1}-${p2}-${p3}`
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setErr(null)
    try {
      const payload = {
        Name: form.Name.trim(),
        漢字: form.漢字.trim(),
        Phone: combinePhone(),
        Email: form.Email.trim(),
        Status: 'DEMO',
        Payment: 'NEO',
        当日: '未',
        Group: form.Group,
        人数: form.Group === 'Group' ? (form.人数 || '2') : '1',
        子: form.子 ? '子' : '',
      }
      const { id } = await api.addStudent(payload)
      success('Student created')
      onAdded?.(id)
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Add Student</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-rose-600">*</span></label>
            <input
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              value={form.Name}
              onChange={(e) => setForm((f) => ({ ...f, Name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">漢字 <span className="text-rose-600">*</span></label>
            <input
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              value={form.漢字}
              onChange={(e) => setForm((f) => ({ ...f, 漢字: e.target.value }))}
              placeholder="田中 太郎"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone <span className="text-rose-600">*</span></label>
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                pattern="[0-9]{3}"
                maxLength={3}
                required
                className="w-16 border border-gray-300 rounded-lg px-2 py-2 text-center focus:ring-2 focus:ring-green-500"
                placeholder="090"
                value={form.phone1}
                onChange={(e) => setForm((f) => ({ ...f, phone1: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
              />
              <span className="text-gray-400">-</span>
              <input
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-center focus:ring-2 focus:ring-green-500"
                placeholder="0000"
                value={form.phone2}
                onChange={(e) => setForm((f) => ({ ...f, phone2: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              />
              <span className="text-gray-400">-</span>
              <input
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-center focus:ring-2 focus:ring-green-500"
                placeholder="0000"
                value={form.phone3}
                onChange={(e) => setForm((f) => ({ ...f, phone3: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email <span className="text-rose-600">*</span></label>
            <input
              type="email"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              value={form.Email}
              onChange={(e) => setForm((f) => ({ ...f, Email: e.target.value }))}
              placeholder="name@example.com"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Group</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500"
                value={form.Group}
                onChange={(e) => setForm((f) => ({ ...f, Group: e.target.value }))}
              >
                <option value="Individual">Individual</option>
                <option value="Group">Group</option>
              </select>
            </div>
            {form.Group === 'Group' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">人数 (Group Size)</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500"
                  value={form.人数}
                  onChange={(e) => setForm((f) => ({ ...f, 人数: e.target.value }))}
                >
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="add-modal-isChild"
              checked={form.子}
              onChange={(e) => setForm((f) => ({ ...f, 子: e.target.checked }))}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <label htmlFor="add-modal-isChild" className="text-sm text-slate-700">子 (Child)</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Add Student'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
