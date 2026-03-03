/**
 * CalendarPollingProvider — Context for GAS Calendar Webhook polling.
 * Uses useCalendarPolling, syncs to server when data changes.
 * See POLLING_API_SPEC.md for spec.
 */

import { createContext, useContext, useCallback, useRef, useEffect, useState } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
import { api } from '../api'

const CalendarPollingContext = createContext(null)

export function useCalendarPollingContext() {
  const ctx = useContext(CalendarPollingContext)
  return ctx ?? { data: [], loading: false, error: null, lastSynced: null, refetch: () => {}, isConfigured: false }
}

export function CalendarPollingProvider({ children, intervalMs = 300000 }) {
  const [lastSynced, setLastSynced] = useState(null)
  const syncInProgressRef = useRef(false)

  const syncToServer = useCallback(async (data) => {
    if (syncInProgressRef.current) return
    if (!data || data.length === 0) return
    syncInProgressRef.current = true
    try {
      await api.syncCalendarPoll(data)
      setLastSynced(Date.now())
      console.debug('[CalendarPolling] Synced', data.length, 'rows to server')
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
    enabled: true,
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
