import { clearStoredSession, getStoredToken } from '../utils/authSession';

export async function sendStudentLineLinkEmail(studentId) {
  const token = getStoredToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(
    `/api/config/student-line-email/${encodeURIComponent(studentId)}`,
    {
      method: 'POST',
      headers,
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearStoredSession();
    const error = new Error(payload.error || response.statusText || 'メールを送信できませんでした。');
    error.code = payload.code || null;
    throw error;
  }

  return payload;
}
