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

const CALIB_KEY = 'woodshed.calib';
const MODE_KEY = 'woodshed.mode';

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

function showHint() {
  if (calibrating) hintEl.textContent = 'Play a written C.';
  else if (calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play a written C.';
  else hintEl.textContent = 'Calibrated. Recalibrate after changing the horn’s voice.';
}

function showMode() {
  modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
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
  modeBtns.forEach(b => { b.disabled = running; });
}

function onRoundEnd(result) {
  showRunning(false);
  $('#chord').textContent = '—';
  $('#degree').textContent = '';
  $('#progress').textContent = '';
  $('#feedback').className = '';
  if (!result) {
    $('#feedback').textContent = '';
    return;
  }
  const { mode: m, total, firstTry } = result;
  $('#feedback').textContent = m === 'practice'
    ? `${firstTry} / ${total} right first time`
    : `${total} done · ${total - firstTry} needed another go`;
}

startBtn.addEventListener('click', () => {
  // The drill judges in written pitch, which needs calibration first.
  if (calib === null) { setCalibrating(true); return; }
  if (calibrating) setCalibrating(false);
  showRunning(true);
  startRound(mode, calib, onRoundEnd);
});
stopBtn.addEventListener('click', () => { if (isRunning()) stopRound(); });

modeBtns.forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  save(MODE_KEY, mode);
  showMode();
}));

calibBtn.addEventListener('click', () => setCalibrating(!calibrating));   // a second tap cancels
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus));

showHint();
showMode();
connectMidi(onNote, onStatus);

// Offline support and fresh files after deploys; see sw.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
