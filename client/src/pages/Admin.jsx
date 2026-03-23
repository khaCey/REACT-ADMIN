import { useState, useEffect, useCallback } from 'react'
import { Shield, Database, Download, RotateCcw, Trash2, Calendar } from 'lucide-react'
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
  const [staffList, setStaffList] = useState([])
  const [fetchOneStaffId, setFetchOneStaffId] = useState('')
  const [fetchOneLoading, setFetchOneLoading] = useState(false)
  const [fetchOneError, setFetchOneError] = useState('')
  const [testGasLoading, setTestGasLoading] = useState(false)
  const [testGasResult, setTestGasResult] = useState(null)

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

  if (backupsLoading) {
    return <FullPageLoading />
  }

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
            Fetch English teachers&apos; schedules from their Google Calendars via GAS and save to the database. Uses each staff&apos;s calendar ID; replaces their shifts for the <strong>current and next calendar month</strong> (Japan time). Set <code className="bg-gray-100 px-1 rounded">STAFF_SCHEDULE_GAS_URL</code> in .env to the GAS that returns teacher calendar events (not the student-schedule GAS).
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
          <p className="text-sm text-gray-500 mb-3">Or fetch all English teachers at once:</p>
          {fetchScheduleError && <p className="text-sm text-red-600 mb-2">{fetchScheduleError}</p>}
          <button
            type="button"
            onClick={async () => {
              setFetchScheduleError('')
              setFetchScheduleLoading(true)
              try {
                const res = await api.fetchStaffSchedule()
                const msg = res.eventsStored != null
                  ? `Fetched for ${res.staffProcessed ?? 0} staff, ${res.eventsStored} events stored.`
                  : 'Fetch complete.'
                if (res.errors?.length) {
                  success(`${msg} ${res.errors.length} error(s).`)
                } else {
                  success(msg)
                }
              } catch (err) {
                setFetchScheduleError(err.message || 'Failed to fetch staff schedule')
              } finally {
                setFetchScheduleLoading(false)
              }
            }}
            disabled={fetchScheduleLoading}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {fetchScheduleLoading ? <LoadingSpinner size="xs" /> : <Calendar className="w-4 h-4" />}
            {fetchScheduleLoading ? 'Fetching…' : 'Fetch Staff Schedule (all)'}
          </button>
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
    </div>
  )
}
