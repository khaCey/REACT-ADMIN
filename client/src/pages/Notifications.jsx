import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell } from 'lucide-react'
import { api } from '../api'
import { useNotificationsPolling } from '../hooks/useNotificationsPolling'
import CreateNotificationModal from '../components/CreateNotificationModal'
import NotificationDetailsModal from '../components/NotificationDetailsModal'
import { useToast } from '../context/ToastContext'

const PAGE_SIZE = 25

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

export default function Notifications() {
  const { success } = useToast()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState(null)
  const [readingId, setReadingId] = useState(null)
  const {
    unreadCount,
    refreshUnread,
    markAsRead,
  } = useNotificationsPolling({ intervalMs: 45000, enabled: true, unreadLimit: 20 })

  const loadPage = useCallback(async (nextOffset) => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getNotifications({ limit: PAGE_SIZE, offset: nextOffset })
      setItems(Array.isArray(data.notifications) ? data.notifications : [])
      setTotal(data.total || 0)
      setOffset(nextOffset)
    } catch (e) {
      setError(e.message || 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPage(0)
  }, [loadPage])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const currentPage = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset])
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  const handleMarkRead = async (id) => {
    setReadingId(id)
    try {
      await markAsRead(id)
      success('Notification marked as read')
      await loadPage(offset)
      if (selectedNotification && selectedNotification.id === id) {
        setSelectedNotification((prev) => (prev ? { ...prev, is_read: true } : null))
      }
    } finally {
      setReadingId(null)
    }
  }

  return (
    <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-auto">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-green-700" />
        <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
        <span className="ml-2 text-sm text-gray-500">Unread: {unreadCount}</span>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="ml-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded cursor-pointer"
        >
          Create Notification
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">All notifications</h2>
        <button
          type="button"
          onClick={() => Promise.all([refreshUnread(), loadPage(offset)])}
          className="text-sm text-green-700 hover:text-green-900 font-medium cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading notifications...</p>}
      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-gray-500">No notifications yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
          {items.map((item) => (
            <div key={item.id} className="p-4 bg-white hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedNotification(item)}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{item.message}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {item.created_by_name || 'Unknown'} · {formatDateTime(item.created_at)}
                  </p>
                  <p className="text-xs mt-1">
                    {item.is_read ? (
                      <span className="text-gray-500">
                        Read {item.read_at ? `· ${formatDateTime(item.read_at)}` : ''}
                      </span>
                    ) : (
                      <span className="text-red-600 font-medium">Unread</span>
                    )}
                  </p>
                </button>
                {!item.is_read && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(item.id)}
                    disabled={readingId === item.id}
                    className="text-sm text-green-700 hover:text-green-900 font-medium cursor-pointer disabled:opacity-60"
                  >
                    {readingId === item.id ? 'Marking...' : 'Mark read'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => canPrev && loadPage(Math.max(0, offset - PAGE_SIZE))}
          disabled={!canPrev}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50 cursor-pointer"
        >
          Previous
        </button>
        <p className="text-sm text-gray-600">
          Page {currentPage} of {totalPages}
        </p>
        <button
          type="button"
          onClick={() => canNext && loadPage(offset + PAGE_SIZE)}
          disabled={!canNext}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50 cursor-pointer"
        >
          Next
        </button>
      </div>
      {showCreateModal && (
        <CreateNotificationModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => Promise.all([refreshUnread(), loadPage(0)])}
        />
      )}
      {selectedNotification && (
        <NotificationDetailsModal
          notification={selectedNotification}
          onClose={() => setSelectedNotification(null)}
          onMarkRead={handleMarkRead}
          markingRead={readingId === selectedNotification.id}
        />
      )}
    </div>
  )
}
