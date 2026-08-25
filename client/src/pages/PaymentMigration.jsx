import { useMemo, useState } from 'react';
import { CreditCard, RefreshCw, UploadCloud } from 'lucide-react';
import { migratePaymentMonth, previewPaymentMigration } from '../api/paymentMigration';
import LoadingSpinner from '../components/LoadingSpinner';
import { useToast } from '../context/ToastContext';

function formatNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : String(value || '0');
}

export default function PaymentMigration() {
  const { success } = useToast();
  const [month, setMonth] = useState('2026-09');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState('');

  const previewMatchesMonth = preview?.month === month;
  const canMigrate = previewMatchesMonth && !migrating && !loadingPreview;
  const students = useMemo(() => (Array.isArray(preview?.students) ? preview.students : []), [preview]);

  const handleMonthChange = (event) => {
    setMonth(event.target.value);
    setPreview(null);
    setResult(null);
    setError('');
  };

  const handlePreview = async () => {
    setLoadingPreview(true);
    setError('');
    setResult(null);
    try {
      const data = await previewPaymentMigration(month);
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setError(err.message || 'Could not preview payment migration.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleMigrate = async () => {
    if (!canMigrate) return;
    setMigrating(true);
    setError('');
    try {
      const data = await migratePaymentMonth(month);
      setResult(data);
      success(`Payment migration complete for ${month}`);
      const refreshed = await previewPaymentMigration(month);
      setPreview(refreshed);
    } catch (err) {
      setResult(null);
      setError(err.message || 'Payment migration failed.');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto py-4 space-y-6">
      <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
        <CreditCard className="w-6 h-6 text-green-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Migration</h1>
          <p className="text-sm text-gray-500">
            Copy monthly payment status from React Admin into the Booking API spreadsheet.
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Closed beta payment mirror</h2>
          <p className="mt-1 text-sm text-gray-600">
            Preview the month first. Migration is idempotent: existing student/payment rows are updated, and missing students are created automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Billing month</span>
            <input
              type="month"
              value={month}
              onChange={handleMonthChange}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
            />
          </label>

          <button
            type="button"
            onClick={handlePreview}
            disabled={loadingPreview || migrating || !month}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingPreview ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-4 h-4" />}
            {loadingPreview ? 'Loading…' : 'Preview'}
          </button>

          <button
            type="button"
            onClick={handleMigrate}
            disabled={!canMigrate}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {migrating ? <LoadingSpinner size="xs" /> : <UploadCloud className="w-4 h-4" />}
            {migrating ? 'Migrating…' : 'Migrate to Booking API'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {previewMatchesMonth && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Month</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{preview.month}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Payment rows</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{preview.sourcePaymentRows}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Students</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{preview.uniqueStudents}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Destination</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">Booking API</div>
            </div>
          </div>
        )}
      </section>

      {result && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-5">
          <h2 className="font-semibold text-green-900">Migration result</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div><span className="text-green-700">Students created:</span> <strong>{result.studentsCreated ?? 0}</strong></div>
            <div><span className="text-green-700">Students already existed:</span> <strong>{result.studentsExisting ?? 0}</strong></div>
            <div><span className="text-green-700">Payments created:</span> <strong>{result.paymentRowsCreated ?? 0}</strong></div>
            <div><span className="text-green-700">Payments updated:</span> <strong>{result.paymentRowsUpdated ?? 0}</strong></div>
          </div>
        </section>
      )}

      {previewMatchesMonth && (
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Students with payment records</h2>
            <p className="text-sm text-gray-500 mt-1">
              Only students with a payment record for {month} are marked paid. Absence of a row remains unpaid.
            </p>
          </div>
          {students.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-500">No payment records found for this month.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3">Student ID</th>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Payments</th>
                    <th className="px-5 py-3">Total</th>
                    <th className="px-5 py-3">Paid date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {students.map((student) => (
                    <tr key={student.studentId}>
                      <td className="px-5 py-3 font-medium text-gray-900">{student.studentId}</td>
                      <td className="px-5 py-3 text-gray-700">{student.studentName || '—'}</td>
                      <td className="px-5 py-3 text-gray-700">{student.paymentCount}</td>
                      <td className="px-5 py-3 text-gray-700">¥{formatNumber(student.total)}</td>
                      <td className="px-5 py-3 text-gray-700">{student.paidAt ? String(student.paidAt).slice(0, 10) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
