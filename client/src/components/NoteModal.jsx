import { useState, useEffect } from 'react'
import { api } from '../api'
import { STAFF_OPTIONS } from '../constants/staff'
import { formatDateTimeUTC } from '../utils/format'
import ConfirmActionModal from './ConfirmActionModal'
import { useToast } from '../context/ToastContext'
import { useGuideTour } from '../context/GuideTourContext'
import { useAuth } from '../context/AuthContext'

export default function NoteModal({ studentId, mode = 'add', note = null, onSave, onClose }) {
  const { success } = useToast()
  const { activeGuideSlug } = useGuideTour()
  const { staff: currentStaff } = useAuth()
  const preventDelete = !!activeGuideSlug
  const [date, setDate] = useState('')
  const [staff, setStaff] = useState('Staff')
  const [noteText, setNoteText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [studentGroupMembers, setStudentGroupMembers] = useState(null)
  const [linkedGroupId, setLinkedGroupId] = useState(null)
  const [groupFetchDone, setGroupFetchDone] = useState(true)
  const [replicateToLinkedGroup, setReplicateToLinkedGroup] = useState(false)

  const defaultStaffName = currentStaff?.name && String(currentStaff.name).trim()
    ? String(currentStaff.name).trim()
    : 'Staff'

  useEffect(() => {
    if (mode === 'edit' && note) {
      const d = note.Date || note.date || ''
      setDate(d ? new Date(d).toISOString().slice(0, 10) : '')
      setStaff(note.Staff || note.staff || defaultStaffName)
      setNoteText(note.Note || note.note || '')
    } else {
      setDate(new Date().toISOString().slice(0, 10))
      setStaff(defaultStaffName)
      setNoteText('')
    }
  }, [mode, note, defaultStaffName])

  useEffect(() => {
    if (mode !== 'add' || studentId == null) {
      setStudentGroupMembers(null)
      setLinkedGroupId(null)
      setReplicateToLinkedGroup(false)
      setGroupFetchDone(true)
      return
    }
    setGroupFetchDone(false)
    setLinkedGroupId(null)
    setStudentGroupMembers(null)
    let cancelled = false
    api
      .getStudentGroup(studentId)
      .then((res) => {
        if (!cancelled) {
          const members = res?.members ?? null
          setStudentGroupMembers(members)
          const gid = res?.groupId
          setLinkedGroupId(gid != null && Number.isFinite(Number(gid)) ? Number(gid) : null)
          setReplicateToLinkedGroup(Array.isArray(members) && members.length > 1)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStudentGroupMembers(null)
          setLinkedGroupId(null)
          setReplicateToLinkedGroup(false)
        }
      })
      .finally(() => {
        if (!cancelled) setGroupFetchDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [mode, studentId])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'add') {
        const payload = {
          'Student ID': studentId,
          Staff: staff,
          Note: noteText,
        }
        if (replicateToLinkedGroup) {
          payload.replicate_to_linked_group = true
          if (linkedGroupId != null && Number.isFinite(linkedGroupId)) {
            payload.linked_group_id = linkedGroupId
          }
        }
        const result = await api.addNote(payload)
        const replicated = result?.replicated_note_ids?.length ?? 0
        const totalStudents = 1 + replicated
        if (totalStudents > 1) {
          success(`Note recorded for ${totalStudents} students.`)
        } else {
          success('Note created')
        }
      } else {
        await api.updateNote(note.ID, {
          Staff: staff,
          Note: noteText,
        })
        success('Note updated')
      }
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (preventDelete) {
      setShowDeleteConfirm(false)
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await api.deleteNote(note.ID)
      success('Note deleted')
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8 bg-black/50"
      onClick={handleBackdropClick}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold">{mode === 'edit' ? 'Edit Note' : 'Add Note'}</h3>
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 cursor-pointer">
            Close
          </button>
        </header>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-gray-600 mb-1">Date</label>
            {mode === 'edit' && note ? (
              <p className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700" aria-readonly>
                {formatDateTimeUTC(note.Date || note.date)}
              </p>
            ) : (
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
              />
            )}
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Staff</label>
            <select
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              {(STAFF_OPTIONS.includes(staff) ? STAFF_OPTIONS : [...STAFF_OPTIONS, staff]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-gray-600 mb-1">Note</label>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
        </div>
        {mode === 'add' && studentId != null && !groupFetchDone && (
          <p className="px-4 pb-2 text-sm text-gray-500">Loading linked group…</p>
        )}
        {mode === 'add' && groupFetchDone && Array.isArray(studentGroupMembers) && studentGroupMembers.length > 1 && (
          <div className="px-4 pb-2">
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-gray-300"
                checked={replicateToLinkedGroup}
                onChange={(e) => setReplicateToLinkedGroup(e.target.checked)}
              />
              <span>
                Apply this note to all linked group members ({studentGroupMembers.length - 1}{' '}
                {studentGroupMembers.length - 1 === 1 ? 'other' : 'others'})
              </span>
            </label>
          </div>
        )}
        {mode === 'edit' && (
          <p className="px-4 pb-2 text-xs text-amber-700">
            If this note is linked to a duplicated group batch, saving or deleting will apply to all linked notes.
          </p>
        )}
        {error && <p className="px-4 text-red-600 text-sm">{error}</p>}
        <footer className="flex justify-between gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
                className="rounded-md bg-rose-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting || (mode === 'add' && studentId != null && !groupFetchDone)}
            className="rounded-md bg-green-600 text-white px-4 py-1.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </form>
      {showDeleteConfirm && (
        <ConfirmActionModal
          title="Delete Note"
          message={
            mode === 'edit'
              ? 'Are you sure? If this note is linked to a duplicated group batch, all linked notes will be deleted.'
              : 'Are you sure you want to delete this note?'
          }
          confirmLabel="Delete"
          destructive
          confirming={deleting}
          onConfirm={handleDelete}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
