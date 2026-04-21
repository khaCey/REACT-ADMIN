import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, AlertCircle, Calendar, LogOut, Bell } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNotificationsPolling } from '../hooks/useNotificationsPolling'
import CreateNotificationModal from './CreateNotificationModal'
import NotificationDetailsModal from './NotificationDetailsModal'
import EditNotificationModal from './EditNotificationModal'
import { useToast } from '../context/ToastContext'
import { NOTIFICATIONS_WIP_DISABLED, areGuidesAvailable } from '../guides/wipFlags'
import LoadingSpinner from './LoadingSpinner'

export default function Navbar({ onToggleSidebar, onOpenUnpaid, onOpenUnscheduled }) {
  const { staff, logout } = useAuth()
  const { success } = useToast()
  const navigate = useNavigate()
  const [isNotificationOpen, setIsNotificationOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState(null)
  const [editingNotification, setEditingNotification] = useState(null)
  const [readingId, setReadingId] = useState(null)
  const dropdownRef = useRef(null)
  const notificationsDisabled = NOTIFICATIONS_WIP_DISABLED
  const guidesOn = areGuidesAvailable()
  const {
    unreadCount,
    notifications,
    loading: notificationsLoading,
    error: notificationsError,
    refreshUnread,
    markAsRead,
  } = useNotificationsPolling({
    enabled: !!staff && !notificationsDisabled,
  })
  const isAdminUser = !!staff?.is_admin || String(staff?.name || '').trim().toLowerCase() === 'khacey'

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleRead = async (id) => {
    setReadingId(id)
    try {
      await markAsRead(id)
      success('Notification marked as read')
      if (selectedNotification && selectedNotification.id === id) {
        setSelectedNotification((prev) => (prev ? { ...prev, is_read: true } : null))
      }
    } finally {
      setReadingId(null)
    }
  }

  const handleViewAll = () => {
    if (notificationsDisabled) return
    setIsNotificationOpen(false)
    navigate('/notifications')
  }

  useEffect(() => {
    if (!isNotificationOpen) return
    const onDocClick = (e) => {
      if (!dropdownRef.current) return
      if (!dropdownRef.current.contains(e.target)) {
        setIsNotificationOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [isNotificationOpen])

  useEffect(() => {
    if (!notificationsDisabled) return
    setIsNotificationOpen(false)
    setShowCreateModal(false)
    setSelectedNotification(null)
    setEditingNotification(null)
  }, [notificationsDisabled])

  const formatDateTime = (value) => {
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

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-green-600 text-white shadow-lg">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center">
          <button
            type="button"
            className="p-2 hover:bg-green-700 rounded-lg transition-colors mr-3 cursor-pointer"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <Link to="/students" className="text-xl font-semibold">
            Green Square
          </Link>
        </div>
        <div className="flex items-center space-x-3 relative" ref={dropdownRef}>
          {staff && (
            <>
              <span className="text-sm text-white/90">{staff.name}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="p-2 hover:bg-green-700 rounded-lg transition-colors flex items-center gap-1.5 text-sm cursor-pointer"
                title="End shift"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </>
          )}
          {onOpenUnpaid && (
            <button
              type="button"
              onClick={onOpenUnpaid}
              className="px-4 py-2 border border-white text-white rounded-lg hover:bg-white hover:text-green-600 transition-colors flex items-center space-x-2 cursor-pointer"
            >
              <AlertCircle className="w-4 h-4" />
              <span>未納</span>
            </button>
          )}
          {onOpenUnscheduled && (
            <button
              type="button"
              onClick={onOpenUnscheduled}
              className="px-4 py-2 border border-white text-white rounded-lg hover:bg-white hover:text-green-600 transition-colors flex items-center space-x-2 cursor-pointer"
            >
              <Calendar className="w-4 h-4" />
              <span>未定</span>
            </button>
          )}
          {staff && (
            !notificationsDisabled && (
            <button
              type="button"
              onClick={() => setIsNotificationOpen((v) => !v)}
              className="relative p-2 hover:bg-green-700 rounded-lg transition-colors cursor-pointer"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] leading-5 text-center font-semibold">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            )
          )}
          {isNotificationOpen && staff && !notificationsDisabled && (
            <div className="absolute right-0 top-full mt-2 w-[26rem] max-w-[90vw] bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 z-50">
              <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Notifications</h3>
                    <p className="text-xs text-gray-500 mt-1">Unread: {unreadCount}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              </div>
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <button
                  type="button"
                  onClick={handleViewAll}
                  className="w-full text-sm text-green-700 hover:text-green-900 font-medium cursor-pointer"
                >
                  View all notifications
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {notificationsLoading && (
                  <div className="flex flex-col items-center justify-center gap-2 p-4">
                    <LoadingSpinner size="xs" />
                    <p className="text-sm text-gray-500 text-center">Loading unread notifications…</p>
                  </div>
                )}
                {!notificationsLoading && notificationsError && (
                  <p className="p-4 text-sm text-red-600">{notificationsError}</p>
                )}
                {!notificationsLoading && !notificationsError && notifications.length === 0 && (
                  <p className="p-4 text-sm text-gray-500">No unread notifications.</p>
                )}
                {!notificationsLoading && !notificationsError && notifications.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedNotification(item)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1 line-clamp-2">{item.message}</p>
                        <p className="text-xs text-gray-500 mt-2">
                          {item.created_by_name || 'Unknown'} · {formatDateTime(item.created_at)}
                        </p>
                      </button>
                      <button
                        type="button"
                        className="text-xs text-green-700 hover:text-green-900 font-medium cursor-pointer disabled:opacity-50"
                        onClick={() => handleRead(item.id)}
                        disabled={readingId === item.id}
                      >
                        {readingId === item.id ? '処理中…' : '既読する'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {showCreateModal && (
        !notificationsDisabled && (
        <CreateNotificationModal
          onClose={() => setShowCreateModal(false)}
          onCreated={refreshUnread}
        />
        )
      )}
      {selectedNotification && (
        !notificationsDisabled && (
        <NotificationDetailsModal
          notification={selectedNotification}
          onClose={() => setSelectedNotification(null)}
          onMarkRead={handleRead}
          markingRead={readingId === selectedNotification.id}
          canEdit={isAdminUser || (staff?.id === selectedNotification.created_by_staff_id && !selectedNotification.is_system)}
          onEdit={(id) => {
            const target = notifications.find((n) => n.id === id) || (selectedNotification?.id === id ? selectedNotification : null)
            if (!target) return
            setEditingNotification(target)
          }}
          editing={!!editingNotification && editingNotification.id === selectedNotification.id}
          canStartGuide={
            guidesOn &&
            !!resolveGuideSlug(selectedNotification)
          }
          onStartGuide={(n) => {
            const slug = resolveGuideSlug(n)
            if (slug && startGuideBySlug(slug)) {
              guideStartedFromNotificationIdRef.current = n.id
              setSelectedNotification(null)
              setIsNotificationOpen(false)
              navigate('/notifications', { state: { guideAction: 'notifications.view' } })
            }
          }}
        />
        )
      )}
      {editingNotification && (
        !notificationsDisabled && (
        <EditNotificationModal
          notification={editingNotification}
          onClose={() => setEditingNotification(null)}
          onSaved={async () => {
            await refreshUnread()
            setEditingNotification(null)
            setSelectedNotification(null)
          }}
        />
        )
      )}
    </nav>
  )
}
