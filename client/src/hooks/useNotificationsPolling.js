import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api'

export function useNotificationsPolling(options = {}) {
  const {
    intervalMs = 45000,
    enabled = true,
    unreadLimit = 20,
  } = options

  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const refreshUnread = useCallback(async () => {
    try {
      setError(null)
      const data = await api.getUnreadNotifications(unreadLimit)
      if (!mountedRef.current) return
      setUnreadCount(data.unreadCount || 0)
      setNotifications(Array.isArray(data.notifications) ? data.notifications : [])
    } catch (e) {
      if (!mountedRef.current) return
      setError(e.message || 'Failed to load notifications')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [unreadLimit])

  const markAsRead = useCallback(async (id) => {
    await api.markNotificationRead(id)
    await refreshUnread()
  }, [refreshUnread])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) {
      setLoading(false)
      return () => {
        mountedRef.current = false
      }
    }
    setLoading(true)
    refreshUnread()
    return () => {
      mountedRef.current = false
    }
  }, [enabled, refreshUnread])

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      refreshUnread()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [enabled, intervalMs, refreshUnread])

  return {
    unreadCount,
    notifications,
    loading,
    error,
    refreshUnread,
    markAsRead,
  }
}
