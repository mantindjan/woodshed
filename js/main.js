// App wiring: the control panel (tabs Play · Levels · Stats · ⚙), horn
// connection and calibration, the degree drill, levels and custom
// exercises (D6), the heatmap (D4) and backup (A7).
//
// Pitch spaces: see music.js. Calibration stores the MIDI pitch class the
// horn sends for a fingered written C; that one number converts both ways
// between written (display, judging) and concert (the pad).

import { connectMidi } from './midi.js';
import { QUALITY_ORDER, QUALITY_TEXT, QUALITY_NAME, DEGREES, NOTES, WRITTEN_MIDDLE_C, degreeLabel, writtenPc } from './music.js';
import { startScales, stopScales, scaleNote, scalesRunning } from './scales.js';
import { mountTempo } from './tempo.js';
import { noteHTML } from './notation.js';
import { startRound, stopRound, drillNote, isRunning } from './drill.js';
import { downloadBackup, loadBackup, countEvents } from './backup.js';
import { allEvents } from './events.js';
import { LEVELS, UNIT_TITLES, exercise as resolveExercise, customCells, matchLevel, setsOf } from './levels.js';
import { getSummary } from './summary.js';
import { sync, syncConfig, setSyncConfig, syncState } from './sync.js';
import { renderHeatmap } from './heatmap.js';

// Settings (localStorage, all carried by the backup file).
const CALIB_KEY = 'woodshed.calib';
const MODE_KEY = 'woodshed.mode';
const PICK_KEY = 'woodshed.pick';
const LENGTH_KEY = 'woodshed.length';
const EXERCISE_KEY = 'woodshed.exercise';
const CUSTOM_KEY = 'woodshed.custom';
const OFFSET_KEY = 'woodshed.calibOffset';   // horn MIDI − written, from middle C
const GAME_KEY = 'woodshed.game';
const SCALE_KEY = 'woodshed.scale';
const DIR_KEY = 'woodshed.dir';
const KEY_KEY = 'woodshed.key';
const BPM_KEY = 'woodshed.bpm';
const MISSES_KEY = 'woodshed.misses';

// Question-count choices; 0 = endless (until Stop).
const LENGTHS = [10, 20, 50, 100, 0];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const statusEl = $('#status');
const noteEl = $('#note');
const rawEl = $('#raw');
const hintEl = $('#hint');
const calibBtn = $('#calibrate');
const connectBtn = $('#connect');
const startBtn = $('#start');
const stopBtn = $('#stop');

// localStorage can throw (private mode, storage disabled); fall back to
// defaults rather than breaking the page.
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function loadJSON(key, fallback) {
  try { return JSON.parse(load(key)) ?? fallback; } catch { return fallback; }
}

let calib = load(CALIB_KEY) === null ? null : Number(load(CALIB_KEY));
// Octave-aware calibration (E1): older calibrations only know the pitch
// class, which the degree drill needs; scales need the octave too.
let calibOffset = load(OFFSET_KEY) === null ? null : Number(load(OFFSET_KEY));
let game = load(GAME_KEY) === 'scales' ? 'scales' : 'degrees';
let scale = load(SCALE_KEY) === 'penta' ? 'penta' : 'major';
let dir = load(DIR_KEY) === 'down' ? 'down' : 'up';
let keyChoice = load(KEY_KEY) === null || load(KEY_KEY) === 'random' ? 'random' : Number(load(KEY_KEY));
let misses = [1, 2, 3, 5].includes(Number(load(MISSES_KEY))) ? Number(load(MISSES_KEY)) : 3;
let calibrating = false;
let mode = load(MODE_KEY) === 'learn' ? 'learn' : 'practice';
let pick = load(PICK_KEY) === 'random' ? 'random' : 'weak';
let length = LENGTHS.includes(Number(load(LENGTH_KEY) ?? 20)) ? Number(load(LENGTH_KEY) ?? 20) : 20;
// Default to the first rung of the ladder, not the everything-mix.
let exerciseId = load(EXERCISE_KEY) || LEVELS[0].id;
let custom = loadJSON(CUSTOM_KEY, { qualities: ['maj7'], degrees: ['3', '7'] });

const currentExercise = () => resolveExercise(exerciseId, custom, describe);

// --- Tabs: each selects a pane (right) and a view (left stage). ---
// A view or pane shows when it's for this tab and (if game-specific) the
// current game: each game has its own Play · Levels · Stats; ⚙ is shared.
// data-for, not data-game: that attribute is reserved for the game buttons.
const forGame = el => !el.dataset.for || el.dataset.for === game;
let currentTab = 'play';
function showTab(tab) {
  currentTab = tab;
  $$('button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.pane').forEach(p => { p.hidden = !(p.dataset.pane === tab && forGame(p)); });
  // Views use data-view, not data-tab: sharing the tab buttons' attribute
  // made `[data-tab=…]` match hidden views too.
  $$('.view').forEach(v => { v.hidden = !(v.dataset.view === tab && forGame(v)); });
  if (game === 'degrees' && tab === 'levels') showLevels();
  if (game === 'degrees' && tab === 'stats') showStats();
  if (tab === 'horn') showCount();
}
$$('button[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// --- Play pane ---
function showHint() {
  if (calibrating) hintEl.textContent = 'Play middle C — the C in the third space of the staff.';
  else if (calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play middle C.';
  else if (game === 'scales' && calibOffset === null) hintEl.textContent = 'Recalibrate on middle C for scales — the octave matters.';
  else hintEl.textContent = 'Calibrated · redo after changing the horn’s voice.';
}

function showSettings() {
  document.body.dataset.game = game;
  $$('button[data-game]').forEach(b => b.classList.toggle('active', b.dataset.game === game));
  $$('[data-scale]').forEach(b => b.classList.toggle('active', b.dataset.scale === scale));
  $$('[data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === dir));
  $$('[data-key]').forEach(b => b.classList.toggle('active', b.dataset.key === String(keyChoice)));
  $$('[data-misses]').forEach(b => b.classList.toggle('active', Number(b.dataset.misses) === misses));
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $$('[data-pick]').forEach(b => b.classList.toggle('active', b.dataset.pick === pick));
  $$('[data-length]').forEach(b => b.classList.toggle('active', Number(b.dataset.length) === length));
  // The exercise everywhere as "L13 · Major" + its degrees in brass, so
  // what's being practised is as clear as the chord quality.
  const ex = currentExercise();
  const title = ex.num ? `${ex.num} · ${ex.title}` : ex.title;
  for (const [sel, t] of [['#exerciseLabel', title], ['#exerciseName', title], ['#idleName', title]]) $(sel).textContent = t;
  for (const sel of ['#exerciseDegrees', '#stageDegrees', '#idleWhat']) $(sel).textContent = ex.degrees;
  // An empty custom pick can't be played.
  startBtn.disabled = game === 'degrees' && ex.cells.length === 0;
  showHint();
}

function setCalibrating(on) {
  calibrating = on;
  calibBtn.classList.toggle('active', on);
  showHint();
  // The prompt can sit below the fold of a long pane (Scales): bring it up.
  if (on) hintEl.scrollIntoView({ block: 'nearest' });
}

function onNote(midi) {
  rawEl.textContent = `MIDI ${midi}`;
  if (calibrating) {
    calib = midi % 12;
    save(CALIB_KEY, String(calib));
    // Played on middle C (written C5), so the octave is known too.
    calibOffset = midi - WRITTEN_MIDDLE_C;
    save(OFFSET_KEY, String(calibOffset));
    setCalibrating(false);
    noteEl.innerHTML = noteHTML(0);
    return;
  }
  if (calib === null) noteEl.textContent = '?';
  else noteEl.innerHTML = noteHTML(writtenPc(midi, calib));
  if (scalesRunning()) scaleNote(midi);
  else drillNote(midi);
}

function onStatus({ state, names, error }) {
  const text = {
    unsupported: 'No Web MIDI here — use Chrome on Android or desktop.',
    denied: `MIDI permission refused — allow it via the icon left of the address bar, then reload. (${error})`,
    // Chrome caches this failure until it's fully restarted, so Connect
    // can't fix it; the text says what does. (Every entry here is evaluated
    // on every call, and `error` is only set for failures — hence `?.`.)
    failed: error?.startsWith('InvalidStateError')
      ? 'Android’s MIDI service didn’t start. Force-stop Chrome (Settings → Apps → Chrome), replug the horn, reopen. Still broken? Restart the phone.'
      : `MIDI failed — ${error}`,
    none: 'No horn connected.',
    connected: `Horn: ${names.join(', ')}`,
  }[state];
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  // The connect button is only useful when a retry could change something.
  connectBtn.hidden = state === 'connected' || state === 'unsupported';
}

// Idle vs running: during a round only Stop works, and the tabs are locked
// on Play.
function showRunning(running) {
  $('#idle').hidden = running;
  startBtn.hidden = running;
  stopBtn.hidden = !running;
  $$('.pane[data-pane="play"] button, button[data-tab], button[data-game]').forEach(b => {
    if (b !== stopBtn) b.disabled = running;
  });
}

function onRoundEnd(result) {
  showRunning(false);
  runSync();   // push this round's answers (A9); quiet if not set up
  showSettings();
  $('#chord').textContent = '';
  $('#degree').textContent = '';
  $('#progress').textContent = '';
  $('#degree').classList.remove('reveal', 'pulse', 'miss', 'long');
  $('#feedback').className = '';
  if (!result) {
    $('#feedback').textContent = '';
    return;
  }
  const { mode: m, total, firstTry, median, bestStreak } = result;
  const line = m === 'practice'
    ? `${firstTry} / ${total} right first time`
    : `${total} done · ${total - firstTry} needed another go`;
  $('#feedback').textContent = median === null
    ? line : `${line} · median ${(median / 1000).toFixed(2)} s`;
  // The final score stays up (drill.js); the combo line shows the best streak.
  if (m === 'practice') $('#combo').textContent = bestStreak ? `best combo ${bestStreak}` : '';
}

startBtn.addEventListener('click', () => {
  // Both games judge in written pitch, which needs calibration first;
  // scales also need the octave (a middle-C calibration).
  if (calib === null || (game === 'scales' && calibOffset === null)) { setCalibrating(true); return; }
  if (calibrating) setCalibrating(false);
  showRunning(true);
  if (game === 'scales') {
    startScales({ scale, key: keyChoice, direction: dir, bpm: tempo.get(), misses, calib, calibOffset },
                () => { showRunning(false); runSync(); });
  } else {
    startRound(mode, calib, onRoundEnd, { length, pick, exercise: currentExercise() });
  }
});
stopBtn.addEventListener('click', () => {
  if (scalesRunning()) stopScales();
  else if (isRunning()) stopRound();
});

// --- Game switch and scale settings (E1) ---
$$('button[data-game]').forEach(b => b.addEventListener('click', () => {
  game = b.dataset.game; save(GAME_KEY, game); showSettings();
  showTab(currentTab === 'horn' ? 'play' : currentTab);
}));
$('#keys').innerHTML = '<button data-key="random">Random</button>' +
  NOTES.map((n, k) => `<button data-key="${k}">${n}</button>`).join('');
$$('[data-key]').forEach(b => b.addEventListener('click', () => {
  keyChoice = b.dataset.key === 'random' ? 'random' : Number(b.dataset.key);
  save(KEY_KEY, String(keyChoice)); showSettings();
}));
$$('[data-scale]').forEach(b => b.addEventListener('click', () => { scale = b.dataset.scale; save(SCALE_KEY, scale); showSettings(); }));
$$('[data-dir]').forEach(b => b.addEventListener('click', () => { dir = b.dataset.dir; save(DIR_KEY, dir); showSettings(); }));
$$('[data-misses]').forEach(b => b.addEventListener('click', () => { misses = Number(b.dataset.misses); save(MISSES_KEY, String(misses)); showSettings(); }));
// B3: tempo control, remembered.
const tempo = mountTempo($('#tempo'), { value: Number(load(BPM_KEY)) || 80, note: '♪ eighths',
                                        onChange: v => save(BPM_KEY, String(v)) });

$$('[data-mode]').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode; save(MODE_KEY, mode); showSettings();
}));
$$('[data-pick]').forEach(b => b.addEventListener('click', () => {
  pick = b.dataset.pick; save(PICK_KEY, pick); showSettings();
}));
$$('[data-length]').forEach(b => b.addEventListener('click', () => {
  length = Number(b.dataset.length); save(LENGTH_KEY, String(length)); showSettings();
}));
$('#exerciseBtn').addEventListener('click', () => showTab('levels'));
calibBtn.addEventListener('click', () => setCalibrating(!calibrating));   // a second tap cancels
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus));

// --- Levels (D6): the ladder on the stage, custom builder in the pane ---

// "△: 3 7 · 7: 3 7": which degrees on which qualities (the colon keeps a
// dominant "7" apart from the degree 7).
function describe(cells) {
  const byQ = new Map();
  for (const { quality, degree } of cells) byQ.set(quality, [...(byQ.get(quality) || []), degreeLabel(degree)]);
  return [...byQ].map(([q, ds]) => `${QUALITY_TEXT[q]}: ${ds.join(' ')}`).join(' · ') || 'nothing selected';
}

function selectExercise(id) {
  exerciseId = id;
  save(EXERCISE_KEY, id);
  showSettings();
  showLevels();
}

// The ladder: one block per unit, one row per quality, the levels as flat
// pills along it (degrees + stars), numbered in ladder order.
async function showLevels() {
  const { stars } = await getSummary();   // cached (A8): no history read
  const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  const pill = l => `<button class="lvl${l.id === exerciseId ? ' active' : ''}" data-level="${l.id}">` +
    `<b>${l.num}</b><span>${l.degrees}</span><i>${starText(stars[l.id] || 0)}</i></button>`;
  let h = '';
  for (const [unit, title] of UNIT_TITLES) {
    h += `<div class="tier">${title}</div>`;
    const levels = LEVELS.filter(l => l.unit === unit);
    for (const q of [...QUALITY_ORDER, 'all']) {
      const row = levels.filter(l => l.quality === q);
      if (!row.length) continue;
      const label = q === 'all' ? (unit === 'everything' ? '' : 'All') : `${QUALITY_NAME[q]} <small>${QUALITY_TEXT[q]}</small>`;
      h += `<div class="lrow"><span class="lq">${label}</span>${row.map(pill).join('')}</div>`;
    }
  }
  h += `<div class="tier">Your own</div><div class="lrow"><span class="lq">Custom</span>` +
       `<button class="lvl${exerciseId === 'custom' ? ' active' : ''}" data-level="custom">` +
       `<span>${describe(customCells(custom.qualities, custom.degrees))}</span></button></div>`;
  $('#ladder').innerHTML = h;
  $$('#ladder [data-level]').forEach(b => b.addEventListener('click', () => selectExercise(b.dataset.level)));

  const ex = currentExercise();
  $('#levelInfo').innerHTML = '<b></b><span class="degs"></span>';
  $('#levelInfo b').textContent = ex.num ? `${ex.num} · ${ex.title}` : ex.title;
  $('#levelInfo .degs').textContent = ex.degrees;
  showCustom();
}

// The builder starts from the current exercise. Any change makes a custom
// pick — unless it matches an existing level, which is then selected.
function showCustom() {
  // A custom pick keeps the chips as tapped: derived from its cells, an
  // empty pick would forget the chosen qualities.
  const sets = exerciseId === 'custom' ? custom : setsOf(currentExercise().cells);
  const chip = (attr, value, label, on) =>
    `<button data-${attr}="${value}" class="${on ? 'active' : ''}">${label}</button>`;
  $('#customQualities').innerHTML = QUALITY_ORDER
    .map(q => chip('cq', q, QUALITY_TEXT[q], sets.qualities.includes(q))).join('');
  $('#customDegrees').innerHTML = DEGREES
    .map(d => chip('cd', d, degreeLabel(d), sets.degrees.includes(d))).join('');
  const n = currentExercise().cells.length;
  $('#customHint').textContent = n ? `${n} combination${n === 1 ? '' : 's'} × 12 roots` : 'Pick at least one quality and one degree that fits it.';
  const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const change = next => {
    const level = matchLevel(customCells(next.qualities, next.degrees));
    if (!level) { custom = next; save(CUSTOM_KEY, JSON.stringify(custom)); }
    selectExercise(level ? level.id : 'custom');
  };
  $$('#customQualities [data-cq]').forEach(b => b.addEventListener('click', () =>
    change({ ...sets, qualities: toggle(sets.qualities, b.dataset.cq) })));
  $$('#customDegrees [data-cd]').forEach(b => b.addEventListener('click', () =>
    change({ ...sets, degrees: toggle(sets.degrees, b.dataset.cd) })));
}
$('#playLevel').addEventListener('click', () => showTab('play'));

// --- Stats (D4) ---
// Tapping a cell selects it (root row narrows to that quality × degree);
// tapping it again, or anywhere else on the matrix, clears it.
let heatSelected = null;
let heatEvents = [];
function drawHeatmap() { renderHeatmap($('#heatmap'), heatEvents, heatSelected); }
$('#heatmap').addEventListener('click', e => {
  if (!e.target.closest('.hm-grid')) return;          // root row: no effect
  const cell = e.target.closest('[data-cell]');
  const key = cell ? cell.dataset.cell : null;
  heatSelected = key && key !== heatSelected ? key : null;
  drawHeatmap();
});

async function showStats() {
  const events = (await allEvents()).filter(e => e.game === 'degrees');
  heatEvents = events;
  drawHeatmap();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const last = events.slice(-100);
  const ok = last.filter(e => e.ok);
  const times = ok.map(e => e.notes[0][1]).sort((a, b) => a - b);
  $('#statAnswers').textContent = events.length;
  $('#statToday').textContent = events.filter(e => e.t >= dayStart).length;
  $('#statAcc').textContent = last.length ? `${Math.round(100 * ok.length / last.length)}%` : '–';
  $('#statMedian').textContent = times.length ? `${(times[times.length >> 1] / 1000).toFixed(2)} s` : '–';
}

// --- ⚙ Sync (A9) ---
function showSyncStatus(res) {
  const el = $('#syncStatus');
  const st = syncState();
  const { repo } = syncConfig();
  if (!repo) {
    el.textContent = 'Off — add a private repo and a token to back up automatically.';
    el.className = 'small-note';
    return;
  }
  const bad = res ? !res.ok : !!st.error;
  const when = st.last ? new Date(st.last).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
  el.textContent = bad ? (res?.message || st.error) : `Synced ${when}${res && (res.added || res.uploaded)
    ? ` · ${res.uploaded} file${res.uploaded === 1 ? '' : 's'} up, ${res.added} answer${res.added === 1 ? '' : 's'} down` : ''}.`;
  el.className = bad ? 'small-note bad' : 'small-note';
}

async function runSync() {
  const res = await sync();
  if (res.off) return;
  showSyncStatus(res);
  // A fresh install got its settings back: reload so they take effect.
  if (res.settingsRestored) location.reload();
  else if (res.added && !$('#view-stats').hidden) showStats();
}

$('#syncRepo').value = syncConfig().repo;
$('#syncToken').value = syncConfig().token;
$('#syncSave').addEventListener('click', () => {
  setSyncConfig($('#syncRepo').value, $('#syncToken').value);
  $('#syncStatus').textContent = 'Syncing…';
  runSync();
});

// --- ⚙ Backup (A7) ---
const menuMsg = $('#menuMsg');
function say(text, bad = false) {
  menuMsg.textContent = text;
  menuMsg.className = bad ? 'bad' : '';
}
async function showCount() {
  const n = await countEvents();
  $('#menuCount').textContent = `${n} answer${n === 1 ? '' : 's'} stored on this device.`;
}
$('#saveBackup').addEventListener('click', async () => {
  const n = await downloadBackup();
  say(`Saved ${n} answer${n === 1 ? '' : 's'} — check your Downloads.`);
});
$('#loadBackupBtn').addEventListener('click', () => $('#loadBackup').click());
$('#loadBackup').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';                 // allow loading the same file again
  if (!file) return;
  try {
    const { added, skipped } = await loadBackup(await file.text());
    const answers = n => `${n} answer${n === 1 ? '' : 's'}`;
    say(`Loaded ${answers(added)}; ${skipped} already here. Restarting…`);
    // Reload so restored settings (calibration, mode, …) take effect.
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    say(err.message, true);
  }
});

showHint();
showSettings();
showTab('play');   // applies the stage for the remembered game
showSyncStatus();
connectMidi(onNote, onStatus);
runSync();   // pull anything new, push anything pending (A9)

// Offline support and fresh files after deploys; see sw.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
