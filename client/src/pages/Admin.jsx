import { useState, useEffect, useCallback } from 'react'
import { Shield, Database, Download, RotateCcw } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import BackfillScheduleModal from '../components/BackfillScheduleModal'
import ConfirmActionModal from '../components/ConfirmActionModal'
import { api } from '../api'

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
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            {backupLoading ? 'Creating…' : 'Create backup'}
          </button>
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Backups (last 30 days)</h4>
            {backupsLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : backups.length === 0 ? (
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
    </div>
  )
}
