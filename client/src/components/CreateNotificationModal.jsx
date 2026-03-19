import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import ModalLoadingOverlay from './ModalLoadingOverlay'

export default function CreateNotificationModal({ onClose, onCreated }) {
  const { success } = useToast()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [targetStaffId, setTargetStaffId] = useState('')
  const [staffOptions, setStaffOptions] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const trimmedTitle = title.trim()
    const trimmedMessage = message.trim()
    if (!trimmedTitle || !trimmedMessage) {
      setError('Title and message are required')
      return
    }
    setSubmitting(true)
    try {
      const payload = { title: trimmedTitle, message: trimmedMessage }
      if (targetStaffId) payload.target_staff_id = Number.parseInt(targetStaffId, 10)
      await api.createNotification(payload)
      success('Notification created')
      await onCreated?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create notification')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    const loadStaff = async () => {
      setLoadingStaff(true)
      try {
        const data = await api.getNotificationStaff()
        if (!isMounted) return
        setStaffOptions(Array.isArray(data.staff) ? data.staff : [])
      } catch {
        if (!isMounted) return
        setStaffOptions([])
      } finally {
        if (isMounted) setLoadingStaff(false)
      }
    }
    loadStaff()
    return () => {
      isMounted = false
    }
  }, [])

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
        {(loadingStaff || submitting) && <ModalLoadingOverlay className="rounded-2xl" />}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Create Notification</h2>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Title <span className="text-rose-600">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              maxLength={255}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Send to</label>
            <select
              value={targetStaffId}
              onChange={(e) => setTargetStaffId(e.target.value)}
              disabled={loadingStaff}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-60"
            >
              <option value="">All staff</option>
              {staffOptions.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Message <span className="text-rose-600">*</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              rows={5}
              required
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || loadingStaff}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Posting…' : 'Post Notification'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
