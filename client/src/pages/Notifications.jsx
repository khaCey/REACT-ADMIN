import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { api } from '../api'
import { useNotificationsPolling } from '../hooks/useNotificationsPolling'
import CreateNotificationModal from '../components/CreateNotificationModal'
import NotificationDetailsModal from '../components/NotificationDetailsModal'
import EditNotificationModal from '../components/EditNotificationModal'
import ConfirmActionModal from '../components/ConfirmActionModal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useGuideTour } from '../context/GuideTourContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { resolveGuideSlug } from '../guides/resolveGuideSlug'
import { isGuideEnabled, NOTIFICATIONS_WIP_DISABLED, GUIDES_WIP_HIDDEN } from '../guides/wipFlags'
import FullPageLoading from '../components/FullPageLoading'

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
  const { staff } = useAuth()
  const { startGuideBySlug, activeGuideSlug } = useGuideTour()
  const preventDelete = !!activeGuideSlug
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState(null)
  const [readingId, setReadingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [editingNotification, setEditingNotification] = useState(null)
  const [guideFocusAction, setGuideFocusAction] = useState(null)
  const guideStartedFromNotificationIdRef = useRef(null)
  const notificationsDisabled = NOTIFICATIONS_WIP_DISABLED
  const {
    unreadCount,
    refreshUnread,
    markAsRead,
  } = useNotificationsPolling({ intervalMs: 45000, enabled: !notificationsDisabled, unreadLimit: 20 })
  const [guideActionPending, setGuideActionPending] = useState(null)
  const isAdminUser = !!staff?.is_admin || String(staff?.name || '').trim().toLowerCase() === 'khacey'
  const canEditNotification = useCallback((n) => {
    if (!n) return false
    if (isAdminUser) return true
    return staff?.id === n.created_by_staff_id && !n.is_system && n.kind !== 'guide'
  }, [staff?.id, isAdminUser])
  const canDeleteNotification = useCallback((n) => {
    if (!n) return false
    if (isAdminUser) return true
    if (n.is_system || n.kind === 'guide') return false
    return staff?.id === n.created_by_staff_id
  }, [staff?.id, isAdminUser])

  const loadPage = useCallback(async (nextOffset) => {
    if (notificationsDisabled) {
      setItems([])
      setTotal(0)
      setOffset(0)
      setError('')
      setLoading(false)
      return
    }
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
  }, [notificationsDisabled])

  useEffect(() => {
    loadPage(0)
  }, [loadPage])

  useEffect(() => {
    if (notificationsDisabled) return
    const guideAction = location.state?.guideAction
    if (!guideAction) return
    // Preserve current modal context for cross-step guide continuity.
    setGuideFocusAction(null)
    if (guideAction === 'notifications.create') {
      setSelectedNotification(null)
      setPendingDelete(null)
      setEditingNotification(null)
      setShowCreateModal(false)
    }
    setGuideActionPending(guideAction)
    navigate(location.pathname, { replace: true, state: {} })
  }, [notificationsDisabled, location.state?.guideAction, location.pathname, navigate])

  useEffect(() => {
    const handleGuideEnded = async () => {
      const id = guideStartedFromNotificationIdRef.current
      if (id && !notificationsDisabled) {
        guideStartedFromNotificationIdRef.current = null
        try {
          await markAsRead(id)
          success('Notification marked as read')
          await loadPage(offset)
          if (selectedNotification?.id === id) {
            setSelectedNotification((prev) => (prev ? { ...prev, is_read: true, read_at: new Date().toISOString() } : null))
          }
        } catch {
          // ignore
        }
      }
      setShowCreateModal(false)
      setSelectedNotification(null)
      setPendingDelete(null)
      setEditingNotification(null)
      setGuideActionPending(null)
      setGuideFocusAction(null)
    }
    window.addEventListener('guide:ended', handleGuideEnded)
    return () => window.removeEventListener('guide:ended', handleGuideEnded)
  }, [notificationsDisabled, markAsRead, success, loadPage, offset, selectedNotification?.id])

  useEffect(() => {
    if (notificationsDisabled) return
    if (!guideActionPending) return
    if (guideActionPending === 'notifications.create') {
      setShowCreateModal(true)
      setGuideFocusAction(null)
      setGuideActionPending(null)
      return
    }
    if (guideActionPending === 'notifications.view') {
      if (selectedNotification) {
        setGuideFocusAction('view')
        setGuideActionPending(null)
        return
      }
      if (items[0]) {
        setSelectedNotification(items[0])
        setGuideFocusAction('view')
        setGuideActionPending(null)
      }
      return
    }
    if (guideActionPending === 'notifications.edit') {
      if (editingNotification) {
        setGuideFocusAction(null)
        setGuideActionPending(null)
        return
      }
      const editable = (selectedNotification && canEditNotification(selectedNotification))
        ? selectedNotification
        : items.find((n) => canEditNotification(n))
      if (editable) {
        setSelectedNotification(editable)
        setGuideFocusAction('edit')
        setGuideActionPending(null)
      }
      return
    }
    if (guideActionPending === 'notifications.delete') {
      if (pendingDelete) {
        setGuideFocusAction('delete-confirm')
        setGuideActionPending(null)
        return
      }
      const deletable = (selectedNotification && canDeleteNotification(selectedNotification))
        ? selectedNotification
        : items.find((n) => canDeleteNotification(n))
      if (deletable) {
        setSelectedNotification(deletable)
        setGuideFocusAction('delete')
        setGuideActionPending(null)
      }
      return
    }
    if (guideActionPending === 'notifications.read-unread') {
      if (selectedNotification) {
        setGuideFocusAction('read-unread')
        setGuideActionPending(null)
        return
      }
      if (items[0]) {
        setSelectedNotification(items[0])
        setGuideFocusAction('read-unread')
        setGuideActionPending(null)
      }
    }
  }, [notificationsDisabled, guideActionPending, items, selectedNotification, editingNotification, pendingDelete, canEditNotification, canDeleteNotification])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const currentPage = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset])
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  const handleMarkRead = async (id) => {
    if (notificationsDisabled) return
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

  const handleMarkUnread = async (id) => {
    if (notificationsDisabled) return
    setReadingId(id)
    try {
      await api.markNotificationUnread(id)
      success('Notification marked as unread')
      await Promise.all([refreshUnread(), loadPage(offset)])
      if (selectedNotification && selectedNotification.id === id) {
        setSelectedNotification((prev) => (prev ? { ...prev, is_read: false, read_at: null } : null))
      }
    } finally {
      setReadingId(null)
    }
  }

  const requestDelete = (id) => {
    if (notificationsDisabled) return
    const target = items.find((n) => n.id === id) || (selectedNotification?.id === id ? selectedNotification : null)
    if (!target) return
    setPendingDelete(target)
  }

  const handleDeleteConfirm = async () => {
    if (notificationsDisabled) return
    if (preventDelete) {
      setPendingDelete(null)
      return
    }
    const id = pendingDelete?.id
    if (!id) return
    setDeletingId(id)
    try {
      await api.deleteNotification(id)
      success('Notification deleted')
      if (selectedNotification?.id === id) setSelectedNotification(null)
      const nextOffset = items.length === 1 && offset > 0 ? Math.max(0, offset - PAGE_SIZE) : offset
      await Promise.all([refreshUnread(), loadPage(nextOffset)])
      setPendingDelete(null)
    } catch (e) {
      setError(e.message || 'Failed to delete notification')
    } finally {
      setDeletingId(null)
    }
  }

  if (!notificationsDisabled && loading) {
    return <FullPageLoading />
  }

  return (
    <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-auto">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-green-700" />
        <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
        {notificationsDisabled && (
          <span className="ml-1 inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-700">
            Notifications WIP (disabled)
          </span>
        )}
        {GUIDES_WIP_HIDDEN && (
          <span className="ml-1 inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
            Guides WIP (hidden)
          </span>
        )}
        <span className="ml-2 text-sm text-gray-500">Unread: {unreadCount}</span>
        {!notificationsDisabled && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="ml-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded cursor-pointer"
          >
            Create Notification
          </button>
        )}
      </div>

      {notificationsDisabled ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Notifications are temporarily disabled for pre-deployment cleanup.
        </div>
      ) : (
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
      )}

      {!notificationsDisabled && error && <p className="text-sm text-red-600">{error}</p>}

      {!notificationsDisabled && !error && items.length === 0 && (
        <p className="text-sm text-gray-500">No notifications yet.</p>
      )}

      {!notificationsDisabled && !error && items.length > 0 && (
        <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
          {items.map((item) => (
            <div key={item.id} className="p-4 bg-white hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedNotification(item)}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                    {(item.is_system || item.kind === 'guide') && (
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800">
                        Guide
                      </span>
                    )}
                  </div>
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
                {canEditNotification(item) && (
                  <button
                    type="button"
                    onClick={() => {
                      setGuideFocusAction(null)
                      setEditingNotification(item)
                    }}
                    className="text-sm text-amber-700 hover:text-amber-900 font-medium cursor-pointer"
                  >
                    Edit
                  </button>
                )}
                {canDeleteNotification(item) && (
                  <button
                    type="button"
                    onClick={() => {
                      setGuideFocusAction(null)
                      requestDelete(item.id)
                    }}
                    disabled={deletingId === item.id}
                    className="text-sm text-rose-700 hover:text-rose-900 font-medium cursor-pointer disabled:opacity-60"
                  >
                    {deletingId === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!notificationsDisabled && <div className="mt-4 flex items-center justify-between">
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
      </div>}
      {!notificationsDisabled && showCreateModal && (
        <CreateNotificationModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => Promise.all([refreshUnread(), loadPage(0)])}
        />
      )}
      {!notificationsDisabled && selectedNotification && (
        <NotificationDetailsModal
          notification={selectedNotification}
          onClose={() => {
            setGuideFocusAction(null)
            setSelectedNotification(null)
          }}
          onMarkRead={handleMarkRead}
          onMarkUnread={handleMarkUnread}
          markingRead={readingId === selectedNotification.id}
          canDelete={canDeleteNotification(selectedNotification)}
          onDelete={requestDelete}
          deleting={deletingId === selectedNotification.id}
          canEdit={canEditNotification(selectedNotification)}
          onEdit={(id) => {
            const target = items.find((n) => n.id === id) || (selectedNotification?.id === id ? selectedNotification : null)
            if (target) {
              setGuideFocusAction(null)
              setEditingNotification(target)
            }
          }}
          editing={!!editingNotification && editingNotification.id === selectedNotification.id}
          highlightAction={guideFocusAction}
          canStartGuide={!!(selectedNotification?.is_system || selectedNotification?.kind === 'guide')}
          onStartGuide={(n) => {
            const slug = resolveGuideSlug(n)
            if (slug && startGuideBySlug(slug)) {
              guideStartedFromNotificationIdRef.current = n.id
              setGuideFocusAction(null)
              setSelectedNotification(null)
              navigate('/notifications', { state: { guideAction: 'notifications.view' } })
            }
          }}
        />
      )}
      {!notificationsDisabled && pendingDelete && (
        <ConfirmActionModal
          title="Delete Notification"
          message={`Are you sure you want to delete "${pendingDelete.title}"?`}
          confirmLabel="Delete"
          destructive
          confirming={deletingId === pendingDelete.id}
          highlightConfirm={guideFocusAction === 'delete-confirm'}
          onConfirm={handleDeleteConfirm}
          onClose={() => {
            if (!deletingId) setPendingDelete(null)
          }}
        />
      )}
      {!notificationsDisabled && editingNotification && (
        <EditNotificationModal
          notification={editingNotification}
          onClose={() => setEditingNotification(null)}
          onSaved={async () => {
            await Promise.all([refreshUnread(), loadPage(offset)])
          }}
        />
      )}
    </div>
  )
}
