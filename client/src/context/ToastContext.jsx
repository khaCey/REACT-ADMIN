import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import ToastViewport from '../components/ToastViewport'

const ToastContext = createContext(null)
const TOAST_SHOW_DELAY_MS = 500

/** @param {number | { durationMs?: number, onClick?: () => void } | undefined} options */
function normalizeToastOptions(options) {
  if (typeof options === 'number') {
    return { durationMs: options, onClick: undefined }
  }
  if (options && typeof options === 'object') {
    return {
      durationMs: options.durationMs ?? 3000,
      onClick: typeof options.onClick === 'function' ? options.onClick : undefined,
    }
  }
  return { durationMs: 3000, onClick: undefined }
}

function makeToast(type, message, options) {
  const { durationMs, onClick } = normalizeToastOptions(options)
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    message,
    durationMs,
    onClick,
  }
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback((type, message, options) => {
    const toast = makeToast(type, message, options)
    setTimeout(() => {
      setToasts((prev) => [...prev, toast])
      if (toast.durationMs > 0) {
        setTimeout(() => dismissToast(toast.id), toast.durationMs)
      }
    }, TOAST_SHOW_DELAY_MS)
  }, [dismissToast])

  const success = useCallback((message, options) => {
    pushToast('success', message, options)
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
