// App wiring: horn connection and calibration, the degree drill, and the
// "you played" readout.
//
// Pitch spaces: see music.js. Calibration stores the MIDI pitch class the
// horn sends for a fingered written C; that one number converts both ways
// between written (display, judging) and concert (the pad).

import { connectMidi } from './midi.js';
import { writtenPc } from './music.js';
import { noteHTML } from './notation.js';
import { startRound, stopRound, drillNote, isRunning } from './drill.js';
import { downloadBackup, loadBackup, countEvents } from './backup.js';

const CALIB_KEY = 'woodshed.calib';
const MODE_KEY = 'woodshed.mode';
const PICK_KEY = 'woodshed.pick';
const LENGTH_KEY = 'woodshed.length';

// Question-count choices; 0 = endless (until Stop).
const LENGTHS = [10, 20, 50, 100, 0];

const $ = sel => document.querySelector(sel);
const statusEl = $('#status');
const noteEl = $('#note');
const rawEl = $('#raw');
const hintEl = $('#hint');
const calibBtn = $('#calibrate');
const connectBtn = $('#connect');
const startBtn = $('#start');
const stopBtn = $('#stop');
const modeBtns = document.querySelectorAll('[data-mode]');
const pickBtn = $('#pick');
const lengthBtn = $('#length');

// localStorage can throw (private mode, storage disabled); fall back to
// defaults rather than breaking the page.
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

let calib = load(CALIB_KEY) === null ? null : Number(load(CALIB_KEY));
let calibrating = false;
let mode = load(MODE_KEY) === 'learn' ? 'learn' : 'practice';
let pick = load(PICK_KEY) === 'random' ? 'random' : 'weak';
let length = LENGTHS.includes(Number(load(LENGTH_KEY) ?? 20)) ? Number(load(LENGTH_KEY) ?? 20) : 20;

function showHint() {
  if (calibrating) hintEl.textContent = 'Play a written C.';
  else if (calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play a written C.';
  else hintEl.textContent = 'Calibrated. Recalibrate after changing the horn’s voice.';
}

function showMode() {
  modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  pickBtn.textContent = pick === 'weak' ? 'Weak spots' : 'Random';
  pickBtn.classList.toggle('active', pick === 'weak');
  lengthBtn.textContent = length ? `${length} questions` : 'Endless';
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

// Idle vs running: which controls are usable.
function showRunning(running) {
  startBtn.hidden = running;
  stopBtn.hidden = !running;
  calibBtn.disabled = running;
  $('#menuBtn').disabled = running;
  pickBtn.disabled = running;
  lengthBtn.disabled = running;
  modeBtns.forEach(b => { b.disabled = running; });
}

function onRoundEnd(result) {
  showRunning(false);
  $('#chord').textContent = '';
  $('#degree').textContent = '';
  $('#progress').textContent = '';
  $('#degree').classList.remove('reveal', 'pulse', 'miss');
  $('#feedback').className = '';
  if (!result) {
    $('#feedback').textContent = '';
    return;
  }
  const { mode: m, total, firstTry, median } = result;
  const score = m === 'practice'
    ? `${firstTry} / ${total} right first time`
    : `${total} done · ${total - firstTry} needed another go`;
  $('#feedback').textContent = median === null
    ? score : `${score} · median ${(median / 1000).toFixed(2)} s`;
}

startBtn.addEventListener('click', () => {
  // The drill judges in written pitch, which needs calibration first.
  if (calib === null) { setCalibrating(true); return; }
  if (calibrating) setCalibrating(false);
  showRunning(true);
  startRound(mode, calib, onRoundEnd, { length, pick });
});
stopBtn.addEventListener('click', () => { if (isRunning()) stopRound(); });

modeBtns.forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  save(MODE_KEY, mode);
  showMode();
}));
// Weak spots ⇄ Random (D3).
pickBtn.addEventListener('click', () => {
  pick = pick === 'weak' ? 'random' : 'weak';
  save(PICK_KEY, pick);
  showMode();
});
// Cycle through the question counts.
lengthBtn.addEventListener('click', () => {
  length = LENGTHS[(LENGTHS.indexOf(length) + 1) % LENGTHS.length];
  save(LENGTH_KEY, String(length));
  showMode();
});

calibBtn.addEventListener('click', () => setCalibrating(!calibrating));   // a second tap cancels

// --- Backup panel (A7) ---
const menu = $('#menu');
const menuMsg = $('#menuMsg');
function say(text, bad = false) {
  menuMsg.textContent = text;
  menuMsg.className = bad ? 'bad' : '';
}
async function showCount() {
  const n = await countEvents();
  $('#menuCount').textContent = `${n} answer${n === 1 ? '' : 's'} stored on this device.`;
}
$('#menuBtn').addEventListener('click', () => { say(''); menu.hidden = false; showCount(); });
$('#menuClose').addEventListener('click', () => { menu.hidden = true; });
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
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus));

showHint();
showMode();
connectMidi(onNote, onStatus);

// Offline support and fresh files after deploys; see sw.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
