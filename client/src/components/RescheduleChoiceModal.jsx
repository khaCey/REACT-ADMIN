import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'

/**
 * Choose whether to pick a new slot now or mark the lesson as awaiting a date (calendar graphite, app orange).
 */
export default function RescheduleChoiceModal({ onClose, onSelectNow, onSelectLater }) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, busy])

  const handleLater = async () => {
    setBusy(true)
    try {
      await onSelectLater?.()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rescheduleChoiceTitle"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose?.()}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 id="rescheduleChoiceTitle" className="text-lg font-semibold text-gray-900">
            Reschedule
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="px-6 pt-4 text-sm text-gray-600">
          Do you want to choose a new date and time now, or mark this lesson as waiting for a new date?
        </p>
        <div className="flex flex-col gap-2 px-6 py-5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSelectNow?.()}
            className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 cursor-pointer"
          >
            Select date now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleLater}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-600 bg-white px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 cursor-pointer"
          >
            {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />}
            {busy ? 'Saving…' : 'Date not set yet'}
          </button>
        </div>
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
          >
            Back
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
