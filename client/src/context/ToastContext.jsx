import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import ToastViewport from '../components/ToastViewport'

const ToastContext = createContext(null)
const TOAST_SHOW_DELAY_MS = 500

function makeToast(type, message, durationMs = 3000) {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    message,
    durationMs,
  }
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback((type, message, durationMs) => {
    const toast = makeToast(type, message, durationMs)
    setTimeout(() => {
      setToasts((prev) => [...prev, toast])
      if (toast.durationMs > 0) {
        setTimeout(() => dismissToast(toast.id), toast.durationMs)
      }
    }, TOAST_SHOW_DELAY_MS)
  }, [dismissToast])

  const success = useCallback((message, durationMs) => {
    pushToast('success', message, durationMs)
  }, [pushToast])

  const value = useMemo(() => ({
    success,
    dismissToast,
  }), [success, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  return ctx ?? {
    success: () => {},
    dismissToast: () => {},
  }
}
