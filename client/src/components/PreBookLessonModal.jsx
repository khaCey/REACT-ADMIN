import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function PreBookLessonModal({ onClose, onConfirm, overlayClassName, description }) {
  const [packTotal, setPackTotal] = useState('4')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    const n = parseInt(String(packTotal).trim(), 10)
    if (!Number.isFinite(n) || n < 1) {
      setError('Please enter total lessons (1 or more).')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await onConfirm?.(n)
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/50 p-4 ${overlayClassName ?? 'z-[10001]'}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl ring-1 ring-black/5">
        <div className="border-b border-gray-200 px-5 py-3">
          <h3 className="text-base font-semibold text-gray-900">月何回</h3>
          {description ? <p className="mt-1.5 text-sm text-gray-600 font-normal">{description}</p> : null}
        </div>
        <div className="px-5 py-4">
          <label className="block text-sm font-medium text-gray-700">月何回</label>
          <input
            type="number"
            min="1"
            step="1"
            value={packTotal}
            onChange={(e) => setPackTotal(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            placeholder="e.g. 4"
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {submitting ? 'Opening...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

