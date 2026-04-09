import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Calendar } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import ConfirmActionModal from './ConfirmActionModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'
import { GOOGLE_CALENDAR_EVENT_COLORS } from '../constants/googleCalendarColors'

const STAFF_TYPE_OPTIONS = [
  { value: 'japanese_staff', label: 'Japanese Staff' },
  { value: 'english_teacher', label: 'English Teacher' },
]

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'operator', label: 'Operator' },
  { value: 'admin', label: 'Admin' },
]

export default function EditStaffModal({ staff, onClose, onSaved, onDeleted }) {
  const { success } = useToast()
  const [calendar_id, setCalendarId] = useState(staff?.calendar_id ?? '')
  const [calendar_color_id, setCalendarColorId] = useState(staff?.calendar_color_id ?? '')
  const [staff_type, setStaffType] = useState(staff?.staff_type ?? 'japanese_staff')
  const [role, setRole] = useState(() =>
    staff?.is_admin ? 'admin' : staff?.is_operator ? 'operator' : 'staff'
  )
  const [active, setActive] = useState(staff?.active !== false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState('')
  const [fetchScheduleLoading, setFetchScheduleLoading] = useState(false)

  useEffect(() => {
    if (staff) {
      setCalendarId(staff.calendar_id ?? '')
      setCalendarColorId(staff.calendar_color_id ?? '')
      setStaffType(staff.staff_type ?? 'japanese_staff')
      setRole(staff.is_admin ? 'admin' : staff.is_operator ? 'operator' : 'staff')
      setActive(staff.active !== false)
    }
  }, [staff])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!staff?.id) return
    setError('')
    setSubmitting(true)
    try {
      const payload = {
        calendar_id: calendar_id.trim() || null,
        calendar_color_id: calendar_color_id === '' ? null : calendar_color_id,
        staff_type: staff_type,
        active,
      }
      if (staff.canEditRole) {
        payload.is_admin = role === 'admin'
        payload.is_operator = role === 'admin' || role === 'operator'
      }
      const res = await api.updateStaff(staff.id, payload)
      await onSaved?.(res?.staff)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to update staff')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!staff?.id) return
    setError('')
    setDeleting(true)
    try {
      await api.deleteStaff(staff.id)
      onDeleted?.(staff.id)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to delete staff')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  if (!staff) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {(submitting || fetchScheduleLoading) && <ModalLoadingOverlay className="rounded-2xl" />}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Edit Staff</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <p className="text-gray-900 font-medium">{staff.name}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Calendar ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={calendar_id}
                onChange={(e) => setCalendarId(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="Google Calendar ID"
              />
              {staff.calendar_id && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault()
                    if (!staff?.id || fetchScheduleLoading) return
                    setError('')
                    setFetchScheduleLoading(true)
                    try {
                      const res = await api.fetchStaffScheduleForStaff(staff.id)
                      const msg = res.eventsStored != null
                        ? `Fetched ${res.eventsStored} events for ${res.teacherName ?? staff.name}.`
                        : 'Schedule fetched.'
                      success(msg)
                    } catch (err) {
                      setError(err.message || 'Failed to fetch schedule')
                    } finally {
                      setFetchScheduleLoading(false)
                    }
                  }}
                  disabled={fetchScheduleLoading}
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
                  title="Fetch this month and next month (Japan time) from this staff's Google Calendar and save to database"
                >
                  <Calendar className="w-4 h-4" />
                  {fetchScheduleLoading ? 'Fetching…' : 'Fetch schedule'}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Schedule color (Google Calendar)</label>
            <p className="text-xs text-gray-500 mb-1">
              Used on Staff shift grid and English teacher week calendar. Matches Calendar event color names/IDs.
            </p>
            <select
              value={calendar_color_id}
              onChange={(e) => setCalendarColorId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            >
              <option value="">Auto (rotate palette if unset)</option>
              {GOOGLE_CALENDAR_EVENT_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <select
              value={staff_type}
              onChange={(e) => setStaffType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            >
              {STAFF_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={!staff.canEditRole}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit-staff-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <label htmlFor="edit-staff-active" className="text-sm font-medium text-slate-700">
              Active
            </label>
          </div>
          <div className="flex gap-3 pt-2 flex-wrap items-center">
            {staff.canEditRole && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={submitting}
                className="px-4 py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete staff
              </button>
            )}
            <div className="flex gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
      {showDeleteConfirm && (
        <ConfirmActionModal
          title="Delete staff"
          message={`Permanently delete "${staff.name}"? Their shift history, notifications, and schedule assignments will be removed. This cannot be undone.`}
          confirmLabel="Delete staff"
          destructive
          confirming={deleting}
          onConfirm={handleDeleteConfirm}
          onClose={() => !deleting && setShowDeleteConfirm(false)}
        />
      )}
    </div>,
    document.body
  )
}
