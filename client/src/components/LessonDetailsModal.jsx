import { useEffect } from 'react'
import { createPortal } from 'react-dom'

const STATUS_STYLES = {
  scheduled: { color: 'bg-emerald-600', text: 'Scheduled' },
  cancelled: { color: 'bg-slate-500', text: 'Cancelled' },
  rescheduled: { color: 'bg-amber-500', text: 'Rescheduled' },
  demo: { color: 'bg-orange-500', text: 'Demo' },
  unscheduled: { color: 'bg-red-500', text: 'Unscheduled' },
}

export default function LessonDetailsModal({ lesson, student, onClose, onCancel, onUncancel, onReschedule, onRemove }) {
  if (!lesson) return null

  const status = (lesson.status || 'scheduled').toLowerCase()
  const style = STATUS_STYLES[status] || STATUS_STYLES.scheduled
  const isUnscheduled = status === 'unscheduled'
  const isCancelled = status === 'cancelled'

  const dayStr = lesson.day && lesson.day !== '--'
    ? `${parseInt(lesson.day)}日`
    : 'Not specified'
  const timeStr = lesson.time && lesson.time !== '--'
    ? lesson.time.replace(':', '：')
    : 'Not specified'

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleCancel = () => {
    onCancel?.(lesson, student)
    onClose()
  }
  const handleReschedule = () => {
    onReschedule?.(lesson, student)
    onClose()
  }
  const handleUncancel = () => {
    onUncancel?.(lesson, student)
    onClose()
  }
  const handleRemove = () => {
    onRemove?.(lesson, student)
    onClose()
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Lesson Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 cursor-pointer"
          >
            Close
          </button>
        </header>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${style.color}`} />
            <span className="font-medium">{style.text}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-gray-600 mb-1">Date</label>
              <div className="font-medium">{dayStr}</div>
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Time</label>
              <div className="font-medium">{timeStr}</div>
            </div>
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Notes</label>
            <div className="text-sm text-gray-700 bg-gray-50 rounded-md p-3 min-h-[60px]">
              No additional notes available.
            </div>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {!isCancelled && !isUnscheduled && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 cursor-pointer"
              >
                Cancel
              </button>
            )}
            {isCancelled && (
              <button
                type="button"
                onClick={handleUncancel}
                className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 cursor-pointer"
              >
                Uncancel
              </button>
            )}
            {!isUnscheduled && (
              <button
                type="button"
                onClick={handleReschedule}
                className="rounded-md border border-green-600 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 cursor-pointer"
              >
                Reschedule
              </button>
            )}
            <button
              type="button"
              onClick={handleRemove}
              className="rounded-md border border-red-600 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 cursor-pointer"
            >
              Remove
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
