import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { User, Type, Phone, Mail, BadgeCheck, CreditCard, CalendarX, Baby, Users, Hash } from 'lucide-react'
import { api } from '../api'
import ConfirmActionModal from './ConfirmActionModal'
import { useToast } from '../context/ToastContext'

function splitPhone(str) {
  const d = (str || '').replace(/[^0-9]/g, '').slice(0, 11)
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)]
}

function combinePhone(parts) {
  const [a, b, c] = parts
  const filtered = [a, b, c].filter(Boolean)
  return filtered.length ? filtered.join('-') : ''
}

export default function EditStudentModal({ studentId, student, onSave, onDeleted, onClose }) {
  const { success } = useToast()
  const [form, setForm] = useState({
    Name: '',
    漢字: '',
    phone1: '',
    phone2: '',
    phone3: '',
    Email: '',
    Status: 'Active',
    Payment: 'NEO',
    当日: '未',
    子: false,
    Group: 'Single',
    人数: '2',
  })
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (student) {
      const [p1, p2, p3] = splitPhone(student.Phone || student.phone || '')
      setForm({
        Name: student.Name || student.name || '',
        漢字: student.漢字 || student.name_kanji || '',
        phone1: p1 || '',
        phone2: p2 || '',
        phone3: p3 || '',
        Email: student.Email || student.email || '',
        Status: student.Status || student.status || 'Active',
        Payment: (student.Payment || student.payment || 'NEO') === "Owner's Lesson" ? "Owner's Course" : (student.Payment || student.payment || 'NEO'),
        当日: student.当日 || student.same_day_cancel || '未',
        子: !!(student.子 === '子' || student.is_child),
        Group: student.Group === 'Group' ? 'Group' : 'Single',
        人数: String(student.人数 ?? student.group_size ?? '2'),
      })
    }
  }, [student])

  const phone = combinePhone([form.phone1, form.phone2, form.phone3])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api.updateStudent(studentId, {
        Name: form.Name.trim(),
        漢字: form.漢字.trim() || undefined,
        Phone: phone || undefined,
        Email: form.Email.trim() || undefined,
        Status: form.Status,
        Payment: form.Payment,
        当日: form.当日,
        子: form.子 ? '子' : '',
        is_child: form.子,
        Group: form.Group,
        人数: form.Group === 'Group' ? form.人数 : undefined,
      })
      success('Student updated')
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api.deleteStudent(studentId)
      success('Student deleted')
      onDeleted?.()
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!student) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8 bg-black/50 overflow-auto"
      onClick={handleBackdropClick}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-white modal-card ring-1 ring-black/5"
      >
        <header className="flex items-center justify-between px-4 py-3 bg-green-600 text-white">
          <h3 className="text-lg font-semibold">Edit Student</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20 cursor-pointer">
            Close
          </button>
        </header>

        <div className="p-4 space-y-6">
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-500" />
                  <span>Name <span className="text-rose-600">*</span></span>
                </label>
                <input
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder="Tarou Tanaka"
                  value={form.Name}
                  onChange={(e) => setForm((f) => ({ ...f, Name: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <Type className="h-4 w-4 text-gray-500" />
                  <span>漢字 <span className="text-rose-600">*</span></span>
                </label>
                <input
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder="田中 太郎"
                  value={form.漢字}
                  onChange={(e) => setForm((f) => ({ ...f, 漢字: e.target.value }))}
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-500" />
                  <span>Phone <span className="text-rose-600">*</span></span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    inputMode="numeric"
                    maxLength={3}
                    className="w-16 rounded-md border border-gray-300 px-2 py-2 text-center"
                    placeholder="XXX"
                    value={form.phone1}
                    onChange={(e) => setForm((f) => ({ ...f, phone1: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                  />
                  <span className="text-gray-400">-</span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    className="w-20 rounded-md border border-gray-300 px-2 py-2 text-center"
                    placeholder="0000"
                    value={form.phone2}
                    onChange={(e) => setForm((f) => ({ ...f, phone2: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  />
                  <span className="text-gray-400">-</span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    className="w-20 rounded-md border border-gray-300 px-2 py-2 text-center"
                    placeholder="0000"
                    value={form.phone3}
                    onChange={(e) => setForm((f) => ({ ...f, phone3: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-500" />
                  <span>Email <span className="text-rose-600">*</span></span>
                </label>
                <input
                  type="email"
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  placeholder="name@example.com"
                  value={form.Email}
                  onChange={(e) => setForm((f) => ({ ...f, Email: e.target.value }))}
                />
              </div>
            </div>
          </section>

          <section>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
              <div className="sm:col-span-1">
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-gray-500" />
                  <span>Status</span>
                </label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  value={form.Status}
                  onChange={(e) => setForm((f) => ({ ...f, Status: e.target.value }))}
                >
                  <option>Active</option>
                  <option>Dormant</option>
                  <option>DEMO</option>
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-gray-500" />
                  <span>Payment Type</span>
                </label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  value={form.Payment}
                  onChange={(e) => setForm((f) => ({ ...f, Payment: e.target.value }))}
                >
                  <option>NEO</option>
                  <option>OLD</option>
                  <option>Owner&apos;s Course</option>
                  <option>SHAM</option>
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <CalendarX className="h-4 w-4 text-gray-500" />
                  <span>当日キャンセル</span>
                </label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  value={form.当日}
                  onChange={(e) => setForm((f) => ({ ...f, 当日: e.target.value }))}
                >
                  <option>未</option>
                  <option>済</option>
                </select>
              </div>
              <div className="sm:col-span-1 flex items-end">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={form.子}
                    onChange={(e) => setForm((f) => ({ ...f, 子: e.target.checked }))}
                  />
                  <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    <Baby className="h-4 w-4 text-gray-500" />
                    <span>子 (Child)</span>
                  </span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mt-3">
              <div>
                <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                  <Users className="h-4 w-4 text-gray-500" />
                  <span>Group</span>
                </label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2"
                  value={form.Group}
                  onChange={(e) => setForm((f) => ({ ...f, Group: e.target.value }))}
                >
                  <option value="Single">Individual</option>
                  <option value="Group">Group</option>
                </select>
              </div>
              {form.Group === 'Group' && (
                <div>
                  <label className="block font-semibold text-gray-800 mb-1 flex items-center gap-2">
                    <Hash className="h-4 w-4 text-gray-500" />
                    <span>人数 (Group Size)</span>
                  </label>
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
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
          </section>
        </div>

        {error && <p className="px-4 text-red-600 text-sm">{error}</p>}

        <footer className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
            className="rounded-md bg-rose-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold hover:bg-gray-50 cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-green-600 text-white px-4 py-1.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </form>
      {showDeleteConfirm && (
        <ConfirmActionModal
          title="Delete Student"
          message="Are you sure you want to delete this student? This cannot be undone."
          confirmLabel="Delete"
          destructive
          confirming={deleting}
          onConfirm={handleDelete}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>,
    document.body
  )
}
