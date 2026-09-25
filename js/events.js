// The event log: every answer, stored raw in IndexedDB. Stats are derived
// from these and can always be recomputed; see docs/data.md for the format.
//
// IndexedDB rather than localStorage: it's async (a write never stalls the
// game), and its quota is a share of disk rather than ~5 MB.

const DB_NAME = 'woodshed';
const STORE = 'events';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      // v2 adds an index on `t` (answer time) for day-range reads/deletes
      // (A8, A9). Existing events are kept; the index is built from them.
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = e => {
        const db = req.result;
        const store = e.oldVersion < 1
          ? db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
          : req.transaction.objectStore(STORE);
        if (!store.indexNames.contains('t')) store.createIndex('t', 't');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Append one event. Resolves once it's durably written.
export async function addEvent(event) {
  const tx = (await openDb()).transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add(event);
  return done(tx);
}

// Append many events in one transaction (backup restore, sync).
export async function addEvents(events) {
  const tx = (await openDb()).transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const e of events) store.add(e);
  return done(tx);
}

// Events with from ≤ t < to (all of them if no range), oldest answer first.
// Ordered by answer time, not storage order: synced/restored events are
// older answers stored later, and the weak-spot model needs true order.
export async function allEvents(from = -Infinity, to = Infinity) {
  const db = await openDb();
  const range = Number.isFinite(from) || Number.isFinite(to)
    ? IDBKeyRange.bound(Number.isFinite(from) ? from : -Number.MAX_VALUE,
                        Number.isFinite(to) ? to : Number.MAX_VALUE, false, true)
    : undefined;
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).index('t').getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Delete events with from ≤ t < to (the 90-day window prune, A8).
export async function deleteEvents(from, to) {
  const tx = (await openDb()).transaction(STORE, 'readwrite');
  const index = tx.objectStore(STORE).index('t');
  const req = index.openCursor(IDBKeyRange.bound(from, to, false, true));
  req.onsuccess = () => {
    const cursor = req.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };
  return done(tx);
}

// Ask the browser not to evict our storage under disk pressure. Chrome
// decides silently (based on engagement, installed-app status, etc.); it
// may say no, and that's fine.
export function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
}
