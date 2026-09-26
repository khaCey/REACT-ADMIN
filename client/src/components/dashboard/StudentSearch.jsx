import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, UserRound } from 'lucide-react'

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

export default function StudentSearch({ students, loading = false, error = '', onSelectStudent }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef(null)
  const rootRef = useRef(null)

  const results = useMemo(() => {
    const raw = query.trim()
    if (!raw) return []
    const lower = raw.toLowerCase()

    return (students || [])
      .filter((student) => {
        const id = String(student?.ID ?? '')
        const name = String(student?.Name ?? '').toLowerCase()
        const kanji = String(student?.漢字 ?? '')
        return id.includes(raw) || name.includes(lower) || kanji.includes(raw)
      })
      .slice(0, 8)
  }, [query, students])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (event.key === 'Escape') {
        setOpen(false)
        setActiveIndex(-1)
        inputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const selectStudent = (student) => {
    if (student?.ID == null) return
    setOpen(false)
    setActiveIndex(-1)
    setQuery('')
    onSelectStudent?.(student.ID)
  }

  const handleInputKeyDown = (event) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true)
    }

    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, results.length - 1))
      return
    }

    if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
      return
    }

    if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault()
      selectStudent(results[activeIndex])
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <section ref={rootRef} className="relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Student search</h3>
          <p className="mt-0.5 text-xs text-gray-500">Search by student name or ID.</p>
        </div>
        <span className="hidden rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500 sm:inline-flex">
          / to focus
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <label htmlFor="dashboardStudentSearch" className="sr-only">Search students</label>
        <input
          ref={inputRef}
          id="dashboardStudentSearch"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget)) {
              setOpen(false)
              setActiveIndex(-1)
            }
          }}
          placeholder="Search student name or ID"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open && !!query.trim()}
          aria-controls="dashboardStudentSearchResults"
          aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `dashboard-student-result-${results[activeIndex].ID}` : undefined}
          className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute left-4 right-4 top-full z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {loading ? (
            <p className="px-4 py-3 text-sm text-gray-500">Loading students…</p>
          ) : error ? (
            <p className="px-4 py-3 text-sm text-red-600">Student search unavailable: {error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No students found.</p>
          ) : (
            <div
              id="dashboardStudentSearchResults"
              className="max-h-72 overflow-y-auto py-1"
              role="listbox"
              aria-label="Student search results"
            >
              {results.map((student, index) => {
                const active = index === activeIndex
                return (
                  <button
                    id={`dashboard-student-result-${student.ID}`}
                    key={student.ID}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectStudent(student)}
                    className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors focus:outline-none ${active ? 'bg-green-50' : 'hover:bg-green-50'}`}
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-gray-900">{student.Name || 'Unnamed student'}</span>
                        {student.漢字 && (
                          <span className="truncate text-xs text-gray-500">{student.漢字}</span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        ID {student.ID}{student.Status ? ` · ${student.Status}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
