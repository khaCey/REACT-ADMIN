/**
 * Sync students to Google Contacts (People API) using a service account +
 * Workspace domain-wide delegation. Contacts are created in the delegated user's "My contacts".
 *
 * Enable with GOOGLE_CONTACTS_ENABLED=1 and GOOGLE_CONTACTS_DELEGATED_USER=user@yourdomain.com
 * (same service account JSON as Drive/Sheets; Admin must grant scope https://www.googleapis.com/auth/contacts).
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts';

function loadServiceAccountCredentials() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (keyPath) {
    try {
      const resolved = join(__dir, '..', '..', keyPath.replace(/^\.\//, ''));
      return JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (e) {
      console.error('[GoogleContacts] failed to read key file', e.message);
      return null;
    }
  }
  if (keyJson) {
    try {
      const raw = keyJson.startsWith('{') ? keyJson : Buffer.from(keyJson, 'base64').toString('utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('[GoogleContacts] failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', e.message);
      return null;
    }
  }
  return null;
}

export function isGoogleContactsSyncEnabled() {
  const v = process.env.GOOGLE_CONTACTS_ENABLED;
  if (v == null || String(v).trim() === '') return false;
  const t = String(v).toLowerCase().trim();
  return t === '1' || t === 'true' || t === 'yes';
}

function getDelegatedUser() {
  return (process.env.GOOGLE_CONTACTS_DELEGATED_USER || '').trim();
}

/** @returns {ReturnType<typeof google.people>|null} */
export function getPeopleClient() {
  if (!isGoogleContactsSyncEnabled()) return null;
  const credentials = loadServiceAccountCredentials();
  if (!credentials?.client_email || !credentials?.private_key) {
    console.warn('[GoogleContacts] No service account credentials (GOOGLE_SERVICE_ACCOUNT_*).');
    return null;
  }
  const subject = getDelegatedUser();
  if (!subject) {
    console.warn(
      '[GoogleContacts] Set GOOGLE_CONTACTS_DELEGATED_USER to a Workspace user email (domain-wide delegation).'
    );
    return null;
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [CONTACTS_SCOPE],
    subject,
  });
  return google.people({ version: 'v1', auth });
}

function truncate(s, max) {
  if (s == null) return '';
  const t = String(s).trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * @param {{ name?: string, name_kanji?: string, id?: number|string }} row
 */
function buildDisplayName(row) {
  const name = truncate(row.name, 200) || 'Student';
  const kanji = truncate(row.name_kanji, 100);
  if (kanji) return truncate(`${name} (${kanji})`, 300);
  return name;
}

/**
 * @param {{ name?: string, name_kanji?: string, email?: string, phone?: string, phone_secondary?: string, id?: number|string }} row
 */
function buildPersonCreateBody(row) {
  /** @type {Record<string, unknown>} */
  const body = {
    names: [
      {
        displayName: buildDisplayName(row),
        givenName: truncate(row.name, 100) || 'Student',
      },
    ],
    biographies: [
      {
        value: `Student admin ID: ${row.id}${row.name_kanji ? ` · ${row.name_kanji}` : ''}`,
        contentType: 'TEXT_PLAIN',
      },
    ],
  };
  const email = (row.email || '').trim();
  if (email) {
    body.emailAddresses = [{ value: email, type: 'work' }];
  }
  const phones = [];
  const p1 = (row.phone || '').trim();
  const p2 = (row.phone_secondary || '').trim();
  if (p1) phones.push({ value: p1, type: 'mobile' });
  if (p2) phones.push({ value: p2, type: 'work' });
  if (phones.length) body.phoneNumbers = phones;
  return body;
}

/**
 * Create a Google Contact for a student row (DB snake_case).
 * @returns {Promise<{ resourceName: string }|null>}
 */
export async function createStudentGoogleContact(row) {
  const people = getPeopleClient();
  if (!people) return null;
  const requestBody = buildPersonCreateBody({
    id: row.id,
    name: row.name,
    name_kanji: row.name_kanji,
    email: row.email,
    phone: row.phone,
    phone_secondary: row.phone_secondary,
  });
  const { data } = await people.people.createContact({
    requestBody,
    personFields: 'names,emailAddresses,phoneNumbers,metadata',
  });
  const resourceName = data?.resourceName;
  if (!resourceName) return null;
  return { resourceName };
}

/**
 * Update an existing contact by resource name.
 * @returns {Promise<boolean>} true if updated
 */
export async function updateStudentGoogleContact(row, resourceName) {
  const people = getPeopleClient();
  if (!people || !resourceName) return false;
  try {
    const { data: existing } = await people.people.get({
      resourceName,
      personFields: 'names,emailAddresses,phoneNumbers,biographies,metadata',
    });
    if (!existing?.etag) return false;
    const requestBody = {
      etag: existing.etag,
      ...buildPersonCreateBody({
        id: row.id,
        name: row.name,
        name_kanji: row.name_kanji,
        email: row.email,
        phone: row.phone,
        phone_secondary: row.phone_secondary,
      }),
    };
    await people.people.updateContact({
      resourceName,
      updatePersonFields: 'names,emailAddresses,phoneNumbers,biographies',
      requestBody,
    });
    return true;
  } catch (err) {
    if (err?.code === 404) {
      console.warn('[GoogleContacts] Contact missing (404), clear link or recreate:', resourceName);
    } else {
      console.error('[GoogleContacts] update failed', err.message || err);
    }
    return false;
  }
}
