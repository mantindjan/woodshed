// GitHub sync (A9): automatic, nothing to tap. Each game's events go to a
// private repo as one readable JSON file per UTC day — `degrees/2026-09-25.json`,
// one event per line. See docs/data.md ("Architecture at scale").
//
// A sync:
//  1. lists the repo (one request);
//  2. PULLS files that changed on GitHub since this device last saw them,
//     within the 90-day window, merging add-only (same event = same t +
//     round, as for the backup file);
//  3. PUSHES files where this device has events GitHub hasn't (today's,
//     usually), retrying once after a merge if GitHub says the file changed
//     underneath (another device);
//  4. syncs settings.json (never the token); a fresh install restores it;
//  5. PRUNES local days older than 90 days that are confirmed on GitHub (A8).
//
// Days are UTC dates so a change of time zone never re-files or splits a
// day. The repo address and token live only in this phone's localStorage
// (entered in ⚙), never in the public code.

import { allEvents, addEvents, deleteEvents } from './events.js';
import { invalidateSummary } from './summary.js';

const REPO_KEY = 'woodshed.syncRepo';
const TOKEN_KEY = 'woodshed.syncToken';
const STATE_KEY = 'woodshed.syncState';
// Settings that travel in settings.json: everything but the sync credentials.
const SETTINGS = ['woodshed.calib', 'woodshed.mode', 'woodshed.pick', 'woodshed.length',
                  'woodshed.exercise', 'woodshed.custom',
                  'woodshed.calibOffset', 'woodshed.game', 'woodshed.tempoAuto', 'woodshed.latency', 'woodshed.scaleExercise',
                  'woodshed.scaleCustom', 'woodshed.bpm', 'woodshed.misses'];
const SETTINGS_PATH = 'settings.json';
export const WINDOW_DAYS = 90;
const DAY_MS = 86400000;

// --- Days (UTC) and paths ---
export const utcDay = t => new Date(t).toISOString().slice(0, 10);
const dayStart = day => Date.parse(`${day}T00:00:00Z`);
const pathOf = e => `${e.game}/${utcDay(e.t)}.json`;
const FILE_RE = /^([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\.json$/;
const keyOf = e => `${e.t}|${e.round}`;
const stripId = ({ id, ...rest }) => rest;

// One event per line: readable, and diffs per answer in git.
function fileText(events) {
  const sorted = [...events].sort((a, b) => a.t - b.t).map(stripId);
  return `[\n${sorted.map(e => JSON.stringify(e)).join(',\n')}\n]\n`;
}

// --- Config and state (localStorage) ---
function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { return null; }
  return null;
}
export const syncConfig = () => ({ repo: ls(REPO_KEY) || '', token: ls(TOKEN_KEY) || '' });
export function setSyncConfig(repo, token) {
  // A different repo: start the bookkeeping over. Same repo (e.g. a
  // renewed token): keep it, so nothing is re-uploaded for no reason.
  if (repo.trim() !== syncConfig().repo) ls(STATE_KEY, null);
  ls(REPO_KEY, repo.trim() || null);
  ls(TOKEN_KEY, token.trim() || null);
}
const isConfigured = () => { const c = syncConfig(); return !!(c.repo && c.token); };
function loadState() {
  try { return JSON.parse(ls(STATE_KEY)) || { files: {} }; } catch { return { files: {} }; }
}
const saveState = st => ls(STATE_KEY, JSON.stringify(st));
export const syncState = loadState;

// --- GitHub REST API ---
class SyncError extends Error {}

const b64encode = text => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));

async function gh(method, path, body) {
  const { repo, token } = syncConfig();
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('Offline — will sync next time.');
  }
  if (res.status === 401) throw new SyncError('Token rejected — make a new one on GitHub and paste it here.');
  if (res.status === 403) throw new SyncError('Token can’t use that repo — it needs Contents: read and write.');
  if (res.status === 404 && path === '') throw new SyncError('Repo not found — check the name, and that the token covers it.');
  return res;
}

// path → blob sha for every file in the repo (empty repo → empty map).
async function listRemote() {
  const info = await gh('GET', '');
  if (!info.ok) throw new SyncError(`GitHub error ${info.status}.`);
  const { default_branch: branch } = await info.json();
  const res = await gh('GET', `/git/trees/${branch}?recursive=1`);
  if (res.status === 409 || res.status === 404) return new Map();   // empty repo
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}.`);
  const { tree } = await res.json();
  return new Map(tree.filter(x => x.type === 'blob').map(x => [x.path, x.sha]));
}

async function readFile(path) {
  const res = await gh('GET', `/contents/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}.`);
  const json = await res.json();
  return { sha: json.sha, text: b64decode(json.content) };
}

// Write a file; returns its new sha, or null if GitHub says it changed
// underneath (someone else wrote it since `sha`).
async function writeFile(path, text, sha, message) {
  const res = await gh('PUT', `/contents/${path}`, { message, content: b64encode(text), ...(sha ? { sha } : {}) });
  if (res.status === 409 || res.status === 422) return null;
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}.`);
  return (await res.json()).content.sha;
}

// --- The sync ---
let running = null;

// Sync now. Resolves to {ok, added, uploaded, pruned, settingsRestored,
// message}. Concurrent calls share one run. Does nothing if not set up.
export function sync() {
  if (!isConfigured()) return Promise.resolve({ ok: false, off: true, message: 'Not set up.' });
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

async function run() {
  const state = loadState();
  const result = { ok: true, added: 0, uploaded: 0, pruned: 0, settingsRestored: false };
  try {
    const now = Date.now();
    const windowStart = dayStart(utcDay(now)) - WINDOW_DAYS * DAY_MS;
    const remote = await listRemote();

    // Local events grouped by file.
    const local = new Map();
    for (const e of await allEvents()) {
      if (!e.game) continue;
      const p = pathOf(e);
      if (!local.has(p)) local.set(p, []);
      local.get(p).push(e);
    }

    // Merge a remote file's events into local (add-only); returns how many.
    async function merge(path, text) {
      const theirs = JSON.parse(text);
      const mine = local.get(path) || [];
      const have = new Set(mine.map(keyOf));
      const fresh = theirs.filter(e => !have.has(keyOf(e))).map(stripId);
      if (fresh.length) {
        await addEvents(fresh);
        local.set(path, [...mine, ...fresh]);
        result.added += fresh.length;
      }
      return theirs.length;
    }

    // 1. Pull what changed on GitHub (within the window).
    for (const [path, sha] of remote) {
      const m = path.match(FILE_RE);
      if (!m || dayStart(m[2]) < windowStart) continue;
      if (state.files[path]?.sha === sha) continue;
      const file = await readFile(path);
      if (!file) continue;
      const count = await merge(path, file.text);
      state.files[path] = { sha: file.sha, count };
    }

    // 2. Push files where this device has more than GitHub.
    for (const [path, events] of local) {
      const known = state.files[path];
      if (known && known.sha === remote.get(path) && known.count >= events.length) continue;
      const day = path.slice(path.indexOf('/') + 1, -5);
      const message = `woodshed: ${path.split('/')[0]} ${day} (${events.length} answers)`;
      let sha = await writeFile(path, fileText(local.get(path)), remote.get(path), message);
      if (sha === null) {
        // Changed underneath: take theirs in, then write the union.
        const file = await readFile(path);
        if (file) await merge(path, file.text);
        sha = await writeFile(path, fileText(local.get(path)), file?.sha, message);
        if (sha === null) throw new SyncError('GitHub kept changing — will retry next time.');
      }
      state.files[path] = { sha, count: local.get(path).length };
      result.uploaded++;
    }

    // 3. Settings: restore on a fresh install (no calibration yet), else push.
    const mine = {};
    for (const k of SETTINGS) { const v = ls(k); if (v !== null) mine[k] = v; }
    if (!('woodshed.calib' in mine) && remote.has(SETTINGS_PATH)) {
      const file = await readFile(SETTINGS_PATH);
      const theirs = file ? JSON.parse(file.text) : {};
      for (const k of SETTINGS) if (k in theirs) ls(k, theirs[k]);
      result.settingsRestored = Object.keys(theirs).length > 0;
      state.settings = file?.text;
    } else if (Object.keys(mine).length) {
      const text = `${JSON.stringify(mine, null, 2)}\n`;
      if (text !== state.settings) {
        const sha = await writeFile(SETTINGS_PATH, text, remote.get(SETTINGS_PATH), 'woodshed: settings')
          ?? await writeFile(SETTINGS_PATH, text, (await readFile(SETTINGS_PATH))?.sha, 'woodshed: settings');
        if (sha) state.settings = text;
      }
    }

    // 4. Prune (A8): local days before the window, all confirmed on GitHub.
    for (const [path, events] of local) {
      const m = path.match(FILE_RE);
      if (!m || dayStart(m[2]) >= windowStart) continue;
      if ((state.files[path]?.count ?? -1) < events.length) continue;
      await deleteEvents(dayStart(m[2]), dayStart(m[2]) + DAY_MS);
      result.pruned += events.length;
    }

    if (result.added) invalidateSummary();   // the cache doesn't cover them yet
    state.last = now;
    state.error = null;
    result.message = 'Synced.';
  } catch (err) {
    if (!(err instanceof SyncError)) console.error(err);   // a bug, not a network state
    state.error = err.message;
    result.ok = false;
    result.message = err.message;
  }
  saveState(state);
  return result;
}
