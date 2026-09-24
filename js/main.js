// App wiring: the control panel (tabs Play · Levels · Stats · ⚙), horn
// connection and calibration, the degree drill, levels and custom
// exercises (D6), the heatmap (D4) and backup (A7).
//
// Pitch spaces: see music.js. Calibration stores the MIDI pitch class the
// horn sends for a fingered written C; that one number converts both ways
// between written (display, judging) and concert (the pad).

import { connectMidi } from './midi.js';
import { QUALITY_ORDER, QUALITY_TEXT, DEGREES, degreeLabel, writtenPc } from './music.js';
import { noteHTML } from './notation.js';
import { startRound, stopRound, drillNote, isRunning } from './drill.js';
import { downloadBackup, loadBackup, countEvents } from './backup.js';
import { allEvents } from './events.js';
import { LEVELS, exercise as resolveExercise, customCells, starsByExercise } from './levels.js';
import { renderHeatmap } from './heatmap.js';

// Settings (localStorage, all carried by the backup file).
const CALIB_KEY = 'woodshed.calib';
const MODE_KEY = 'woodshed.mode';
const PICK_KEY = 'woodshed.pick';
const LENGTH_KEY = 'woodshed.length';
const EXERCISE_KEY = 'woodshed.exercise';
const CUSTOM_KEY = 'woodshed.custom';

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
let calibrating = false;
let mode = load(MODE_KEY) === 'learn' ? 'learn' : 'practice';
let pick = load(PICK_KEY) === 'random' ? 'random' : 'weak';
let length = LENGTHS.includes(Number(load(LENGTH_KEY) ?? 20)) ? Number(load(LENGTH_KEY) ?? 20) : 20;
// Default to the first rung of the ladder, not the everything-mix.
let exerciseId = load(EXERCISE_KEY) || 'L1';
let custom = loadJSON(CUSTOM_KEY, { qualities: ['maj7'], degrees: ['3', '7'] });

const currentExercise = () => resolveExercise(exerciseId, custom);

// --- Tabs: each selects a pane (right) and a view (left stage). ---
const VIEW_FOR = { play: 'play', levels: 'levels', stats: 'stats', horn: 'horn' };
function showTab(tab) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
  $$('.view').forEach(v => { v.hidden = v.id !== `view-${VIEW_FOR[tab]}`; });
  if (tab === 'levels') showLevels();
  if (tab === 'stats') showStats();
  if (tab === 'horn') showCount();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// --- Play pane ---
function showHint() {
  if (calibrating) hintEl.textContent = 'Play a written C.';
  else if (calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play a written C.';
  else hintEl.textContent = 'Calibrated · redo after changing the horn’s voice.';
}

function showSettings() {
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $$('[data-pick]').forEach(b => b.classList.toggle('active', b.dataset.pick === pick));
  $$('[data-length]').forEach(b => b.classList.toggle('active', Number(b.dataset.length) === length));
  const ex = currentExercise();
  $('#exerciseLabel').textContent = ex.name;
  $('#exerciseName').textContent = ex.name;
  // Idle card on the stage: what this exercise asks.
  $('#idleName').textContent = ex.name;
  $('#idleWhat').textContent = describe(ex.cells);
  // An empty custom pick can't be played.
  startBtn.disabled = ex.cells.length === 0;
}

function setCalibrating(on) {
  calibrating = on;
  calibBtn.classList.toggle('active', on);
  showHint();
}

function onNote(midi) {
  rawEl.textContent = `MIDI ${midi}`;
  if (calibrating) {
    calib = midi % 12;
    save(CALIB_KEY, String(calib));
    setCalibrating(false);
    noteEl.innerHTML = noteHTML(0);
    return;
  }
  if (calib === null) noteEl.textContent = '?';
  else noteEl.innerHTML = noteHTML(writtenPc(midi, calib));
  drillNote(midi);
}

function onStatus({ state, names, error }) {
  const text = {
    unsupported: 'No Web MIDI here — use Chrome on Android or desktop.',
    denied: `MIDI permission refused — allow it via the icon left of the address bar, then reload. (${error})`,
    failed: `MIDI failed — ${error}`,
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
  $$('.pane[data-pane="play"] button, .tabs button').forEach(b => {
    if (b !== stopBtn) b.disabled = running;
  });
}

function onRoundEnd(result) {
  showRunning(false);
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
  // The drill judges in written pitch, which needs calibration first.
  if (calib === null) { setCalibrating(true); return; }
  if (calibrating) setCalibrating(false);
  showRunning(true);
  startRound(mode, calib, onRoundEnd, { length, pick, exercise: currentExercise() });
});
stopBtn.addEventListener('click', () => { if (isRunning()) stopRound(); });

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

// "△ 3 7 · 7 3 7": which degrees on which qualities.
function describe(cells) {
  const byQ = new Map();
  for (const { quality, degree } of cells) byQ.set(quality, [...(byQ.get(quality) || []), degreeLabel(degree)]);
  return [...byQ].map(([q, ds]) => `${QUALITY_TEXT[q]} ${ds.join(' ')}`).join(' · ') || 'nothing selected';
}

function selectExercise(id) {
  exerciseId = id;
  save(EXERCISE_KEY, id);
  showSettings();
  showLevels();
}

async function showLevels() {
  const stars = starsByExercise(await allEvents());
  const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  let h = '';
  let tier = '';
  for (const l of LEVELS) {
    if (l.tier !== tier) {
      if (tier) h += '</div>';
      tier = l.tier;
      h += `<div class="tier">${tier}</div><div class="lvls">`;
    }
    h += `<button class="lvl${l.id === exerciseId ? ' active' : ''}" data-level="${l.id}">` +
         `<b>${l.id}</b><span>${l.name}</span><i>${starText(stars.get(l.id) || 0)}</i></button>`;
  }
  h += `</div><div class="tier">Your own</div><div class="lvls">` +
       `<button class="lvl${exerciseId === 'custom' ? ' active' : ''}" data-level="custom">` +
       `<b>Custom</b><span>${describe(customCells(custom.qualities, custom.degrees))}</span>` +
       `<i>${starText(stars.get('custom') || 0)}</i></button></div>`;
  $('#ladder').innerHTML = h;
  $$('#ladder [data-level]').forEach(b => b.addEventListener('click', () => selectExercise(b.dataset.level)));

  const ex = currentExercise();
  $('#levelInfo').innerHTML = '<b></b><span></span>';
  $('#levelInfo b').textContent = ex.name;
  $('#levelInfo span').textContent = describe(ex.cells);
  showCustom();
}

function showCustom() {
  const chip = (attr, value, label, on) =>
    `<button data-${attr}="${value}" class="${on ? 'active' : ''}">${label}</button>`;
  $('#customQualities').innerHTML = QUALITY_ORDER
    .map(q => chip('cq', q, QUALITY_TEXT[q], custom.qualities.includes(q))).join('');
  $('#customDegrees').innerHTML = DEGREES
    .map(d => chip('cd', d, degreeLabel(d), custom.degrees.includes(d))).join('');
  const n = customCells(custom.qualities, custom.degrees).length;
  $('#customHint').textContent = n ? `${n} combination${n === 1 ? '' : 's'} × 12 roots` : 'Pick at least one quality and one degree that fits it.';
  const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  $$('#customQualities [data-cq]').forEach(b => b.addEventListener('click', () => {
    custom = { ...custom, qualities: toggle(custom.qualities, b.dataset.cq) };
    save(CUSTOM_KEY, JSON.stringify(custom));
    selectExercise('custom');
  }));
  $$('#customDegrees [data-cd]').forEach(b => b.addEventListener('click', () => {
    custom = { ...custom, degrees: toggle(custom.degrees, b.dataset.cd) };
    save(CUSTOM_KEY, JSON.stringify(custom));
    selectExercise('custom');
  }));
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
connectMidi(onNote, onStatus);

// Offline support and fresh files after deploys; see sw.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
