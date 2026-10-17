import { createHmac } from 'node:crypto';

/**
 * Optional one-way sync to Green Square Website Admin.
 * Only active staff IDs and names leave the private work-PC server.
 * Never includes passwords, student details or JWTs.
 */
export async function pushGuideStaffRoster({
  queryFn,
  fetchFn = fetch,
  url,
  secret,
  epochSeconds = Math.floor(Date.now() / 1000),
}) {
  if (typeof queryFn !== 'function') throw new Error('Staff database query is required');
  if (typeof url !== 'string' || typeof secret !== 'string') {
    throw new Error('Staff roster sync URL and secret must be configured');
  }
  const target = new URL(url);
  if (target.protocol !== 'https:' || !target.hostname) {
    throw new Error('Staff roster sync requires an HTTPS website endpoint');
  }
  if (secret.length < 32) {
    throw new Error('Staff roster sync secret must be at least 32 characters');
  }
  if (!Number.isInteger(epochSeconds) || epochSeconds < 1_000_000_000) {
    throw new Error('Invalid sync timestamp');
  }

  const result = await queryFn('SELECT id, name FROM staff WHERE active = TRUE ORDER BY name ASC');
  const rows = result?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
    throw new Error('Active staff list is missing or unexpectedly large');
  }
  const staff = rows.map((record) => {
    const id = Number(record?.id);
    const name = String(record?.name || '').trim();
    if (!Number.isSafeInteger(id) || id < 1 || !name || Buffer.byteLength(name, 'utf8') > 255) {
      throw new Error('Invalid staff record in database');
    }
    return { id, name };
  });
  const body = JSON.stringify({ staff });
  const timestamp = String(epochSeconds);
  const signature = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');

  const response = await fetchFn(target.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GS-Staff-Time': timestamp,
      'X-GS-Staff-Signature': signature,
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response?.ok) {
    throw new Error('Website rejected staff roster: HTTP ' + String(response?.status ?? 'unknown'));
  }
  return { count: staff.length };
}
