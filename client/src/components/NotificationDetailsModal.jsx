import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

function formatDateTime(value) {
  if (!value) return 'Unknown time'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Unknown time'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function NotificationDetailsModal({
  notification,
  onClose,
  onMarkRead,
  markingRead = false,
}) {
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

  if (!notification) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Notification Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm text-gray-500">Title</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{notification.title}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Message</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap mt-1">{notification.message}</p>
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <p>From: {notification.created_by_name || 'Unknown'}</p>
            <p>Created: {formatDateTime(notification.created_at)}</p>
            {notification.read_at && <p>Read: {formatDateTime(notification.read_at)}</p>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Close
            </button>
            {!notification.is_read && onMarkRead && (
              <button
                type="button"
                disabled={markingRead}
                onClick={() => onMarkRead(notification.id)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 cursor-pointer"
              >
                {markingRead ? 'Marking...' : 'Mark as Read'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
