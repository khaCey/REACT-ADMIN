/**
 * CalendarPollingProvider — client poll signal for DB-backed UIs.
 *
 * Server cron performs GAS backfill+reconcile. Client polling is used to drive
 * periodic UI refetch signals (`lastSynced`) for DB-backed screens.
 */

import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
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

  // Emit UI refresh signal when client poll data changes.
  useEffect(() => {
    if (isConfigured && !loading) {
      setLastSynced(Date.now())
    }
  }, [isConfigured, data, loading])

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
