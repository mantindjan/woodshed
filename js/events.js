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
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Append one event. Resolves once it's durably written.
export async function addEvent(event) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Append many events in one transaction (backup restore).
export async function addEvents(events) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const e of events) store.add(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Every event, oldest first.
export async function allEvents() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Ask the browser not to evict our storage under disk pressure. Chrome
// decides silently (based on engagement, installed-app status, etc.); it
// may say no, and that's fine.
export function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
}
