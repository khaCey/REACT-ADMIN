import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Calendar, CalendarRange, Contact, Users, Coffee, Pencil, Info } from 'lucide-react'

const ROW =
  'flex-1 min-w-0 inline-flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors'
const ROW_DISABLED =
  'flex-1 min-w-0 inline-flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-sm font-medium text-gray-400 line-through cursor-not-allowed'

function InfoTip({ text }) {
  return (
    <span className="relative group/tip shrink-0">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-help"
        aria-label={text}
        onClick={(e) => e.stopPropagation()}
      >
        <Info className="w-3.5 h-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 bottom-full z-[1] mb-1.5 w-52 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

function ActionRow({
  icon: Icon,
  label,
  tip,
  disabled = false,
  highlight = false,
  onClick,
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${disabled ? ROW_DISABLED : ROW} ${
          highlight ? 'relative z-[30] ring-4 ring-yellow-300 animate-pulse shadow-xl bg-yellow-50' : ''
        }`}
      >
        <Icon className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      <InfoTip text={tip} />
    </div>
  )
}

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
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-4 py-3 space-y-1.5">
          {showBookLesson && (
            <ActionRow
              icon={Calendar}
              label={bookLessonLabel}
              tip={
                bookLessonDisabled
                  ? '予約機能は一時的に無効です'
                  : 'カレンダーを開いてこの生徒のレッスンを予約します'
              }
              disabled={bookLessonDisabled}
              onClick={() => {
                if (bookLessonDisabled) return
                runAndClose(onBookLesson)
              }}
            />
          )}
          {showCreateReserved && (
            <ActionRow
              icon={CalendarRange}
              label="Create 固定"
              tip="この生徒の毎週の固定（予約済み）ホールドを作成します"
              onClick={() => runAndClose(onCreateReserved)}
            />
          )}
          <ActionRow
            icon={Contact}
            label={syncingGoogleContact ? 'Syncing…' : 'Sync Google Contact'}
            tip="この生徒の Google 連絡先を作成または更新します"
            disabled={syncingGoogleContact}
            onClick={runSyncGoogleContact}
          />
          {showManageGroup && (
            <ActionRow
              icon={Users}
              label="Manage Group Members"
              tip="このグループレッスンの生徒をリンク／解除します"
              onClick={() => runAndClose(onManageGroup)}
            />
          )}
          {showMarkHiatus && (
            <ActionRow
              icon={Coffee}
              label="Mark on break (休会中)"
              tip="この生徒を休会中にします"
              onClick={() => runAndClose(onMarkHiatus)}
            />
          )}
          <ActionRow
            icon={Pencil}
            label="Edit"
            tip="生徒のプロフィール情報を編集します"
            highlight={highlightEdit}
            onClick={() => runAndClose(onEdit)}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
