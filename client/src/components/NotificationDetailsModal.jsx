import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { areGuidesAvailable } from '../guides/wipFlags'

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
  onMarkUnread,
  markingRead = false,
  canDelete = false,
  onDelete,
  deleting = false,
  canEdit = false,
  onEdit,
  editing = false,
  highlightAction = null,
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

  const guidesOn = areGuidesAvailable()
  const hideGuideMeta =
    !guidesOn && (notification.is_system || notification.kind === 'guide')

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
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500">Title</p>
              {guidesOn && (notification.is_system || notification.kind === 'guide') && (
                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800">
                  Guide
                </span>
              )}
            </div>
            <p className="text-lg font-semibold text-gray-900 mt-1">{notification.title}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Message</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap mt-1">{notification.message}</p>
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <p>From: {notification.created_by_name || 'Unknown'}</p>
            {(notification.kind || notification.slug) && (
              <p>
                Type:{' '}
                {hideGuideMeta
                  ? 'system'
                  : `${notification.kind || 'general'}${notification.slug ? ` · ${notification.slug}` : ''}`}
              </p>
            )}
            <p>Created: {formatDateTime(notification.created_at)}</p>
            {notification.read_at && <p>Read: {formatDateTime(notification.read_at)}</p>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            {canEdit && onEdit && (
              <button
                type="button"
                onClick={() => onEdit(notification.id)}
                disabled={editing}
                className={`px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60 cursor-pointer ${
                  highlightAction === 'edit' ? 'ring-4 ring-yellow-300 animate-pulse' : ''
                }`}
              >
                {editing ? 'Opening...' : 'Edit'}
              </button>
            )}
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(notification.id)}
                disabled={deleting}
                className={`px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-60 cursor-pointer ${
                  highlightAction === 'delete' ? 'ring-4 ring-yellow-300 animate-pulse' : ''
                }`}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
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
                className={`px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 cursor-pointer ${
                  highlightAction === 'read-unread' ? 'ring-4 ring-yellow-300 animate-pulse' : ''
                }`}
              >
                {markingRead ? 'Marking...' : '既読にする'}
              </button>
            )}
            {notification.is_read && onMarkUnread && (
              <button
                type="button"
                disabled={markingRead}
                onClick={() => onMarkUnread(notification.id)}
                className={`px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer ${
                  highlightAction === 'read-unread' ? 'ring-4 ring-yellow-300 animate-pulse' : ''
                }`}
              >
                {markingRead ? 'Updating...' : 'Mark as Unread'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
