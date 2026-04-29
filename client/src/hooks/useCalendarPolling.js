/**
 * useCalendarPolling — React hook for Calendar Webhook polling.
 * Follows POLLING_API_SPEC.md flow:
 * 1. Startup: fetch full data
 * 2. Poll every intervalMs
 * 3. When changed: apply diff
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  pollCalendarChanges,
  fetchFullCalendar,
  isPollingConfigured,
  ensurePollingConfig,
} from '../api/pollingApi'

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
        setData(result.data || [])
        dataRef.current = result.data || []
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
    if (!enabled || loading || !isPollingConfigured()) return

    pollRef.current = setInterval(async () => {
      try {
        const result = await pollCalendarChanges()
        if (result._skipped) return
        if (result.changed && result.diff && mountedRef.current) {
          const d = result.diff
          const addedLen = d.added?.length ?? 0
          const removedLen = d.removed?.length ?? 0
          const updatedLen = d.updated?.length ?? 0

          const shouldHydrate = (dataRef.current?.length || 0) === 0 && (addedLen + updatedLen + removedLen) > 0

          if (shouldHydrate) {
            try {
              const full = await fetchFullCalendar()
              const fullData = Array.isArray(full?.data) ? full.data : []
              if (mountedRef.current) {
                dataRef.current = fullData
                // Apply diff on top of hydrated snapshot.
                const hydratedMerged = applyDiff(fullData, d)
                setData(hydratedMerged)
                setLastUpdated(result.diff.lastUpdated || full.lastUpdated || null)
                setCacheVersion(result.diff.cacheVersion ?? full.cacheVersion ?? null)
                onChanged?.(result.diff)
              }
            } catch {
              // If hydration fails, fall back to applying diff to current cache.
              setData((prev) => applyDiff(prev, d))
              setLastUpdated(result.diff.lastUpdated || null)
              setCacheVersion(result.diff.cacheVersion ?? null)
              onChanged?.(result.diff)
            }
          } else {
            setData((prev) => {
              const merged = applyDiff(prev, d)
              dataRef.current = merged
              return merged
            })
            setLastUpdated(result.diff.lastUpdated || null)
            setCacheVersion(result.diff.cacheVersion ?? null)
            onChanged?.(result.diff)
          }
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
  }, [enabled, intervalMs, loading, onChanged, onError])

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
