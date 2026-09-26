import { clearStoredSession, getStoredToken } from '../utils/authSession';

async function request(path, options = {}) {
  const token = getStoredToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/payments${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    if (response.status === 401) clearStoredSession();
    throw new Error(payload.error || response.statusText);
  }
  return response.json();
}

export function previewPaymentMigration(month) {
  const params = new URLSearchParams({ month: String(month || '') });
  return request(`/booking-migration/preview?${params.toString()}`);
}

export function migratePaymentMonth(month) {
  return request('/booking-migration', {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
}
