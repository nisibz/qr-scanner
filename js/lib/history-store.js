// Local scan history backed by IndexedDB. Records stay in the browser; nothing
// leaves the device. A localStorage flag toggles whether new scans are saved.

const DB_NAME = 'qr-scanner-db';
const DB_VERSION = 1;
const STORE = 'scans';
const SETTINGS_KEY = 'qr-scanner:history-enabled';
const DEDUPE_WINDOW_MS = 5000; // skip identical content re-scanned within 5s

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
  const existing = await promisifyRequest(store.index('by_content').get(content));
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
  return record;
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
