/**
 * CalendarPollingProvider — poll GAS (cur+next month), then POST server backfill for those months.
 *
 * Optional `CALENDAR_POLL_SERVER_CRON` in root `.env` also syncs when no browser is open.
 */

import { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
import { useAuth } from './AuthContext'
import { api } from '../api'
import { addOneMonthYyyyMm, getCurrentYyyyMmJst } from '../utils/jstMonth'

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
  const backfillGenRef = useRef(0)

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

  // After each successful GAS poll, run server-side month backfill (reconcile) then bump UI refresh.
  useEffect(() => {
    if (!staff || authLoading || !isConfigured || loading) return
    const gen = ++backfillGenRef.current
    const curYm = getCurrentYyyyMmJst()
    const nextYm = addOneMonthYyyyMm(curYm)
    ;(async () => {
      try {
        await Promise.all([
          api.backfillFromCalendar({ month: curYm }),
          nextYm ? api.backfillFromCalendar({ month: nextYm }) : Promise.resolve(),
        ])
        if (backfillGenRef.current === gen) {
          setLastSynced(Date.now())
        }
      } catch (err) {
        console.warn('[CalendarPolling] Backfill failed:', err?.message || err)
      }
    })()
  }, [staff, authLoading, isConfigured, loading, lastUpdated])

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
