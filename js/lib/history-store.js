// Local scan history backed by IndexedDB. Records stay in the browser; nothing
// leaves the device. A localStorage flag toggles whether new scans are saved.

const DB_NAME = 'qr-scanner-db';
const DB_VERSION = 1;
const STORE = 'scans';
const SETTINGS_KEY = 'qr-scanner:history-enabled';
const DEDUPE_WINDOW_MS = 5000; // skip identical content re-scanned within 5s
// Oldest records beyond this cap are deleted after each add/import. IndexedDB
// is not a growth archive — an unbounded store eventually throttles or gets
// evicted wholesale by the browser, so we keep a bounded, predictable size.
const MAX_SCANS = 500;

let dbPromise = null;

function isIndexedDBAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDB() {
  if (!isIndexedDBAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_createdAt', 'createdAt');
        store.createIndex('by_type', 'type');
        store.createIndex('by_content', 'content', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
  return dbPromise;
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ────────────────────────────── Settings ──────────────────────────────

export function isHistoryEnabled() {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setHistoryEnabled(enabled) {
  try {
    localStorage.setItem(SETTINGS_KEY, enabled ? 'true' : 'false');
  } catch {
    /* storage unavailable (private mode) — operate in-memory default */
  }
}

// ────────────────────────────── CRUD ──────────────────────────────

/**
 * Add a scan, deduping identical content scanned within DEDUPE_WINDOW_MS.
 * Honors the enabled setting — returns null without writing when disabled.
 * @returns {Promise<(object|null)>} the stored record, or null if deduped/disabled/skipped.
 */
export async function addScan({ content, type, label }) {
  if (!content) return null;
  if (!isHistoryEnabled()) return null;
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);
  // Compare against the NEWEST matching record. IDBIndex.get() returns the
  // match with the smallest primary key (the oldest), which would let the
  // dedupe window permanently expire once the first scan aged out — causing
  // every subsequent identical scan to be stored again.
  const existing = await findNewestByContent(store, content);
  if (existing && Date.now() - existing.createdAt < DEDUPE_WINDOW_MS) {
    await txDone(t);
    return null;
  }
  const record = {
    content,
    type: type || 'text',
    label: label || '',
    createdAt: Date.now(),
  };
  const id = await promisifyRequest(store.add(record));
  record.id = id;
  await txDone(t);
  pruneOldScans(db).catch(() => {}); // async housekeeping — never blocks the scan
  return record;
}

/**
 * Keep at most MAX_SCANS records: delete oldest-first beyond the cap, in a
 * single transaction. Fire-and-forget from addScan/import — failures are
 * non-fatal and just mean the cap is exceeded until the next write.
 */
async function pruneOldScans(db) {
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);
  const req = store.index('by_createdAt').openCursor(null, 'prev');
  let seen = 0;
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    seen += 1;
    if (seen > MAX_SCANS) cursor.delete();
    cursor.continue();
  };
  await txDone(t);
}

// Returns the most recently inserted record for `content` (highest primary
// key among matches), or null. Uses a reverse cursor since IDBIndex.get()
// would return the oldest match instead.
function findNewestByContent(store, content) {
  return new Promise((resolve, reject) => {
    const req = store.index('by_content').openCursor(IDBKeyRange.only(content), 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? cursor.value : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** All scans, newest first. */
export async function getAllScans() {
  if (!isIndexedDBAvailable()) return [];
  const db = await openDB();
  const t = db.transaction(STORE, 'readonly');
  const req = t.objectStore(STORE).index('by_createdAt').openCursor(null, 'prev');
  const items = [];
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        items.push(cursor.value);
        cursor.continue();
      }
    };
    t.oncomplete = () => resolve(items);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * Client-side filter (history is small enough; lets us combine search + type
 * without multiple index queries).
 */
export async function queryScans({ search = '', type = 'all' } = {}) {
  const items = await getAllScans();
  const q = search.trim().toLowerCase();
  return items.filter((it) => {
    if (type !== 'all' && it.type !== type) return false;
    if (q && !it.content.toLowerCase().includes(q)) return false;
    return true;
  });
}

export async function getScan(id) {
  const db = await openDB();
  return promisifyRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
}

export async function removeScan(id) {
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  await promisifyRequest(t.objectStore(STORE).delete(id));
  await txDone(t);
}

export async function clearAllScans() {
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  await promisifyRequest(t.objectStore(STORE).clear());
  await txDone(t);
}

export async function countScans() {
  if (!isIndexedDBAvailable()) return 0;
  const db = await openDB();
  return promisifyRequest(db.transaction(STORE, 'readonly').objectStore(STORE).count());
}

export async function exportScans() {
  const items = await getAllScans();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'qr-scanner-pwa',
      count: items.length,
      scans: items,
    },
    null,
    2,
  );
}

// ────────────────────────────── CSV export / import ──────────────────────────────

/**
 * CSV of all scans, newest first. Layout matches the JSON export's essential
 * fields so the two files carry the same information (minus per-record `id`).
 * RFC 4180 quoting: double quotes doubled, field wrapped only when needed.
 */
export async function exportScansCsv() {
  const items = await getAllScans();
  const header = 'content,type,label,scannedAt';
  const rows = items.map((it) =>
    [it.content, it.type || 'text', it.label || '', new Date(it.createdAt).toISOString()]
      .map(csvField)
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

function csvField(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Merge scans from a JSON export (our own format). Skips records that are
 * invalid or duplicate an existing content+createdAt pair — re-importing the
 * same file is therefore a no-op. Returns the number of rows added.
 */
export async function importScans(json) {
  const scans = json && Array.isArray(json.scans) ? json.scans : [];
  if (!scans.length) return 0;
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);

  // Index existing content+createdAt pairs so we can dedupe without a
  // per-record cursor lookup.
  const existing = new Set();
  const req = store.index('by_createdAt').openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    existing.add(`${cursor.value.content}\u0000${cursor.value.createdAt}`);
    cursor.continue();
  };
  await txDone(t);

  let added = 0;
  const t2 = db.transaction(STORE, 'readwrite');
  const store2 = t2.objectStore(STORE);
  for (const s of scans) {
    // Validate shape: content is the only field we can't survive without.
    if (!s || typeof s.content !== 'string' || !s.content) continue;
    const ts = Number(s.createdAt ?? s.scannedAt);
    const record = {
      content: s.content,
      type: typeof s.type === 'string' && s.type ? s.type : 'text',
      label: typeof s.label === 'string' ? s.label : '',
      // Fall back to now for exports missing a timestamp.
      createdAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    };
    const key = `${record.content}\u0000${record.createdAt}`;
    if (existing.has(key)) continue;
    existing.add(key);
    store2.add(record);
    added += 1;
  }
  await txDone(t2);
  pruneOldScans(db).catch(() => {});
  return added;
}
