/**
 * CalendarPollingProvider — Context for GAS Calendar Webhook polling.
 * Uses useCalendarPolling, syncs to server when data changes.
 * See POLLING_API_SPEC.md for spec.
 */

import { createContext, useContext, useCallback, useRef, useEffect, useState } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
import { api } from '../api'
import { useAuth } from './AuthContext'

const CalendarPollingContext = createContext(null)

function parseRemovedKey(key) {
  if (key == null || typeof key !== 'string') return null
  const i = key.indexOf('|')
  if (i <= 0) return null
  return { eventID: key.slice(0, i), studentName: key.slice(i + 1) }
}

export function useCalendarPollingContext() {
  const ctx = useContext(CalendarPollingContext)
  return ctx ?? { data: [], loading: false, error: null, lastSynced: null, refetch: () => {}, isConfigured: false }
}

export function CalendarPollingProvider({ children, intervalMs = 300000 }) {
  const { staff, loading: authLoading } = useAuth()
  const [lastSynced, setLastSynced] = useState(null)
  const syncInProgressRef = useRef(false)
  const removedQueueRef = useRef([])

  const onPollDiff = useCallback((diff) => {
    for (const key of diff?.removed || []) {
      const parsed = parseRemovedKey(key)
      if (parsed?.eventID && parsed?.studentName) removedQueueRef.current.push(parsed)
    }
  }, [])

  const syncToServer = useCallback(async (data) => {
    if (syncInProgressRef.current) return
    const removed = removedQueueRef.current.splice(0)
    if ((!data || data.length === 0) && removed.length === 0) return
    syncInProgressRef.current = true
    try {
      await api.syncCalendarPoll({ data: data ?? [], removed })
      setLastSynced(Date.now())
      console.debug('[CalendarPolling] Synced', (data ?? []).length, 'rows,', removed.length, 'removed, to server')
    } catch (err) {
      console.warn('[CalendarPolling] Sync failed:', err.message)
    } finally {
      syncInProgressRef.current = false
    }
  }, [])

  const {
    data,
    loading,
    error,
    lastUpdated,
    cacheVersion,
    refetch,
    isConfigured,
  } = useCalendarPolling({
    intervalMs,
    enabled: !!staff && !authLoading,
    onChanged: onPollDiff,
  })

  // Sync to server when data changes (full fetch or diff applied)
  useEffect(() => {
    if (isConfigured && !loading) {
      syncToServer(data ?? [])
    }
  }, [isConfigured, data, loading, syncToServer])

  const value = {
    data,
    loading,
    error,
    lastUpdated,
    cacheVersion,
    lastSynced,
    refetch,
    isConfigured,
  }

  return (
    <CalendarPollingContext.Provider value={value}>
      {children}
    </CalendarPollingContext.Provider>
  )
}
