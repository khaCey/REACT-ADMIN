import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Calendar, CalendarRange, Contact, Users, Coffee, Pencil } from 'lucide-react'

const ROW =
  'w-full inline-flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors'
const ROW_DISABLED =
  'w-full inline-flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-sm font-medium text-gray-400 line-through cursor-not-allowed'

/**
 * Student actions opened from the footer settings gear.
 */
export default function StudentSettingsModal({
  studentName,
  syncingGoogleContact = false,
  showBookLesson = false,
  bookLessonDisabled = false,
  bookLessonLabel = 'Book lesson',
  showCreateReserved = false,
  showManageGroup = false,
  showMarkHiatus = false,
  highlightEdit = false,
  onBookLesson,
  onCreateReserved,
  onSyncGoogleContact,
  onManageGroup,
  onMarkHiatus,
  onEdit,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !syncingGoogleContact) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, syncingGoogleContact])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !syncingGoogleContact) onClose()
  }

  const runAndClose = (fn) => {
    if (typeof fn !== 'function') return
    fn()
    onClose()
  }

  const runSyncGoogleContact = async () => {
    if (typeof onSyncGoogleContact !== 'function' || syncingGoogleContact) return
    await onSyncGoogleContact()
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-xl border border-gray-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-settings-title"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h2 id="student-settings-title" className="text-base font-semibold text-gray-900">
              Settings
            </h2>
            {studentName ? (
              <p className="text-xs text-gray-500 truncate mt-0.5">{studentName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={syncingGoogleContact}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 cursor-pointer disabled:opacity-50"
            aria-label="Close settings"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-4 py-3 space-y-1.5">
          {showBookLesson && (
            <button
              type="button"
              onClick={() => {
                if (bookLessonDisabled) return
                runAndClose(onBookLesson)
              }}
              disabled={bookLessonDisabled}
              title={
                bookLessonDisabled
                  ? 'Booking is temporarily disabled'
                  : 'Open the calendar to book a lesson for this student'
              }
              className={bookLessonDisabled ? ROW_DISABLED : ROW}
            >
              <Calendar className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
              <span>{bookLessonLabel}</span>
            </button>
          )}
          {showCreateReserved && (
            <button
              type="button"
              onClick={() => runAndClose(onCreateReserved)}
              title="Create a weekly 固定 (reserved) hold for this student"
              className={ROW}
            >
              <CalendarRange className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
              <span>Create 固定</span>
            </button>
          )}
          <button
            type="button"
            onClick={runSyncGoogleContact}
            disabled={syncingGoogleContact}
            title="Create or update this student’s Google Contact"
            className={syncingGoogleContact ? ROW_DISABLED : ROW}
          >
            <Contact className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
            <span>{syncingGoogleContact ? 'Syncing…' : 'Sync Google Contact'}</span>
          </button>
          {showManageGroup && (
            <button
              type="button"
              onClick={() => runAndClose(onManageGroup)}
              title="Link or unlink students in this group lesson"
              className={ROW}
            >
              <Users className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
              <span>Manage Group Members</span>
            </button>
          )}
          {showMarkHiatus && (
            <button
              type="button"
              onClick={() => runAndClose(onMarkHiatus)}
              title="Mark this student as on break (休会中)"
              className={ROW}
            >
              <Coffee className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
              <span>Mark on break (休会中)</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => runAndClose(onEdit)}
            title="Edit student profile details"
            className={`${ROW} ${
              highlightEdit
                ? 'relative z-[30] ring-4 ring-yellow-300 animate-pulse shadow-xl bg-yellow-50'
                : ''
            }`}
          >
            <Pencil className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
            <span>Edit</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
