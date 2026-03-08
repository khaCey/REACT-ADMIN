/**
 * Google Drive helper for uploading backup files.
 * Uses GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON.
 * Share the target folder (or Drive root) with the service account email (Editor).
 */
import { google } from 'googleapis';
import { readFileSync, createReadStream, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameHere = dirname(fileURLToPath(import.meta.url));

// drive (not just drive.file) so the service account can write to folders shared with it
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function loadCredentials() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let credentials = null;
  if (keyPath) {
    try {
      const resolved = join(__dirnameHere, '..', '..', keyPath.replace(/^\.\//, ''));
      credentials = JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (e) {
      console.error('[Drive] failed to read key file', e.message);
      return null;
    }
  } else if (keyJson) {
    try {
      const raw = keyJson.startsWith('{') ? keyJson : Buffer.from(keyJson, 'base64').toString('utf8');
      credentials = JSON.parse(raw);
    } catch (e) {
      console.error('[Drive] failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', e.message);
      return null;
    }
  }
  return credentials;
}

export function getDriveAuth() {
  const credentials = loadCredentials();
  if (!credentials) return null;
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [DRIVE_SCOPE],
  });
}

// Backup folder must be in a user's Drive (shared with the service account). Service accounts have no storage quota.

/**
 * Upload a local file to Google Drive backup folder.
 * @param {string} localFilePath - Path to the file on disk
 * @param {string} fileName - Name to use in Drive
 * @returns {Promise<{ fileId: string, webViewLink: string }>}
 */
export async function uploadBackupFile(localFilePath, fileName) {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured: set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON');

  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  if (!folderId || !String(folderId).trim()) {
    throw new Error(
      'Service accounts have no Drive storage. Create a folder in your Google Drive, share it with the service account email (Editor), then set GOOGLE_DRIVE_BACKUP_FOLDER_ID in .env to that folder ID.'
    );
  }

  const drive = google.drive({ version: 'v3', auth });
  const trimmedFolderId = folderId.trim();

  // Verify the folder exists and the service account can see it
  try {
    await drive.files.get({
      fileId: trimmedFolderId,
      fields: 'id, name, driveId',
      supportsAllDrives: true,
    });
  } catch (err) {
    if (err.code === 404 || err.message?.includes('404')) {
      throw new Error(
        'Backup folder not found or not shared with the service account. Open the folder in Drive, click Share, add the service account email (from your JSON key) as Editor, and use this folder\'s ID in GOOGLE_DRIVE_BACKUP_FOLDER_ID.'
      );
    }
    throw err;
  }

  const mimeType = 'application/sql';

  let createRes;
  try {
    createRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [trimmedFolderId],
      },
      media: {
        mimeType,
        body: createReadStream(localFilePath),
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('storage quota') || msg.includes('Shared Drive') || msg.includes('shared drive')) {
      throw new Error(
        'Use a folder in your personal My Drive (not inside a Shared Drive), share it with the service account email as Editor, and set GOOGLE_DRIVE_BACKUP_FOLDER_ID to that folder ID. If you must use a Shared Drive, add the service account as a member of the Shared Drive (Manage members → add SA email as Content manager).'
      );
    }
    throw err;
  }

  const fileId = createRes.data.id;
  let webViewLink = createRes.data.webViewLink;
  if (!webViewLink && fileId) {
    const getRes = await drive.files.get({
      fileId,
      fields: 'webViewLink',
      supportsAllDrives: true,
    });
    webViewLink = getRes.data.webViewLink || null;
  }

  return { fileId, webViewLink: webViewLink || '' };
}

/**
 * Download a backup file from Drive to a local path.
 * @param {string} fileId - Drive file ID
 * @param {string} localFilePath - Path to write the file
 */
export async function downloadBackupFile(fileId, localFilePath) {
  if (!fileId || !String(fileId).trim()) throw new Error('Drive file ID required');
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured');
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get(
    { fileId: String(fileId).trim(), alt: 'media' },
    { responseType: 'stream' }
  );
  const writeStream = createWriteStream(localFilePath);
  await new Promise((resolve, reject) => {
    res.data.pipe(writeStream);
    res.data.on('error', reject);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

/**
 * Delete a file from Drive (e.g. when pruning old backups).
 * @param {string} fileId - Drive file ID
 */
export async function deleteBackupFile(fileId) {
  if (!fileId || !String(fileId).trim()) return;
  const auth = getDriveAuth();
  if (!auth) return;
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.delete({ fileId: String(fileId).trim(), supportsAllDrives: true });
}
