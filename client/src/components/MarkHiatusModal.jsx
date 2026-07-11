import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

/** Small modal to mark a student on break with optional expected return date. */
export default function MarkHiatusModal({ studentName, onConfirm, onClose, submitting = false }) {
  const [expectedReturn, setExpectedReturn] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !submitting && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !submitting) onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Mark on break (休会中)</h3>
          <p className="text-sm text-gray-600 mt-1">
            {studentName ? `${studentName} will be listed under 休会中.` : 'Student will be listed under 休会中.'}
          </p>
        </header>
        <div className="p-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Expected return date <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="date"
            value={expectedReturn}
            onChange={(e) => setExpectedReturn(e.target.value)}
            disabled={submitting}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onConfirm(expectedReturn.trim() || null)}
            className="rounded-md bg-amber-600 text-white px-4 py-1.5 text-sm font-semibold hover:bg-amber-700 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Mark on break'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
