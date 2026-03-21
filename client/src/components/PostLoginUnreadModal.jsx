import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Bell } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import { areGuidesAvailable } from '../guides/wipFlags'
import ModalLoadingOverlay from './ModalLoadingOverlay'

const UNREAD_LIMIT = 20

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

/**
 * One-time post-login modal: unread notifications only. Does not render until fetch confirms count > 0.
 */
export default function PostLoginUnreadModal({ open, onClose }) {
  const navigate = useNavigate()
  const { success } = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState(false)
  const [readingId, setReadingId] = useState(null)

  const handleClose = useCallback(() => {
    setVisible(false)
    setItems([])
    setError(null)
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) {
      setVisible(false)
      setItems([])
      setError(null)
      return
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setVisible(false)
      try {
        const data = await api.getUnreadNotifications(UNREAD_LIMIT, {
          excludeGuides: !areGuidesAvailable(),
        })
        if (cancelled) return
        const list = Array.isArray(data.notifications) ? data.notifications : []
        const count = Number(data.unreadCount) || 0
        if (list.length === 0 || count === 0) {
          onClose()
          return
        }
        setItems(list)
        setVisible(true)
      } catch (e) {
        if (cancelled) return
        setError(e.message || 'Failed to load notifications')
        setVisible(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, onClose])

  const handleMarkRead = async (id) => {
    setReadingId(id)
    try {
      await api.markNotificationRead(id)
      success('Notification marked as read')
      setItems((prev) => prev.filter((n) => n.id !== id))
    } catch {
      // keep row
    } finally {
      setReadingId(null)
    }
  }

  useEffect(() => {
    if (!open || !visible || error || loading) return
    if (items.length === 0) handleClose()
  }, [open, visible, error, loading, items.length, handleClose])

  const handleViewAll = () => {
    handleClose()
    navigate('/notifications')
  }

  if (!open) return null
  if (loading && !visible && !error) return null
  if (!visible && !error) return null

  const modal = (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="postLoginUnreadTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <ModalLoadingOverlay className="rounded-2xl" />}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-green-600 text-white">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-5 h-5 shrink-0" aria-hidden />
            <h2 id="postLoginUnreadTitle" className="text-lg font-semibold truncate">
              Unread notifications
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg text-white/90 hover:bg-white/10 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && !loading && (
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-3 px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-black cursor-pointer"
            >
              Close
            </button>
          </div>
        )}

        {!error && visible && (
          <>
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={handleViewAll}
                className="text-sm text-green-700 hover:text-green-900 font-medium cursor-pointer"
              >
                View all notifications
              </button>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 max-h-[55vh]">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="p-4 border-b border-gray-100 hover:bg-gray-50/80 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1 line-clamp-3">
                        {item.message}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        {item.created_by_name || 'Unknown'} · {formatDateTime(item.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-green-700 hover:text-green-900 font-medium cursor-pointer shrink-0 disabled:opacity-50"
                      onClick={() => handleMarkRead(item.id)}
                      disabled={readingId === item.id}
                    >
                      {readingId === item.id ? '…' : '既読する'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-black cursor-pointer"
              >
                Got it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
