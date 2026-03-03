/**
 * useCalendarPolling — React hook for Calendar Webhook polling.
 * Follows POLLING_API_SPEC.md flow:
 * 1. Startup: fetch full data
 * 2. Poll every intervalMs
 * 3. When changed: apply diff
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { pollCalendarChanges, fetchFullCalendar, isPollingConfigured } from '../api/pollingApi'

function rowKey(row) {
  return `${row.eventID || ''}|${row.studentName || ''}`
}

function applyDiff(current, diff) {
  const map = new Map(current.map((r) => [rowKey(r), r]))

  for (const row of diff.added || []) {
    map.set(rowKey(row), row)
  }
  for (const key of diff.removed || []) {
    map.delete(key)
  }
  for (const row of diff.updated || []) {
    map.set(rowKey(row), row)
  }

  return Array.from(map.values())
}

export function useCalendarPolling(options = {}) {
  const {
    intervalMs = 300000, // 5 minutes
    enabled = true,
    onChanged,
    onError,
  } = options

  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [cacheVersion, setCacheVersion] = useState(null)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)

  const refetch = useCallback(async () => {
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
        setData(result.data || [])
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

  useEffect(() => {
    mountedRef.current = true
    if (enabled && isPollingConfigured()) {
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
    if (!enabled || !isPollingConfigured()) return

    pollRef.current = setInterval(async () => {
      try {
        const result = await pollCalendarChanges()
        if (result._skipped) return
        if (result.changed && result.diff && mountedRef.current) {
          setData((prev) => applyDiff(prev, result.diff))
          setLastUpdated(result.diff.lastUpdated || null)
          setCacheVersion(result.diff.cacheVersion ?? null)
          onChanged?.(result.diff)
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(e.message)
          onError?.(e)
        }
      }
    }, intervalMs)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [enabled, intervalMs, onChanged, onError])

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
