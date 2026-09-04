// Local scan history backed by IndexedDB. Records stay in the browser; nothing
// leaves the device. A localStorage flag toggles whether new scans are saved.

export interface ScanRecord {
  id?: number;
  content: string;
  type: string;
  label: string;
  /** Human title captured at scan time (page <title> for URLs). */
  title?: string;
  createdAt: number;
}

const DB_NAME = 'qr-scanner-db';
const DB_VERSION = 1;
const STORE = 'scans';
const SETTINGS_KEY = 'qr-scanner:history-enabled';
const DEDUPE_WINDOW_MS = 5000; // skip identical content re-scanned within 5s
// Oldest records beyond this cap are deleted after each add/import. IndexedDB
// is not a growth archive — an unbounded store eventually throttles or gets
// evicted wholesale by the browser, so we keep a bounded, predictable size.
const MAX_SCANS = 500;

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  if (!isIndexedDBAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
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
  }
  return dbPromise;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ────────────────────────────── Settings ──────────────────────────────

export function isHistoryEnabled(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setHistoryEnabled(enabled: boolean): void {
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
 */
export async function addScan(scan: {
  content: string;
  type: string;
  label: string;
  title?: string;
}): Promise<ScanRecord | null> {
  const { content, type, label, title } = scan;
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
  const record: ScanRecord = {
    content,
    type: type || 'text',
    label: label || '',
    createdAt: Date.now(),
    ...(title ? { title } : {}),
  };
  const id = await promisifyRequest(store.add(record));
  record.id = id as number;
  await txDone(t);
  void pruneOldScans(db).catch(() => {}); // async housekeeping — never blocks the scan
  return record;
}

/**
 * Keep at most MAX_SCANS records: delete oldest-first beyond the cap, in a
 * single transaction. Fire-and-forget from addScan/import — failures are
 * non-fatal and just mean the cap is exceeded until the next write.
 */
async function pruneOldScans(db: IDBDatabase): Promise<void> {
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
function findNewestByContent(store: IDBObjectStore, content: string): Promise<ScanRecord | null> {
  return new Promise((resolve, reject) => {
    const req = store.index('by_content').openCursor(IDBKeyRange.only(content), 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as ScanRecord) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** All scans, newest first. */
export async function getAllScans(): Promise<ScanRecord[]> {
  if (!isIndexedDBAvailable()) return [];
  const db = await openDB();
  const t = db.transaction(STORE, 'readonly');
  const req = t.objectStore(STORE).index('by_createdAt').openCursor(null, 'prev');
  const items: ScanRecord[] = [];
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        items.push(cursor.value as ScanRecord);
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
export async function queryScans({ search = '', type = 'all' }: { search?: string; type?: string } = {}): Promise<ScanRecord[]> {
  const items = await getAllScans();
  const q = search.trim().toLowerCase();
  return items.filter((it) => {
    if (type !== 'all' && it.type !== type) return false;
    if (q && !it.content.toLowerCase().includes(q)) return false;
    return true;
  });
}

export async function getScan(id: number): Promise<ScanRecord | undefined> {
  const db = await openDB();
  return promisifyRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
}

export async function removeScan(id: number): Promise<void> {
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  await promisifyRequest(t.objectStore(STORE).delete(id));
  await txDone(t);
}

export async function clearAllScans(): Promise<void> {
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  await promisifyRequest(t.objectStore(STORE).clear());
  await txDone(t);
}

export async function countScans(): Promise<number> {
  if (!isIndexedDBAvailable()) return 0;
  const db = await openDB();
  return promisifyRequest(db.transaction(STORE, 'readonly').objectStore(STORE).count());
}

/**
 * Patch the human title of the newest record matching `content` (used for
 * URLs whose page <title> arrives after the scan was saved). No-op when no
 * matching record exists. Returns whether a row was updated.
 */
export async function updateTitle(content: string, title: string): Promise<boolean> {
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);
  const existing = await findNewestByContent(store, content);
  if (!existing) {
    await txDone(t);
    return false;
  }
  existing.title = title;
  store.put(existing);
  await txDone(t);
  return true;
}

export async function exportScans(): Promise<string> {
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
export async function exportScansCsv(): Promise<string> {
  const items = await getAllScans();
  const header = 'content,type,label,scannedAt';
  const rows = items.map((it) =>
    [it.content, it.type || 'text', it.label || '', new Date(it.createdAt).toISOString()]
      .map(csvField)
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

function csvField(value: unknown): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Merge scans from a JSON export (our own format). Skips records that are
 * invalid or duplicate an existing content+createdAt pair — re-importing the
 * same file is therefore a no-op. Returns the number of rows added.
 */
export async function importScans(json: unknown): Promise<number> {
  const scans =
    json && typeof json === 'object' && Array.isArray((json as { scans?: unknown[] }).scans)
      ? ((json as { scans: unknown[] }).scans as Array<Record<string, unknown>>)
      : [];
  if (!scans.length) return 0;
  const db = await openDB();
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);

  // Index existing content+createdAt pairs so we can dedupe without a
  // per-record cursor lookup.
  const existing = new Set<string>();
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
    const rec = normalizeImported(s, Date.now());
    if (!rec) continue;
    const key = `${rec.content}\u0000${rec.createdAt}`;
    if (existing.has(key)) continue;
    existing.add(key);
    store2.add(rec);
    added += 1;
  }
  await txDone(t2);
  void pruneOldScans(db).catch(() => {});
  return added;
}

function normalizeImported(s: unknown, fallbackNow: number): ScanRecord | null {
  if (!s || typeof s !== 'object') return null;
  const raw = s as Record<string, unknown>;
  const content = raw.content;
  if (typeof content !== 'string' || !content) return null;
  const ts = Number(raw.createdAt ?? raw.scannedAt);
  return {
    content,
    type: typeof raw.type === 'string' && raw.type ? raw.type : 'text',
    label: typeof raw.label === 'string' ? raw.label : '',
    ...(typeof raw.title === 'string' && raw.title ? { title: raw.title } : {}),
    createdAt: Number.isFinite(ts) && ts > 0 ? ts : fallbackNow,
  };
}
