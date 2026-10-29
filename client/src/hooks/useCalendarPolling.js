import { useEffect, useState, useCallback, useRef } from 'react'
import { fetchCalendarSyncStatus } from '../api/pollingApi'

/** Read local sync metadata. Only the server contacts GAS and imports lessons. */
export function useCalendarPolling({ intervalMs = 30000, enabled = true } = {}) {
  const [snapshot, setSnapshot] = useState({ status: null, error: null, loading: true })
  const generation = useRef(0)
  const inFlight = useRef(null)
  const refetch = useCallback(async () => {
    if (!enabled) return
    const gen = generation.current
    if (inFlight.current?.gen === gen) return inFlight.current.promise
    const promise = fetchCalendarSyncStatus().then((status) => {
      if (generation.current === gen) setSnapshot({ status, error: null, loading: false })
    }).catch((err) => {
      if (generation.current === gen) setSnapshot((previous) => ({ ...previous, error: err.message, loading: false }))
    }).finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null
    })
    inFlight.current = { gen, promise }
    return promise
  }, [enabled])

  useEffect(() => {
    generation.current += 1
    if (!enabled) return
    refetch()
    const timer = setInterval(refetch, intervalMs)
    return () => {
      generation.current += 1
      clearInterval(timer)
    }
  }, [enabled, intervalMs, refetch])

  const status = enabled ? snapshot.status : null
  return {
    data: [],
    loading: enabled && snapshot.loading,
    error: enabled ? snapshot.error || (status?.failed ? 'The last Calendar import failed; the server will retry.' : null) : null,
    lastUpdated: status?.lastSuccessAt || null,
    cacheVersion: status?.version ?? null,
    refetch,
    isConfigured: !!status?.configured,
  }
}
