import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import ConfirmActionModal from './ConfirmActionModal'

const STATUS_STYLES = {
  scheduled: { color: 'bg-emerald-600', text: 'Scheduled' },
  cancelled: { color: 'bg-slate-500', text: 'Cancelled' },
  reschedule_date_tbd: { color: 'bg-orange-500', text: 'Reschedule (date TBD)' },
  rescheduled: { color: 'bg-amber-500', text: 'Rescheduled' },
  demo: { color: 'bg-orange-500', text: 'Demo' },
  unscheduled: { color: 'bg-red-500', text: 'Unscheduled' },
  sync_pending: { color: 'bg-red-500', text: 'Syncing with Calendar' },
  sync_failed: { color: 'bg-red-600', text: 'Calendar sync failed' },
}

export default function LessonDetailsModal({
  lesson,
  student,
  onClose,
  onCancel,
  onUncancel,
  onOpenRescheduleChoice,
  onSelectRescheduleDate,
  onSyncWithCalendar,
  onRemove,
}) {
  const [syncing, setSyncing] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [uncancelConfirmOpen, setUncancelConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [uncancelling, setUncancelling] = useState(false)
  useEffect(() => {
    setSyncing(false)
    setCancelConfirmOpen(false)
    setUncancelConfirmOpen(false)
    setCancelling(false)
    setUncancelling(false)
  }, [lesson?.eventID])
  useEffect(() => {
    if (!lesson) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !cancelConfirmOpen && !uncancelConfirmOpen) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lesson, onClose, cancelConfirmOpen, uncancelConfirmOpen])

  if (!lesson) return null

  const status = (lesson.status || 'scheduled').toLowerCase()
  const calendarSyncStatus = String(lesson.calendarSyncStatus || 'synced').toLowerCase()
  const isAwaitingRescheduleDate = status === 'cancelled' && !!lesson.awaitingRescheduleDate

  const displayStatus =
    status === 'unscheduled'
      ? 'unscheduled'
      : isAwaitingRescheduleDate
        ? 'reschedule_date_tbd'
        : lesson?.rescheduledTo
          ? 'rescheduled'
          : status === 'cancelled'
            ? 'cancelled'
            : lesson?.rescheduledFrom
              ? 'rescheduled'
              : calendarSyncStatus === 'failed'
                ? 'sync_failed'
                : calendarSyncStatus === 'pending'
                  ? 'sync_pending'
                  : status
  const style = STATUS_STYLES[displayStatus] || STATUS_STYLES.scheduled
  const isUnscheduled = status === 'unscheduled'
  const isCancelled = status === 'cancelled'
  const hasRescheduledTo = !!lesson?.rescheduledTo
  const canSyncWithCalendar = !isUnscheduled && !isCancelled && calendarSyncStatus !== 'synced'
  const canReschedule =
    !isUnscheduled && !isCancelled && calendarSyncStatus === 'synced'
  const canSelectRescheduleDate = isAwaitingRescheduleDate && calendarSyncStatus === 'synced'
  const hasExtraNotes =
    !!lesson?.rescheduledTo ||
    !!lesson?.rescheduledFrom ||
    !!lesson?.calendarSyncError ||
    isAwaitingRescheduleDate

  const dayStr = lesson.day && lesson.day !== '--'
    ? `${parseInt(lesson.day)}日`
    : 'Not specified'
  const timeStr = lesson.time && lesson.time !== '--'
    ? lesson.time.replace(':', '：')
    : 'Not specified'

  const confirmDialogOpen = cancelConfirmOpen || uncancelConfirmOpen

  const handleBackdropClick = (e) => {
    if (confirmDialogOpen) return
    if (e.target === e.currentTarget) onClose()
  }

  const runCancel = async () => {
    setCancelling(true)
    try {
      const ok = await onCancel?.(lesson, student)
      if (ok !== false) {
        setCancelConfirmOpen(false)
        onClose()
      }
    } finally {
      setCancelling(false)
    }
  }
  const handleOpenRescheduleChoice = () => {
    onOpenRescheduleChoice?.(lesson, student)
  }
  const handleSelectRescheduleDate = () => {
    onSelectRescheduleDate?.(lesson, student)
  }
  const runUncancel = async () => {
    setUncancelling(true)
    try {
      const ok = await onUncancel?.(lesson, student)
      if (ok !== false) {
        setUncancelConfirmOpen(false)
        onClose()
      }
    } finally {
      setUncancelling(false)
    }
  }
  const handleRemove = async () => {
    const ok = await onRemove?.(lesson, student)
    if (ok !== false) onClose()
  }
  const handleSyncWithCalendar = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const ok = await onSyncWithCalendar?.(lesson, student)
      if (ok !== false) onClose()
    } finally {
      setSyncing(false)
    }
  }

  return createPortal(
    <>
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
            disabled={confirmDialogOpen}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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
              {lesson?.rescheduledTo && (
                <div>Rescheduled to: {lesson.rescheduledTo.date || '--'} {lesson.rescheduledTo.time || '--'}</div>
              )}
              {lesson?.rescheduledFrom && (
                <div>Rescheduled from: {lesson.rescheduledFrom.date || '--'} {lesson.rescheduledFrom.time || '--'}</div>
              )}
              {lesson?.calendarSyncError && (
                <div>Calendar sync error: {lesson.calendarSyncError}</div>
              )}
              {isAwaitingRescheduleDate && (
                <div className="text-amber-900">Awaiting a new date (cancelled in Google Calendar).</div>
              )}
              {!hasExtraNotes && 'No additional notes available.'}
            </div>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {!isCancelled && !isUnscheduled && (
              <button
                type="button"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={confirmDialogOpen}
                className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            )}
            {isCancelled && !hasRescheduledTo && (
              <button
                type="button"
                onClick={() => setUncancelConfirmOpen(true)}
                disabled={confirmDialogOpen}
                className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Uncancel
              </button>
            )}
            {canReschedule && (
              <button
                type="button"
                onClick={handleOpenRescheduleChoice}
                disabled={confirmDialogOpen}
                className="rounded-md border border-green-600 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Reschedule
              </button>
            )}
            {canSelectRescheduleDate && (
              <button
                type="button"
                onClick={handleSelectRescheduleDate}
                disabled={confirmDialogOpen}
                className="rounded-md border border-green-600 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Select date…
              </button>
            )}
            {canSyncWithCalendar && (
              <button
                type="button"
                onClick={handleSyncWithCalendar}
                disabled={syncing || confirmDialogOpen}
                aria-busy={syncing}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                {syncing && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />}
                {syncing ? 'Syncing…' : 'Sync with Calendar'}
              </button>
            )}
            <button
              type="button"
              onClick={handleRemove}
              disabled={confirmDialogOpen}
              className="rounded-md border border-red-600 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Remove
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={confirmDialogOpen}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
    {cancelConfirmOpen && (
      <ConfirmActionModal
        title="Cancel lesson"
        message="Cancel this lesson?"
        confirmLabel="Cancel lesson"
        cancelLabel="Back"
        destructive
        confirming={cancelling}
        busyConfirmLabel="Cancelling…"
        onConfirm={runCancel}
        onClose={() => {
          if (!cancelling) setCancelConfirmOpen(false)
        }}
      />
    )}
    {uncancelConfirmOpen && (
      <ConfirmActionModal
        title="Restore lesson"
        message="Restore this lesson?"
        confirmLabel="Uncancel"
        cancelLabel="Back"
        confirming={uncancelling}
        busyConfirmLabel="Restoring…"
        onConfirm={runUncancel}
        onClose={() => {
          if (!uncancelling) setUncancelConfirmOpen(false)
        }}
      />
    )}
    </>,
    document.body
  )
}
