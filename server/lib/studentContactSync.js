/**
 * Server -> GAS student contact sync.
 * Non-blocking helper called after student create/update.
 */

function normalizeSyncResult(data, fallbackError = null) {
  return {
    ok: !!data?.ok,
    actionTaken: data?.actionTaken || null,
    contactId: data?.contactId || null,
    error: data?.error || fallbackError || null,
  };
}

export function isStudentGasSyncEnabled() {
  const url = String(process.env.STUDENT_SYNC_GAS_URL || '').trim();
  const key = String(process.env.STUDENT_SYNC_API_KEY || '').trim();
  return Boolean(url && key);
}

/** Node fetch often throws TypeError("fetch failed") with real reason in err.cause */
function formatFetchError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') {
    return 'Request timed out (GAS did not respond in time; try again or increase STUDENT_SYNC_TIMEOUT_MS)';
  }
  const parts = [];
  const msg = err.message || String(err);
  if (msg && msg !== 'fetch failed') parts.push(msg);
  let c = err.cause;
  let depth = 0;
  while (c && depth < 4) {
    const cm = c.message || c.code || String(c);
    if (cm) parts.push(cm);
    c = c.cause;
    depth += 1;
  }
  if (parts.length === 0) return 'fetch failed';
  return parts.join(' — ');
}

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param {'student_upsert'} action
 * @param {object} student
 * @returns {Promise<{ok:boolean,actionTaken:string|null,contactId:string|null,error:string|null}>}
 */
export async function syncStudentToGas(action, student) {
  const baseUrl = String(process.env.STUDENT_SYNC_GAS_URL || '').trim();
  const apiKey = String(process.env.STUDENT_SYNC_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeSyncResult(null, 'STUDENT_SYNC_GAS_URL or STUDENT_SYNC_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  // GAS doPost can read `e.parameter.key`; this matches the existing polling-key pattern.
  url.searchParams.set('key', apiKey);

  const payload = {
    action,
    studentId: student.id,
    name: student.name || '',
    nameKanji: student.name_kanji || '',
    email: student.email || '',
    phone: student.phone || '',
    phoneSecondary: student.phone_secondary || '',
    groupType: student.group_type || '',
    isChild: !!student.is_child,
    source: 'student-admin-server',
    timestamp: new Date().toISOString(),
  };

  const timeoutMs = Math.min(
    120000,
    Math.max(5000, parseInt(process.env.STUDENT_SYNC_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS)
  );

  const requestOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return normalizeSyncResult(data, `GAS sync failed (${res.status})`);
      }
      return normalizeSyncResult(data);
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[StudentSync] fetch error:', detail, err?.cause || '');
      return normalizeSyncResult(null, detail);
    } finally {
      clearTimeout(timeout);
    }
  };

  // Retry once for transient network/service errors.
  const first = await requestOnce();
  if (first.ok) return first;
  const second = await requestOnce();
  return second.ok ? second : first;
}
