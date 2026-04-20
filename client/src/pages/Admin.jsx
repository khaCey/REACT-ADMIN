import { useState, useEffect, useCallback } from 'react'
import { Shield, Database, Download, RotateCcw, Trash2, Calendar, RefreshCw, Search } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import BackfillScheduleModal from '../components/BackfillScheduleModal'
import ConfirmActionModal from '../components/ConfirmActionModal'
import { api } from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import FullPageLoading from '../components/FullPageLoading'

function formatBackupDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const MONTHLY_SCHEDULE_PAGE_SIZE = 100

function formatMonthlyScheduleDateTime(date, start) {
  const dateStr = date ? String(date).slice(0, 10) : '—'
  if (!start) return `${dateStr} —`
  const d = new Date(start)
  const timeStr = !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—'
  return `${dateStr} ${timeStr}`
}

export default function Admin() {
  const { success } = useToast()
  const [showBackfillModal, setShowBackfillModal] = useState(false)
  const [backups, setBackups] = useState([])
  const [backupsLoading, setBackupsLoading] = useState(true)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [restoreBackupId, setRestoreBackupId] = useState(null)
  const [restoreConfirming, setRestoreConfirming] = useState(false)
  const [tableToClear, setTableToClear] = useState('monthly_schedule')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [clearingTable, setClearingTable] = useState(false)
  const [clearError, setClearError] = useState('')
  const [fetchScheduleLoading, setFetchScheduleLoading] = useState(false)
  const [fetchScheduleError, setFetchScheduleError] = useState('')
  const [fetchJapaneseStaffScheduleLoading, setFetchJapaneseStaffScheduleLoading] = useState(false)
  const [fetchJapaneseStaffScheduleError, setFetchJapaneseStaffScheduleError] = useState('')
  const [staffList, setStaffList] = useState([])
  const [fetchOneStaffId, setFetchOneStaffId] = useState('')
  const [fetchOneLoading, setFetchOneLoading] = useState(false)
  const [fetchOneError, setFetchOneError] = useState('')
  const [testGasLoading, setTestGasLoading] = useState(false)
  const [testGasResult, setTestGasResult] = useState(null)
  const [monthlyRows, setMonthlyRows] = useState([])
  const [monthlyLoading, setMonthlyLoading] = useState(true)
  const [monthlyRefreshing, setMonthlyRefreshing] = useState(false)
  const [monthlyError, setMonthlyError] = useState('')
  const [monthlyStudentId, setMonthlyStudentId] = useState('')
  const [monthlySyncStatus, setMonthlySyncStatus] = useState('')
  const [monthlyLessonStatus, setMonthlyLessonStatus] = useState('')
  const [monthlyQuery, setMonthlyQuery] = useState('')
  const [monthlyOffset, setMonthlyOffset] = useState(0)
  const [monthlyTotal, setMonthlyTotal] = useState(0)
  const [pendingMonthlyDelete, setPendingMonthlyDelete] = useState(null)
  const [deletingMonthlyRow, setDeletingMonthlyRow] = useState(false)

  const clearableTables = [
    { value: 'monthly_schedule', label: 'monthly_schedule' },
    { value: 'payments', label: 'payments' },
    { value: 'notes', label: 'notes' },
    { value: 'lessons', label: 'lessons' },
    { value: 'teacher_schedules', label: 'teacher_schedules' },
    { value: 'teacher_shift_extensions', label: 'teacher_shift_extensions' },
    { value: 'staff_shifts', label: 'staff_shifts' },
    { value: 'notifications', label: 'notifications' },
    { value: 'notification_reads', label: 'notification_reads' },
    { value: 'change_log', label: 'change_log' },
    { value: 'stats', label: 'stats' },
    { value: 'backups', label: 'backups' },
    { value: 'feature_flags', label: 'feature_flags' },
  ]

  const fetchBackups = useCallback(async () => {
    setBackupsLoading(true)
    try {
      const list = await api.getBackups()
      setBackups(Array.isArray(list) ? list : [])
    } catch {
      setBackups([])
    } finally {
      setBackupsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBackups()
  }, [fetchBackups])

  useEffect(() => {
    api.getStaff().then((res) => setStaffList(res.staff || [])).catch(() => setStaffList([]))
  }, [])

  const loadMonthlyRows = useCallback(async (nextOffset = 0, { silent = false } = {}) => {
    if (silent) setMonthlyRefreshing(true)
    else setMonthlyLoading(true)
    setMonthlyError('')
    try {
      const res = await api.getAdminMonthlyScheduleEntries({
        studentId: monthlyStudentId.trim(),
        syncStatus: monthlySyncStatus,
        status: monthlyLessonStatus,
        q: monthlyQuery.trim(),
        limit: MONTHLY_SCHEDULE_PAGE_SIZE,
        offset: nextOffset,
      })
      setMonthlyRows(Array.isArray(res?.items) ? res.items : [])
      setMonthlyTotal(Number(res?.total) || 0)
      setMonthlyOffset(nextOffset)
    } catch (err) {
      setMonthlyError(err.message || 'Failed to load monthly schedule rows')
      if (!silent) {
        setMonthlyRows([])
        setMonthlyTotal(0)
      }
    } finally {
      if (silent) setMonthlyRefreshing(false)
      else setMonthlyLoading(false)
    }
  }, [monthlyStudentId, monthlySyncStatus, monthlyLessonStatus, monthlyQuery])

  useEffect(() => {
    loadMonthlyRows(0)
  }, [loadMonthlyRows])

  const handleCreateBackup = async () => {
    setBackupError('')
    setBackupLoading(true)
    try {
      const res = await api.createBackup()
      success('Backup created')
      await fetchBackups()
    } catch (err) {
      setBackupError(err.message || 'Backup failed')
    } finally {
      setBackupLoading(false)
    }
  }

  const handleRestoreConfirm = async () => {
    if (!restoreBackupId) return
    setRestoreConfirming(true)
    setBackupError('')
    try {
      await api.restoreBackup(restoreBackupId)
      success('Database restored')
      setRestoreBackupId(null)
      await fetchBackups()
    } catch (err) {
      setBackupError(err.message || 'Restore failed')
    } finally {
      setRestoreConfirming(false)
    }
  }

  const handleClearTableConfirm = async () => {
    if (!tableToClear) return
    setClearingTable(true)
    setClearError('')
    try {
      await api.clearTable(tableToClear)
      success(`Cleared table: ${tableToClear}`)
      setClearConfirmOpen(false)
      if (tableToClear === 'backups') await fetchBackups()
    } catch (err) {
      setClearError(err.message || 'Failed to clear table')
    } finally {
      setClearingTable(false)
    }
  }

  const handleMonthlyDeleteConfirm = async () => {
    if (!pendingMonthlyDelete?.event_id || !pendingMonthlyDelete?.student_name) return
    setDeletingMonthlyRow(true)
    try {
      await api.deleteAdminMonthlyScheduleEntry({
        eventId: pendingMonthlyDelete.event_id,
        studentName: pendingMonthlyDelete.student_name,
      })
      success('monthly_schedule row deleted')
      setPendingMonthlyDelete(null)
      const nextOffset =
        monthlyRows.length === 1 && monthlyOffset > 0
          ? Math.max(0, monthlyOffset - MONTHLY_SCHEDULE_PAGE_SIZE)
          : monthlyOffset
      await loadMonthlyRows(nextOffset, { silent: true })
    } catch (err) {
      setMonthlyError(err.message || 'Failed to delete monthly schedule row')
    } finally {
      setDeletingMonthlyRow(false)
    }
  }

  if (backupsLoading) {
    return <FullPageLoading />
  }

  const monthlyPage = Math.floor(monthlyOffset / MONTHLY_SCHEDULE_PAGE_SIZE) + 1
  const monthlyPageCount = Math.max(1, Math.ceil(monthlyTotal / MONTHLY_SCHEDULE_PAGE_SIZE))

  return (
    <div className="w-full flex flex-col h-full min-h-0">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-green-600" />
          Admin
        </h2>
      </div>

      <div className="space-y-8">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Database className="w-5 h-5 text-gray-600" />
            Database backups
          </h3>
          <p className="text-sm text-gray-600 mb-2">
            Create a backup of the database and store it in Google Drive. Backups can be used to restore data if needed.
          </p>
          <p className="text-sm text-gray-500 mb-4">
            A backup runs automatically every day at 12:00 PM (Japan time). Backups older than 30 days are removed.
          </p>
          {backupError && <p className="text-sm text-red-600 mb-2">{backupError}</p>}
          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={backupLoading}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {backupLoading ? <LoadingSpinner size="xs" /> : <Database className="w-4 h-4" />}
            {backupLoading ? 'Creating…' : 'Create backup'}
          </button>
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Backups (last 30 days)</h4>
            {backups.length === 0 ? (
              <p className="text-sm text-gray-500">No backups in the last 30 days. Create one above or wait for the daily run.</p>
            ) : (
              <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
                {backups.map((b) => (
                  <li key={b.id} className="px-4 py-3 bg-white flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{b.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {formatBackupDate(b.created_at)} · {b.source === 'scheduled' ? 'Scheduled' : 'Manual'}
                      </p>
                    </div>
                    {b.drive_file_id ? (
                      <button
                        type="button"
                        onClick={() => setRestoreBackupId(b.id)}
                        className="shrink-0 text-sm text-green-700 hover:text-green-900 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Restore backup
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Download className="w-5 h-5 text-gray-600" />
            Schedule backfill
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Fetch past lessons from Google Calendar or from the MonthlySchedule sheet and sync them to the database. Existing rows are updated (upsert).
          </p>
          <button
            type="button"
            onClick={() => setShowBackfillModal(true)}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Backfill past schedule
          </button>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-gray-600" />
            Fetch Staff Schedule
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Fetch schedules from Google Calendar via GAS into <code className="bg-gray-100 px-1 rounded">teacher_schedules</code>.
            English teachers and Japanese staff use the same GAS and env (<code className="bg-gray-100 px-1 rounded">STAFF_SCHEDULE_GAS_URL</code>); each row needs a calendar ID.
            Replaces shifts for the <strong>current and next calendar month</strong> (Japan time).
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm font-medium text-gray-700">Fetch one staff:</label>
            <select
              value={fetchOneStaffId}
              onChange={(e) => {
                setFetchOneStaffId(e.target.value)
                setFetchOneError('')
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[180px]"
            >
              <option value="">— Select staff —</option>
              {staffList.filter((s) => s.calendar_id).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={async () => {
                const id = fetchOneStaffId ? parseInt(fetchOneStaffId, 10) : null
                if (!id || fetchOneLoading) return
                setFetchOneError('')
                setFetchOneLoading(true)
                try {
                  const res = await api.fetchStaffScheduleForStaff(id)
                  const name = res.teacherName ?? staffList.find((s) => s.id === id)?.name
                  const msg =
                    res.eventsStored != null
                      ? `Fetched ${res.eventsStored} events for ${name}.`
                      : 'Schedule fetched.'
                  success(msg)
                } catch (err) {
                  setFetchOneError(err.message || 'Failed to fetch schedule')
                } finally {
                  setFetchOneLoading(false)
                }
              }}
              disabled={!fetchOneStaffId || fetchOneLoading}
              className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fetchOneLoading ? <LoadingSpinner size="xs" /> : <Calendar className="w-4 h-4" />}
              {fetchOneLoading ? 'Fetching…' : 'Fetch schedule'}
            </button>
            {fetchOneError && <span className="text-sm text-red-600">{fetchOneError}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              type="button"
              onClick={async () => {
                setTestGasResult(null)
                setTestGasLoading(true)
                try {
                  const calendarId = fetchOneStaffId ? staffList.find((s) => String(s.id) === String(fetchOneStaffId))?.calendar_id : null
                  const res = await api.testGas(calendarId || undefined)
                  setTestGasResult(res)
                } catch (err) {
                  setTestGasResult({ error: err.message || 'Test failed' })
                } finally {
                  setTestGasLoading(false)
                }
              }}
              disabled={testGasLoading}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {testGasLoading && <LoadingSpinner size="xs" />}
              {testGasLoading ? 'Testing…' : 'Test GAS'}
            </button>
            <span className="text-xs text-gray-500">Uses selected staff&apos;s calendar ID, or first staff with calendar_id.</span>
          </div>
          {testGasResult && (
            <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm font-mono overflow-x-auto">
              {testGasResult.error ? (
                <p className="text-red-600">{testGasResult.error}</p>
              ) : (
                <>
                  <p><span className="font-semibold">Status:</span> {testGasResult.status} {testGasResult.ok ? '✓' : '✗'}</p>
                  <p><span className="font-semibold">Event count:</span> {testGasResult.eventCount ?? '—'}</p>
                  <p><span className="font-semibold">Message:</span> {testGasResult.message}</p>
                  {testGasResult.responseKeys != null && <p><span className="font-semibold">Response keys:</span> {testGasResult.responseKeys.join(', ') || '—'}</p>}
                  <p className="mt-1 break-all"><span className="font-semibold">URL:</span> {testGasResult.url}</p>
                  {testGasResult.bodyPreview && <pre className="mt-2 text-xs whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{testGasResult.bodyPreview}</pre>}
                </>
              )}
            </div>
          )}
          <p className="text-sm text-gray-500 mb-3">Bulk fetch from Google (current + next month, Japan):</p>
          {fetchScheduleError && <p className="text-sm text-red-600 mb-2">{fetchScheduleError}</p>}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button
              type="button"
              onClick={async () => {
                setFetchScheduleError('')
                setFetchScheduleLoading(true)
                try {
                  const res = await api.fetchStaffSchedule()
                  const msg = res.eventsStored != null
                    ? `English teachers: ${res.staffProcessed ?? 0} staff, ${res.eventsStored} events stored.`
                    : 'Fetch complete.'
                  if (res.errors?.length) {
                    success(`${msg} ${res.errors.length} error(s).`)
                  } else {
                    success(msg)
                  }
                } catch (err) {
                  setFetchScheduleError(err.message || 'Failed to fetch teacher schedules')
                } finally {
                  setFetchScheduleLoading(false)
                }
              }}
              disabled={fetchScheduleLoading}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {fetchScheduleLoading ? <LoadingSpinner size="xs" /> : <Calendar className="w-4 h-4" />}
              {fetchScheduleLoading ? 'Fetching…' : 'Fetch English teachers (all)'}
            </button>
            {fetchJapaneseStaffScheduleError && (
              <span className="text-sm text-red-600">{fetchJapaneseStaffScheduleError}</span>
            )}
            <button
              type="button"
              onClick={async () => {
                setFetchJapaneseStaffScheduleError('')
                setFetchJapaneseStaffScheduleLoading(true)
                try {
                  const res = await api.fetchJapaneseStaffSchedule()
                  const msg = res.eventsStored != null
                    ? `Japanese staff: ${res.staffProcessed ?? 0} staff, ${res.eventsStored} events stored.`
                    : 'Fetch complete.'
                  if (res.errors?.length) {
                    success(`${msg} ${res.errors.length} error(s).`)
                  } else {
                    success(msg)
                  }
                } catch (err) {
                  setFetchJapaneseStaffScheduleError(err.message || 'Failed to fetch Japanese staff schedules')
                } finally {
                  setFetchJapaneseStaffScheduleLoading(false)
                }
              }}
              disabled={fetchJapaneseStaffScheduleLoading}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {fetchJapaneseStaffScheduleLoading ? <LoadingSpinner size="xs" /> : <Calendar className="w-4 h-4" />}
              {fetchJapaneseStaffScheduleLoading ? 'Fetching…' : 'Fetch Japanese staff (all)'}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Database className="w-5 h-5 text-gray-600" />
            Monthly Schedule Entries
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Browse exact <code className="bg-gray-100 px-1 rounded">monthly_schedule</code> rows, filter stuck entries, and delete specific rows when cleanup is needed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
            <input
              value={monthlyStudentId}
              onChange={(e) => setMonthlyStudentId(e.target.value)}
              placeholder="Student ID"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={monthlySyncStatus}
              onChange={(e) => setMonthlySyncStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">All sync statuses</option>
              <option value="synced">synced</option>
              <option value="pending">pending</option>
              <option value="failed">failed</option>
            </select>
            <select
              value={monthlyLessonStatus}
              onChange={(e) => setMonthlyLessonStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">All lesson statuses</option>
              <option value="scheduled">scheduled</option>
              <option value="cancelled">cancelled</option>
              <option value="reserved">reserved</option>
              <option value="rescheduled">rescheduled</option>
              <option value="demo">demo</option>
              <option value="unscheduled">unscheduled</option>
            </select>
            <div className="md:col-span-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  value={monthlyQuery}
                  onChange={(e) => setMonthlyQuery(e.target.value)}
                  placeholder="Search event_id, student_name, title..."
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => loadMonthlyRows(monthlyOffset, { silent: true })}
                disabled={monthlyRefreshing}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {monthlyRefreshing ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-4 h-4" />}
                Refresh
              </button>
            </div>
          </div>
          {monthlyError && <p className="text-sm text-red-600 mb-3">{monthlyError}</p>}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {monthlyLoading ? (
              <div className="p-6 flex items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-gray-700">
                      <th className="px-3 py-2 font-medium">Student</th>
                      <th className="px-3 py-2 font-medium">Event ID</th>
                      <th className="px-3 py-2 font-medium">Date / Time</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Sync</th>
                      <th className="px-3 py-2 font-medium">Title</th>
                      <th className="px-3 py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                          No monthly schedule rows found.
                        </td>
                      </tr>
                    ) : (
                      monthlyRows.map((row) => (
                        <tr key={`${row.event_id}|${row.student_name}`} className="border-t border-gray-100">
                          <td className="px-3 py-2 align-top">
                            <div className="font-medium text-gray-900">{row.student_name || '—'}</div>
                            <div className="text-xs text-gray-500">student_id: {row.student_id ?? 'null'}</div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <code className="text-xs break-all text-gray-700">{row.event_id}</code>
                          </td>
                          <td className="px-3 py-2 align-top text-gray-700">
                            {formatMonthlyScheduleDateTime(row.date, row.start)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span className="inline-flex rounded px-2 py-0.5 text-xs bg-gray-100 text-gray-700">
                              {row.status || '—'}
                            </span>
                            {row.awaiting_reschedule_date ? (
                              <div className="text-[11px] text-amber-700 mt-1">awaiting reschedule date</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex rounded px-2 py-0.5 text-xs ${
                                row.calendar_sync_status === 'failed'
                                  ? 'bg-red-100 text-red-700'
                                  : row.calendar_sync_status === 'pending'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {row.calendar_sync_status || 'synced'}
                            </span>
                            {row.calendar_sync_error ? (
                              <div className="text-[11px] text-red-600 mt-1 max-w-[220px] break-words">
                                {row.calendar_sync_error}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 align-top text-gray-700 max-w-[260px]">
                            <div className="truncate" title={row.title || ''}>{row.title || '—'}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-right">
                            <button
                              type="button"
                              onClick={() => setPendingMonthlyDelete(row)}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete row
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Page {monthlyPage} / {monthlyPageCount} · {monthlyTotal} row(s)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={monthlyOffset === 0 || monthlyRefreshing}
                onClick={() => loadMonthlyRows(Math.max(0, monthlyOffset - MONTHLY_SCHEDULE_PAGE_SIZE), { silent: true })}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm disabled:opacity-50 cursor-pointer"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={monthlyOffset + MONTHLY_SCHEDULE_PAGE_SIZE >= monthlyTotal || monthlyRefreshing}
                onClick={() => loadMonthlyRows(monthlyOffset + MONTHLY_SCHEDULE_PAGE_SIZE, { silent: true })}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm disabled:opacity-50 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
            <Trash2 className="w-5 h-5 text-rose-600" />
            Empty database table
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Permanently remove all rows from a selected table. This cannot be undone unless you restore a backup.
          </p>
          {clearError && <p className="text-sm text-red-600 mb-2">{clearError}</p>}
          <div className="flex items-center gap-2">
            <select
              value={tableToClear}
              onChange={(e) => setTableToClear(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white text-gray-800"
            >
              {clearableTables.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium cursor-pointer flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Empty table
            </button>
          </div>
        </section>
      </div>

      {showBackfillModal && (
        <BackfillScheduleModal onClose={() => setShowBackfillModal(false)} />
      )}
      {restoreBackupId != null && (
        <ConfirmActionModal
          title="Restore database"
          message="This will overwrite the current database with the selected backup. All current data will be replaced. Continue?"
          confirmLabel="Restore"
          destructive
          confirming={restoreConfirming}
          onConfirm={handleRestoreConfirm}
          onClose={() => !restoreConfirming && setRestoreBackupId(null)}
        />
      )}
      {clearConfirmOpen && (
        <ConfirmActionModal
          title="Empty table"
          message={`This will permanently remove all rows from "${tableToClear}" and reset identity values. This action cannot be undone without restore. Continue?`}
          confirmLabel="Empty table"
          destructive
          confirming={clearingTable}
          onConfirm={handleClearTableConfirm}
          onClose={() => !clearingTable && setClearConfirmOpen(false)}
        />
      )}
      {pendingMonthlyDelete && (
        <ConfirmActionModal
          title="Delete monthly_schedule row"
          message={`Delete this exact row?\n\nstudent_name: ${pendingMonthlyDelete.student_name}\nevent_id: ${pendingMonthlyDelete.event_id}\n\nUse this only for admin cleanup of stuck entries.`}
          confirmLabel="Delete row"
          destructive
          confirming={deletingMonthlyRow}
          onConfirm={handleMonthlyDeleteConfirm}
          onClose={() => !deletingMonthlyRow && setPendingMonthlyDelete(null)}
        />
      )}
    </div>
  )
}
