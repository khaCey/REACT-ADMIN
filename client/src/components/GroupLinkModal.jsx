import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'

function normalizeMemberId(value) {
  if (value === '' || value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null
  return num
}

export default function GroupLinkModal({
  student,
  initialGroup = null,
  onClose,
  onSave,
}) {
  const expectedSize = Math.max(
    2,
    parseInt(student?.人数 ?? student?.group_size, 10) || initialGroup?.expectedSize || 2
  )
  const currentStudentId = normalizeMemberId(student?.ID ?? student?.id)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [memberIds, setMemberIds] = useState(() => Array.from({ length: expectedSize }, () => ''))
  const [memberQueries, setMemberQueries] = useState(() => Array.from({ length: expectedSize }, () => ''))
  const [activePickerIndex, setActivePickerIndex] = useState(null)
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1)
  const pickerRefs = useRef([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .getStudents()
      .then((rows) => {
        if (cancelled) return
        setStudents(Array.isArray(rows) ? rows : [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load students')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const initialMembers = Array.from({ length: expectedSize }, () => '')
    const orderedExisting = Array.isArray(initialGroup?.members) ? [...initialGroup.members] : []
    orderedExisting
      .sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0))
      .slice(0, expectedSize)
      .forEach((member, index) => {
        if (member != null && member.id !== undefined && member.id !== null) {
          initialMembers[index] = String(member.id)
        }
      })
    if (currentStudentId !== null && !initialMembers.includes(String(currentStudentId))) {
      const firstEmpty = initialMembers.findIndex((value) => !value)
      if (firstEmpty >= 0) initialMembers[firstEmpty] = String(currentStudentId)
      else initialMembers[0] = String(currentStudentId)
    }
    setMemberIds(initialMembers)
    setMemberQueries(Array.from({ length: expectedSize }, () => ''))
    setActivePickerIndex(null)
    setHighlightedSuggestionIndex(-1)
  }, [expectedSize, initialGroup, currentStudentId])

  const studentOptions = useMemo(() => {
    return (students || []).filter((row) => {
      if (row?.Group !== 'Group') return false
      if ((student?.子 || '') === '子') return (row?.子 || '') === '子'
      if ((student?.子 || '') !== '子') return (row?.子 || '') !== '子'
      return true
    })
  }, [students, student])

  useEffect(() => {
    setMemberQueries((prev) =>
      Array.from({ length: expectedSize }, (_, index) => {
        const selectedId = String(memberIds[index] || '')
        if (!selectedId) return prev[index] || ''
        const matched = studentOptions.find((entry) => String(entry?.ID ?? '') === selectedId)
        return matched?.Name || prev[index] || ''
      })
    )
  }, [expectedSize, memberIds, studentOptions])

  const suggestionOptionsByIndex = useMemo(() => {
    return memberIds.map((value, index) => {
      const selectedElsewhere = new Set(
        memberIds
          .filter((entry, idx) => idx !== index && String(entry || '').trim())
          .map((entry) => String(entry))
      )
      const query = String(memberQueries[index] || '')
        .trim()
        .toLowerCase()
      return studentOptions.filter((entry) => {
        if (entry?.ID === undefined || entry?.ID === null) return false
        const entryId = String(entry.ID)
        if (selectedElsewhere.has(entryId)) return false
        if (!query) return true
        const searchable = `${entry?.Name || ''} ${entry?.ID || ''} ${entry?.Email || ''} ${entry?.Phone || ''}`.toLowerCase()
        return searchable.includes(query)
      })
    })
  }, [memberIds, memberQueries, studentOptions])

  useEffect(() => {
    if (activePickerIndex === null) return undefined
    const handleMouseDown = (event) => {
      const pickerNode = pickerRefs.current[activePickerIndex]
      if (pickerNode && !pickerNode.contains(event.target)) {
        setActivePickerIndex(null)
        setHighlightedSuggestionIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [activePickerIndex])

  const handleMemberChange = (index, value) => {
    setMemberIds((prev) => prev.map((entry, idx) => (idx === index ? value : entry)))
  }

  const handleMemberQueryChange = (index, value) => {
    setMemberQueries((prev) => prev.map((entry, idx) => (idx === index ? value : entry)))
    const currentValue = String(memberIds[index] || '')
    if (currentValue) {
      const matched = studentOptions.find((entry) => String(entry?.ID ?? '') === currentValue)
      const matchedName = matched?.Name || ''
      if (value !== matchedName) handleMemberChange(index, '')
    }
    setActivePickerIndex(index)
    setHighlightedSuggestionIndex(0)
  }

  const handleSuggestionSelect = (index, option) => {
    if (option?.ID === undefined || option?.ID === null) return
    const selectedId = String(option.ID)
    handleMemberChange(index, selectedId)
    setMemberQueries((prev) => prev.map((entry, idx) => (idx === index ? option?.Name || '' : entry)))
    setActivePickerIndex(null)
    setHighlightedSuggestionIndex(-1)
  }

  const handlePickerKeyDown = (event, index) => {
    const suggestions = suggestionOptionsByIndex[index] || []
    if (!suggestions.length && event.key !== 'Escape') return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActivePickerIndex(index)
      setHighlightedSuggestionIndex((prev) => {
        if (prev < 0) return 0
        return Math.min(prev + 1, suggestions.length - 1)
      })
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActivePickerIndex(index)
      setHighlightedSuggestionIndex((prev) => {
        if (prev <= 0) return 0
        return prev - 1
      })
      return
    }
    if (event.key === 'Enter') {
      if (activePickerIndex !== index) return
      const selectedOption = suggestions[highlightedSuggestionIndex]
      if (!selectedOption) return
      event.preventDefault()
      handleSuggestionSelect(index, selectedOption)
      return
    }
    if (event.key === 'Escape') {
      setActivePickerIndex(null)
      setHighlightedSuggestionIndex(-1)
    }
  }

  const handleSave = async () => {
    const normalized = memberIds.map((value) => String(value || '').trim())
    if (normalized.some((value) => !value)) {
      setError('Select a student for every position.')
      return
    }
    const ids = normalized.map((value) => Number(value))
    if (new Set(ids).size !== ids.length) {
      setError('Each student can only appear once.')
      return
    }
    if (currentStudentId !== null && !ids.includes(currentStudentId)) {
      setError('The current student must be included.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave?.({
        memberIds: ids,
      })
    } catch (err) {
      setError(err?.message || 'Failed to save group lesson')
      setSaving(false)
      return
    }
    setSaving(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={() => !saving && onClose?.()} aria-hidden="true" />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Manage Group Members</h3>
            <p className="mt-0.5 text-sm text-gray-600">Saved members are used automatically when booking group lessons.</p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-60"
            disabled={saving}
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
            Pick {expectedSize} students in the booking order for this group.
          </div>

          {loading ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
              Loading students...
            </div>
          ) : (
            <div className="space-y-3">
              {memberIds.map((value, index) => (
                <label key={index} className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Position {index + 1}</span>
                  <div
                    ref={(node) => {
                      pickerRefs.current[index] = node
                    }}
                    className="relative"
                  >
                    <input
                      type="text"
                      value={memberQueries[index] || ''}
                      onChange={(event) => handleMemberQueryChange(index, event.target.value)}
                      onFocus={() => {
                        setActivePickerIndex(index)
                        setHighlightedSuggestionIndex(0)
                      }}
                      onKeyDown={(event) => handlePickerKeyDown(event, index)}
                      disabled={saving}
                      placeholder="Search a student"
                      role="combobox"
                      aria-expanded={activePickerIndex === index}
                      aria-controls={`student-suggestions-${index}`}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                    />
                    {activePickerIndex === index && (
                      <div
                        id={`student-suggestions-${index}`}
                        role="listbox"
                        className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                      >
                        {(suggestionOptionsByIndex[index] || []).length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">No students found</div>
                        ) : (
                          suggestionOptionsByIndex[index].map((option, suggestionIndex) => {
                            const isHighlighted = suggestionIndex === highlightedSuggestionIndex
                            return (
                              <button
                                key={option.ID}
                                type="button"
                                role="option"
                                aria-selected={String(value || '') === String(option.ID)}
                                className={`block w-full px-3 py-2 text-left text-sm ${
                                  isHighlighted ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-100'
                                }`}
                                onMouseDown={(event) => {
                                  event.preventDefault()
                                  handleSuggestionSelect(index, option)
                                }}
                              >
                                {option.Name}
                                {option.ID === currentStudentId ? ' (current student)' : ''}
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save group members'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
