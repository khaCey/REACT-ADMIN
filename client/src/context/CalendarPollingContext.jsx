/**
 * CalendarPollingProvider — GAS backfill (current + next JST month) on an interval → POST /api/calendar-poll/sync.
 *
 * Schedule UIs load from API/DB; context `data` is the merged month snapshot for server sync.
 * `lastSynced` signals DB-backed components to refetch. See POLLING_API_SPEC.md.
 */

import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
import { api } from '../api'
import { useAuth } from './AuthContext'

const CalendarPollingContext = createContext(null)

const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000

function resolvePollIntervalMs(propMs) {
  if (propMs != null && Number.isFinite(propMs) && propMs >= 10000) return propMs
  const fromEnv = parseInt(import.meta.env.VITE_CALENDAR_POLL_INTERVAL_MS || '', 10)
  if (Number.isFinite(fromEnv) && fromEnv >= 10000) return fromEnv
  return DEFAULT_POLL_INTERVAL_MS
}

export function useCalendarPollingContext() {
  const ctx = useContext(CalendarPollingContext)
  return ctx ?? { data: [], loading: false, error: null, lastSynced: null, refetch: () => {}, isConfigured: false }
}

export function CalendarPollingProvider({ children, intervalMs: intervalMsProp }) {
  const { staff, loading: authLoading } = useAuth()
  const intervalMs = useMemo(() => resolvePollIntervalMs(intervalMsProp), [intervalMsProp])

  const [lastSynced, setLastSynced] = useState(null)
  const syncLoopRunningRef = useRef(false)
  const pendingResyncRef = useRef(false)
  const latestDataForSyncRef = useRef([])

  const syncToServer = useCallback(async (data) => {
    latestDataForSyncRef.current = Array.isArray(data) ? data : []
    if (syncLoopRunningRef.current) {
      pendingResyncRef.current = true
      return
    }
    syncLoopRunningRef.current = true
    pendingResyncRef.current = false
    try {
      while (true) {
        pendingResyncRef.current = false
        const payload = latestDataForSyncRef.current
        const hasPayload = Array.isArray(payload) && payload.length > 0
        if (!hasPayload) {
          if (!pendingResyncRef.current) break
          continue
        }
        try {
          await api.syncCalendarPoll({ data: payload, removed: [] })
          setLastSynced(Date.now())
          console.debug('[CalendarPolling] Synced', payload.length, 'rows to server (full snapshot)')
        } catch (err) {
          console.warn('[CalendarPolling] Sync failed:', err.message)
        }
        if (!pendingResyncRef.current) break
      }
    } finally {
      syncLoopRunningRef.current = false
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
  })

  // Sync to server when data changes (each full GAS snapshot)
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
