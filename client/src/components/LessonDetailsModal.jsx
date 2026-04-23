import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, StickyNote } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import ConfirmActionModal from './ConfirmActionModal'

const STATUS_STYLES = {
  scheduled: { color: 'bg-emerald-600', text: 'Scheduled' },
  calendar_pending: { color: 'bg-sky-600', text: 'Calendar pending' },
  cancelled: { color: 'bg-slate-500', text: 'Cancelled' },
  reschedule_date_tbd: { color: 'bg-orange-500', text: 'Reschedule (date TBD)' },
  rescheduled: { color: 'bg-amber-600', text: 'Rescheduled' },
  demo: { color: 'bg-violet-600', text: 'Demo' },
  unscheduled: { color: 'bg-rose-600', text: 'Unscheduled' },
  deleting: { color: 'bg-slate-700', text: 'Deleting...' },
  sync_pending: { color: 'bg-indigo-600', text: 'Syncing with Calendar' },
  sync_failed: { color: 'bg-red-600', text: 'Calendar sync failed' },
}

export default function LessonDetailsModal({
  lesson,
  student,
  onClose,
  onCancel,
  onUncancel,
  onUnreschedule,
  onOpenRescheduleChoice,
  onSelectRescheduleDate,
  onSyncWithCalendar,
  onRemove,
  onLessonNotesChanged,
}) {
  const { success } = useToast()
  const [syncing, setSyncing] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [uncancelConfirmOpen, setUncancelConfirmOpen] = useState(false)
  const [unrescheduleConfirmOpen, setUnrescheduleConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [uncancelling, setUncancelling] = useState(false)
  const [unrescheduling, setUnrescheduling] = useState(false)
  const [lessonNotes, setLessonNotes] = useState([])
  const [lessonNotesLoading, setLessonNotesLoading] = useState(false)
  const [lessonNotesError, setLessonNotesError] = useState('')
  const [lessonNoteDraft, setLessonNoteDraft] = useState('')
  const [savingLessonNote, setSavingLessonNote] = useState(false)
  const [deletingLessonNoteId, setDeletingLessonNoteId] = useState(null)

  const lessonUuid = String(lesson?.lessonUUID || '').trim()

  const hasLessonIdentity = lessonUuid !== ''

  useEffect(() => {
    setSyncing(false)
    setCancelConfirmOpen(false)
    setUncancelConfirmOpen(false)
    setUnrescheduleConfirmOpen(false)
    setCancelling(false)
    setUncancelling(false)
    setUnrescheduling(false)
    setLessonNotes([])
    setLessonNotesLoading(false)
    setLessonNotesError('')
    setLessonNoteDraft('')
    setSavingLessonNote(false)
    setDeletingLessonNoteId(null)
  }, [lesson?.lessonUUID, lesson?.eventID])

  useEffect(() => {
    if (!hasLessonIdentity) return
    let cancelled = false
    setLessonNotesLoading(true)
    setLessonNotesError('')
    api
      .getLessonNotes(lessonUuid)
      .then((rows) => {
        if (cancelled) return
        setLessonNotes(Array.isArray(rows) ? rows : [])
      })
      .catch((err) => {
        if (cancelled) return
        setLessonNotesError(err?.message || 'Failed to load lesson notes')
      })
      .finally(() => {
        if (cancelled) return
        setLessonNotesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasLessonIdentity, lessonUuid])

  useEffect(() => {
    if (!lesson) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !cancelConfirmOpen && !uncancelConfirmOpen && !unrescheduleConfirmOpen) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lesson, onClose, cancelConfirmOpen, uncancelConfirmOpen, unrescheduleConfirmOpen])

  const lessonNoteCount = lessonNotes.length

  useEffect(() => {
    if (!hasLessonIdentity) return
    onLessonNotesChanged?.({
      lessonUUID: lessonUuid,
      hasNote: lessonNoteCount > 0,
      lessonNotes,
    })
  }, [hasLessonIdentity, lessonUuid, lessonNoteCount, lessonNotes, onLessonNotesChanged])

  if (!lesson) return null

  const status = (lesson.status || 'scheduled').toLowerCase()
  const calendarSyncStatus = String(lesson.calendarSyncStatus || 'synced').toLowerCase()
  const transientStatus = String(lesson.transientStatus || '').toLowerCase()
  const isAwaitingRescheduleDate = status === 'rescheduled' && !!lesson.awaitingRescheduleDate
  const isDemoLesson = String(lesson?.lessonKind || '').toLowerCase() === 'demo'

  const displayStatus =
    transientStatus === 'deleting'
      ? 'deleting'
      : transientStatus === 'sync_failed'
        ? 'sync_failed'
        : transientStatus === 'rescheduled'
          ? 'rescheduled'
          : transientStatus === 'sync_pending'
            ? 'sync_pending'
    : status === 'unscheduled'
      ? 'unscheduled'
      : isAwaitingRescheduleDate
        ? 'reschedule_date_tbd'
        : lesson?.optimisticRescheduledTo || lesson?.rescheduledTo
          ? 'rescheduled'
          : status === 'rescheduled'
            ? 'rescheduled'
            : status === 'cancelled'
            ? 'cancelled'
            : calendarSyncStatus === 'failed'
              ? 'sync_failed'
              : calendarSyncStatus === 'pending' && status === 'scheduled'
                ? 'calendar_pending'
                : isDemoLesson
                    ? 'demo'
                    : status
  const style = STATUS_STYLES[displayStatus] || STATUS_STYLES.scheduled
  const isUnscheduled = status === 'unscheduled'
  const isCancelled = status === 'cancelled'
  const isRescheduled = status === 'rescheduled'
  const hasRescheduledTo = !!(lesson?.optimisticRescheduledTo || lesson?.rescheduledTo)
  const isTransientBusy = transientStatus === 'sync_pending' || transientStatus === 'deleting'
  const canSyncWithCalendar = !isTransientBusy && !isUnscheduled && !isCancelled && !isRescheduled && calendarSyncStatus !== 'synced'
  const canReschedule =
    !isTransientBusy && !isUnscheduled && !isCancelled && !isRescheduled && calendarSyncStatus === 'synced'
  const canSelectRescheduleDate = !isTransientBusy && isAwaitingRescheduleDate && calendarSyncStatus === 'synced'
  const canUnreschedule =
    !isTransientBusy &&
    isRescheduled &&
    !!lesson?.rescheduledTo?.eventID &&
    !lesson?.optimisticRescheduledTo
  const hasSystemNotes =
    !!lesson?.optimisticRescheduledTo ||
    !!lesson?.rescheduledTo ||
    !!lesson?.rescheduledFrom ||
    !!lesson?.transientError ||
    !!lesson?.calendarSyncError ||
    isAwaitingRescheduleDate

  const isLocalOnlyRemove = calendarSyncStatus === 'failed'

  const dayStr = lesson.day && lesson.day !== '--'
    ? `${parseInt(lesson.day)}日`
    : 'Not specified'
  const timeStr = lesson.time && lesson.time !== '--'
    ? lesson.time.replace(':', '：')
    : 'Not specified'

  const confirmDialogOpen = cancelConfirmOpen || uncancelConfirmOpen || unrescheduleConfirmOpen

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
  const runUnreschedule = async () => {
    setUnrescheduling(true)
    try {
      const ok = await onUnreschedule?.(lesson, student)
      if (ok !== false) {
        setUnrescheduleConfirmOpen(false)
        onClose()
      }
    } finally {
      setUnrescheduling(false)
    }
  }
  const handleRemove = async () => {
    onClose()
    await onRemove?.(lesson, student)
  }
  const handleSyncWithCalendar = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await onSyncWithCalendar?.(lesson, student)
    } finally {
      setSyncing(false)
    }
  }

  const saveLessonNote = async () => {
    if (!hasLessonIdentity) return
    const note = lessonNoteDraft.trim()
    if (!note || savingLessonNote) return
    setSavingLessonNote(true)
    setLessonNotesError('')
    try {
      const created = await api.addLessonNote({
        lesson_uuid: lessonUuid,
        note,
        staff: '',
      })
      setLessonNotes((prev) => [created, ...prev])
      setLessonNoteDraft('')
      success('Lesson note saved')
    } catch (err) {
      setLessonNotesError(err?.message || 'Failed to save lesson note')
    } finally {
      setSavingLessonNote(false)
    }
  }

  const removeLessonNote = async (noteId) => {
    if (!noteId || deletingLessonNoteId != null) return
    setDeletingLessonNoteId(noteId)
    setLessonNotesError('')
    try {
      await api.deleteLessonNote(noteId)
      setLessonNotes((prev) => prev.filter((n) => Number(n.id) !== Number(noteId)))
      success('Lesson note deleted')
    } catch (err) {
      setLessonNotesError(err?.message || 'Failed to delete lesson note')
    } finally {
      setDeletingLessonNoteId(null)
    }
  }

  const noteHeader = useMemo(() => {
    if (!hasLessonIdentity) return 'Lesson Notes'
    if (lessonNoteCount === 0) return 'Lesson Notes'
    if (lessonNoteCount === 1) return 'Lesson Notes (1)'
    return `Lesson Notes (${lessonNoteCount})`
  }, [hasLessonIdentity, lessonNoteCount])

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
            <div className="mb-1 flex items-center gap-1 text-gray-700">
              <StickyNote className="h-4 w-4" />
              <label className="block text-sm font-medium">{noteHeader}</label>
            </div>
            <div className="text-sm text-gray-700 bg-gray-50 rounded-md p-3 min-h-[60px] space-y-2">
              {!hasLessonIdentity && (
                <div className="text-amber-700">This lesson does not have a stable lesson UUID yet, so lesson notes cannot be saved.</div>
              )}
              {lessonNotesLoading && <div>Loading lesson notes…</div>}
              {!lessonNotesLoading && hasLessonIdentity && lessonNotes.length === 0 && (
                <div className="text-gray-500">No lesson notes yet.</div>
              )}
              {!lessonNotesLoading && lessonNotes.length > 0 && (
                <ul className="space-y-2">
                  {lessonNotes.map((n) => (
                    <li key={n.id} className="rounded border border-gray-200 bg-white p-2">
                      <div className="whitespace-pre-wrap break-words">{n.note}</div>
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                        <span>{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</span>
                        <button
                          type="button"
                          disabled={deletingLessonNoteId === n.id}
                          onClick={() => removeLessonNote(n.id)}
                          className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {deletingLessonNoteId === n.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {hasLessonIdentity && (
                <div className="space-y-2 pt-1">
                  <textarea
                    value={lessonNoteDraft}
                    onChange={(e) => setLessonNoteDraft(e.target.value)}
                    rows={3}
                    placeholder="Add a lesson note…"
                    className="w-full rounded border border-gray-300 bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveLessonNote}
                      disabled={savingLessonNote || !lessonNoteDraft.trim()}
                      className="rounded-md border border-green-600 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {savingLessonNote ? 'Saving…' : 'Save lesson note'}
                    </button>
                  </div>
                </div>
              )}
              {lessonNotesError && <div className="text-red-600">{lessonNotesError}</div>}
            </div>
          </div>

          <div>
            <label className="block text-gray-600 mb-1">System Notes</label>
            <div className="text-sm text-gray-700 bg-gray-50 rounded-md p-3 min-h-[60px]">
              {lesson?.optimisticRescheduledTo && (
                <div>Moving to: {lesson.optimisticRescheduledTo.date || '--'} {lesson.optimisticRescheduledTo.time || '--'}</div>
              )}
              {lesson?.rescheduledTo && (
                <div>Moved to: {lesson.rescheduledTo.date || '--'} {lesson.rescheduledTo.time || '--'}</div>
              )}
              {lesson?.rescheduledFrom && (
                <div>Moved from: {lesson.rescheduledFrom.date || '--'} {lesson.rescheduledFrom.time || '--'}</div>
              )}
              {lesson?.transientError && (
                <div>{lesson.transientError}</div>
              )}
              {lesson?.calendarSyncError && (
                <div>Calendar sync error: {lesson.calendarSyncError}</div>
              )}
              {isAwaitingRescheduleDate && (
                <div className="text-amber-900">Awaiting a new date (rescheduled; shown in graphite in Google Calendar).</div>
              )}
              {!hasSystemNotes && 'No system notes.'}
            </div>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {!isCancelled && !isRescheduled && !isUnscheduled && (
              <button
                type="button"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={confirmDialogOpen || isTransientBusy}
                className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            )}
            {isCancelled && !hasRescheduledTo && (
              <button
                type="button"
                onClick={() => setUncancelConfirmOpen(true)}
                disabled={confirmDialogOpen || isTransientBusy}
                className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Uncancel
              </button>
            )}
            {canReschedule && (
              <button
                type="button"
                onClick={handleOpenRescheduleChoice}
                disabled={confirmDialogOpen || isTransientBusy}
                className="rounded-md border border-green-600 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Reschedule
              </button>
            )}
            {canSelectRescheduleDate && (
              <button
                type="button"
                onClick={handleSelectRescheduleDate}
                disabled={confirmDialogOpen || isTransientBusy}
                className="rounded-md border border-green-600 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Select date…
              </button>
            )}
            {canUnreschedule && (
              <button
                type="button"
                onClick={() => setUnrescheduleConfirmOpen(true)}
                disabled={confirmDialogOpen || isTransientBusy}
                className="rounded-md border border-violet-600 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Unreschedule
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
              disabled={confirmDialogOpen || isTransientBusy}
              title={
                isLocalOnlyRemove
                  ? 'Removes this lesson from the schedule only; does not delete from Google Calendar.'
                  : undefined
              }
              className="rounded-md border border-red-600 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLocalOnlyRemove ? 'Remove locally' : 'Remove'}
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
    {unrescheduleConfirmOpen && (
      <ConfirmActionModal
        title="Undo reschedule"
        message="Remove the new lesson slot and restore this lesson at its original time?"
        confirmLabel="Unreschedule"
        cancelLabel="Back"
        destructive
        confirming={unrescheduling}
        busyConfirmLabel="Undoing…"
        onConfirm={runUnreschedule}
        onClose={() => {
          if (!unrescheduling) setUnrescheduleConfirmOpen(false)
        }}
      />
    )}
    </>,
    document.body
  )
}
