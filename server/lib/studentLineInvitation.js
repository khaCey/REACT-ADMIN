const DEFAULT_TIMEOUT_MS = 30000;

export function getStudentLineLinkApiUrl() {
  return String(process.env.LINE_LINK_API_URL || '').trim();
}

export function isStudentLineLinkApiConfigured() {
  return /^https:\/\//i.test(getStudentLineLinkApiUrl());
}

function getTimeoutMs() {
  const raw = Number(process.env.LINE_LINK_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(raw), 1000), 120000);
}

/**
 * Ask the bound Google Apps Script API to create a single-use, 24-hour
 * invitation for a student. No API key is sent in this first implementation.
 *
 * @param {number|string} studentNumber
 * @param {number|string|null|undefined} staffId
 * @param {typeof fetch} fetchImpl Allows unit tests to supply a fake fetch.
 */
export async function createStudentLineLinkInvitation(
  studentNumber,
  staffId = '',
  fetchImpl = fetch
) {
  const url = getStudentLineLinkApiUrl();
  if (!/^https:\/\//i.test(url)) {
    const err = new Error('LINE_LINK_API_URL is not configured');
    err.code = 'LINE_LINK_API_NOT_CONFIGURED';
    throw err;
  }

  const student = String(studentNumber ?? '').trim();
  if (!/^\d+$/.test(student)) {
    const err = new Error('Invalid student number');
    err.code = 'INVALID_STUDENT_NUMBER';
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'line_link_create',
        studentNumber: student,
        createdByStaffId: String(staffId ?? '').trim(),
      }),
      signal: controller.signal,
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      const err = new Error('LINE linking API returned invalid JSON');
      err.code = 'LINE_LINK_API_INVALID_RESPONSE';
      throw err;
    }

    // Apps Script web apps commonly return HTTP 200 even for application-level
    // errors, so payload.ok is the source of truth here.
    if (!response.ok || !payload?.ok) {
      const err = new Error(payload?.error || 'LINE linking API could not create an invitation');
      err.code = payload?.code || 'LINE_LINK_CREATE_FAILED';
      throw err;
    }

    const link = String(payload.link || '').trim();
    if (!/^https:\/\//i.test(link)) {
      const err = new Error('LINE linking API did not return a valid HTTPS link');
      err.code = 'LINE_LINK_API_INVALID_RESPONSE';
      throw err;
    }

    return {
      ok: true,
      invitationId: payload.invitationId || null,
      studentNumber: payload.studentNumber || student,
      link,
      expiresAt: payload.expiresAt || null,
      expiresInHours: Number(payload.expiresInHours) || 24,
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error('LINE linking API request timed out');
      timeoutErr.code = 'LINE_LINK_API_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
