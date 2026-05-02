/**
 * CalendarPollingProvider — GAS MonthlySchedule poll → POST /api/calendar-poll/sync (PostgreSQL).
 *
 * Schedule UIs (e.g. LessonsThisMonth, BookLessonModal) must load lessons from API routes that read
 * the DB; context `data` is the in-memory GAS snapshot used only to sync to the server, not for
 * rendering grids/cards. Those components use `lastSynced` as a signal to refetch DB-backed data.
 *
 * See POLLING_API_SPEC.md for the GAS contract.
 */

import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { useCalendarPolling } from '../hooks/useCalendarPolling'
import { api } from '../api'
import { useAuth } from './AuthContext'
import {
  normalizeRemovedDiffEntry,
  dedupeRemovedEntries,
} from '../utils/calendarPollRemoved'

const CalendarPollingContext = createContext(null)

const DEFAULT_POLL_INTERVAL_MS = 120000

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
  const removedQueueRef = useRef([])

  const onPollDiff = useCallback((diff) => {
    const list = diff?.removed
    if (!Array.isArray(list)) return
    for (const entry of list) {
      const parsed = normalizeRemovedDiffEntry(entry)
      if (parsed?.eventID && parsed?.studentName) {
        removedQueueRef.current.push(parsed)
      } else if (import.meta.env.DEV) {
        console.debug('[CalendarPolling] Malformed diff.removed entry (skipped):', entry)
      }
    }
  }, [])

  const syncToServer = useCallback(async (data) => {
    latestDataForSyncRef.current = Array.isArray(data) ? data : []
    if (syncLoopRunningRef.current) {
      pendingResyncRef.current = true
      return
    }
    syncLoopRunningRef.current = true
    pendingResyncRef.current = false
    try {
      // Serialize: overlapping effect runs only set pendingResyncRef; we drain until quiescent.
      while (true) {
        pendingResyncRef.current = false
        const removedRaw = removedQueueRef.current.splice(0)
        const removed = dedupeRemovedEntries(removedRaw)
        const payload = latestDataForSyncRef.current
        const hasPayload = Array.isArray(payload) && payload.length > 0
        if (!hasPayload && removed.length === 0) {
          if (!pendingResyncRef.current) break
          continue
        }
        try {
          await api.syncCalendarPoll({ data: hasPayload ? payload : [], removed })
          setLastSynced(Date.now())
          console.debug(
            '[CalendarPolling] Synced',
            hasPayload ? payload.length : 0,
            'rows,',
            removed.length,
            'removed (',
            removedRaw.length,
            'raw), to server'
          )
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
