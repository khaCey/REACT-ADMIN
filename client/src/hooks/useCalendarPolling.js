/**
 * useCalendarPolling — Full GAS MonthlySchedule snapshot (?full=1) on load and each interval.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchFullCalendar,
  isPollingConfigured,
  ensurePollingConfig,
} from '../api/pollingApi'

export function useCalendarPolling(options = {}) {
  const {
    intervalMs = 900000, // 15 min (CalendarPollingProvider overrides default)
    enabled = true,
    onError,
  } = options

  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [cacheVersion, setCacheVersion] = useState(null)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)
  const dataRef = useRef([])

  const refetch = useCallback(async () => {
    await ensurePollingConfig()
    if (!isPollingConfigured()) {
      setLoading(false)
      setData([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchFullCalendar()
      if (result._skipped) {
        setData([])
        setLoading(false)
        return
      }
      if (mountedRef.current) {
        const rows = Array.isArray(result.data) ? result.data : []
        setData(rows)
        dataRef.current = rows
        setLastUpdated(result.lastUpdated || null)
        setCacheVersion(result.cacheVersion ?? null)
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e.message)
        onError?.(e)
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [onError])

  const fetchFullSilent = useCallback(async () => {
    await ensurePollingConfig()
    if (!isPollingConfigured() || !mountedRef.current) return
    try {
      const result = await fetchFullCalendar()
      if (result._skipped || !mountedRef.current) return
      const rows = Array.isArray(result.data) ? result.data : []
      setData(rows)
      dataRef.current = rows
      setLastUpdated(result.lastUpdated || null)
      setCacheVersion(result.cacheVersion ?? null)
    } catch (e) {
      if (mountedRef.current) {
        setError(e.message)
        onError?.(e)
      }
    }
  }, [onError])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) {
      refetch()
    } else {
      setLoading(false)
      setData([])
    }
    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [enabled, refetch])

  useEffect(() => {
    if (!enabled || loading) return
    if (!isPollingConfigured()) {
      if (import.meta.env.DEV) {
        console.warn(
          '[useCalendarPolling] Not configured: add VITE_CALENDAR_POLL_URL + VITE_CALENDAR_POLL_API_KEY to client/.env (restart Vite), or log in as staff so /api/config/calendar-poll can supply them.'
        )
      }
      return
    }

    pollRef.current = setInterval(() => {
      fetchFullSilent()
    }, intervalMs)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [enabled, intervalMs, loading, fetchFullSilent])

  return {
    data,
    loading,
    error,
    lastUpdated,
    cacheVersion,
    refetch,
    isConfigured: isPollingConfigured(),
  }
}
