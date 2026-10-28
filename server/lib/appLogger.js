import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const context = new AsyncLocalStorage();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fallback = console.error.bind(console);
const sensitive = /password|secret|token|authorization|cookie|credential|private.?key|api.?key|database.?url/i;
export function redact(value, seen = new WeakSet(), depth = 0) {
  if (depth > 8) return '[depth limit]';
  if (typeof value === 'string') {
    let text = value.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?[redacted]')
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]');
    for (const [key, secret] of Object.entries(process.env)) {
      if (sensitive.test(key) && secret.length >= 8) text = text.split(secret).join('[redacted]');
    }
    return text.length > 6000 ? text.slice(0, 6000) + '[truncated]' : text;
  }
  if (!value || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return redact({ name: value.name, message: value.message, stack: value.stack,
    code: value.code, table: value.table, column: value.column, constraint: value.constraint, cause: value.cause }, seen, depth + 1);
  if (Array.isArray(value)) return value.slice(0, 100).map(v => redact(v, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sensitive.test(k) ? '[redacted]' : redact(v, seen, depth + 1)]));
}
export function createFileLogger({ directory, maxBytes = 10 * 1024 * 1024, backups = 5 } = {}) {
  const dir = directory || process.env.APP_LOG_DIR || join(root, 'logs');
  const file = join(dir, 'app.jsonl');
  return function write(level, event, details = {}) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const line = JSON.stringify(redact({ timestamp: new Date().toISOString(), level, event,
        pid: process.pid, ...context.getStore(), details })) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > maxBytes) {
        if (existsSync(file + '.' + backups)) unlinkSync(file + '.' + backups);
        for (let n = backups - 1; n >= 1; n--) if (existsSync(file + '.' + n)) renameSync(file + '.' + n, file + '.' + (n + 1));
        renameSync(file, file + '.1');
      }
      appendFileSync(file, line, { mode: 0o600 });
    } catch (error) { fallback('[app-log] Unable to write log:', error.code || error.name); }
  };
}
export const logEvent = createFileLogger();
let installed = false;
export function installAppLogging() {
  if (installed) return;
  installed = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => { logEvent(method === 'log' ? 'info' : method, 'console', { args }); original(...args); };
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const id = randomUUID(); const started = Date.now();
    let host = 'unknown'; let action; let eventId; let title;
    try { host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname; } catch {}
    try { const body = JSON.parse(init?.body || '{}'); action = body.action; eventId = body.eventId; title = body.title; } catch {}
    const fields = { id, host, method: init?.method || 'GET', action, eventId, title };
    logEvent('info', 'outbound.started', fields);
    try {
      const response = await originalFetch(input, init);
      logEvent(response.ok ? 'info' : 'error', 'outbound.completed', { ...fields, status: response.status, durationMs: Date.now() - started });
      return response;
    } catch (error) { logEvent('error', 'outbound.failed', { ...fields, durationMs: Date.now() - started, error }); throw error; }
  };
  logEvent('info', 'app.started', { node: process.version, directory: dirForDisplay() });
}
function dirForDisplay() { return process.env.APP_LOG_DIR || join(root, 'logs'); }
export function requestLogging(req, res, next) {
  const requestId = randomUUID(); const started = Date.now();
  res.setHeader('X-Request-ID', requestId);
  context.run({ requestId }, () => {
    logEvent('info', 'request.started', { method: req.method, path: req.path });
    res.on('finish', () => logEvent(res.statusCode >= 400 ? 'error' : 'info', 'request.completed', {
      requestId, method: req.method, path: req.path, status: res.statusCode,
      staffId: req.staff?.id, durationMs: Date.now() - started,
    }));
    next();
  });
}
