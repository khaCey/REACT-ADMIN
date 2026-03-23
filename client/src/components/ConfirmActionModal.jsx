import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'

export default function ConfirmActionModal({
  title = 'Confirm Action',
  message = 'Are you sure you want to continue?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  /** Text on the confirm button while `confirming` is true (default: "Please wait..."). */
  busyConfirmLabel,
  destructive = false,
  confirming = false,
  highlightConfirm = false,
  onConfirm,
  onClose,
  children,
  showCloseButton = true,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !confirming) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, confirming])

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirming) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {showCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <span className="w-9" aria-hidden />
          )}
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{message}</p>
          {children}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-50 cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white disabled:opacity-50 cursor-pointer ${
              destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-green-600 hover:bg-green-700'
            } ${highlightConfirm ? 'ring-4 ring-yellow-300 animate-pulse shadow-xl' : ''}`}
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                <span>{busyConfirmLabel ?? 'Please wait...'}</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
