// Horn check: connect the horn, calibrate on a written C, then show the
// written note name of whatever is played.
//
// Pitch spaces: the horn sends MIDI in whatever pitch its current voice
// implies. Calibration stores the MIDI pitch class the horn sends for a
// fingered written C, so (midi − calib) mod 12 is the WRITTEN pitch class,
// independent of the horn's voice or the instrument's transposition.

import { connectMidi } from './midi.js';

// Spelling chosen by the player (see docs/handover/SOLVED.md): sharps for
// the two lower black keys, flats for the three upper. Indexed by pitch class.
const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const CALIB_KEY = 'woodshed.calib';

const $ = sel => document.querySelector(sel);
const statusEl = $('#status');
const noteEl = $('#note');
const rawEl = $('#raw');
const hintEl = $('#hint');
const calibBtn = $('#calibrate');
const connectBtn = $('#connect');

// localStorage can throw (private mode, storage disabled); treat that as
// "not calibrated" rather than breaking the page.
function loadCalib() {
  try {
    const v = localStorage.getItem(CALIB_KEY);
    return v === null ? null : Number(v);
  } catch { return null; }
}
function saveCalib(pc) {
  try { localStorage.setItem(CALIB_KEY, String(pc)); } catch { /* ignore */ }
}

let calib = loadCalib();   // MIDI pitch class of a written C, or null
let calibrating = false;

function showHint() {
  if (calibrating) hintEl.textContent = 'Play a written C.';
  else if (calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play a written C.';
  else hintEl.textContent = 'Calibrated. Recalibrate after changing the horn’s voice.';
}

function onNote(midi) {
  logLine(`        ✓ counted ${midi}`);   // TEMPORARY: raw MIDI log
  rawEl.textContent = `MIDI ${midi}`;
  if (calibrating) {
    calib = midi % 12;
    saveCalib(calib);
    calibrating = false;
    calibBtn.classList.remove('active');
    noteEl.textContent = 'C';
    showHint();
    return;
  }
  if (calib === null) {
    noteEl.textContent = '?';
    return;
  }
  // +12 keeps the result non-negative before the modulo.
  noteEl.textContent = NOTES[(midi % 12 - calib + 12) % 12];
}

function onStatus({ state, names }) {
  const text = {
    unsupported: 'No Web MIDI here — use Chrome on Android or desktop.',
    denied: 'MIDI permission refused.',
    none: 'No horn connected.',
    connected: `Horn: ${names.join(', ')}`,
  }[state];
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  // The connect button is only useful when a retry could change something.
  connectBtn.hidden = state === 'connected' || state === 'unsupported';
}

// --- TEMPORARY: raw MIDI log, to diagnose the display freezing during fast
// runs. Remove once the debounce issue is understood and fixed. ---
const LOG_LINES = 40;
const logEl = $('#log');
let logLines = [];
let lastNoteMsgTime = null;   // time of the previous note message, for deltas
let otherCount = 0;           // non-note messages (breath CC etc.) since last note message

function logLine(text) {
  logLines.unshift(text);               // newest on top
  logLines.length = Math.min(logLines.length, LOG_LINES);
  logEl.textContent = logLines.join('\n');
}

function onRaw(data, t) {
  const [status, d1, d2] = data;
  const type = status & 0xf0;
  const isNote = type === 0x90 || type === 0x80;
  if (!isNote) { otherCount++; return; }
  // Collapse the non-note traffic since the last note into one line.
  if (otherCount) { logLine(`        (${otherCount} other msgs)`); otherCount = 0; }
  const dt = lastNoteMsgTime === null ? '' : `+${Math.round(t - lastNoteMsgTime)}`;
  lastNoteMsgTime = t;
  const kind = type === 0x80 ? 'off' : d2 === 0 ? 'on v0' : 'on';
  logLine(`${dt.padStart(6)}ms  ${kind.padEnd(5)} ${d1} v${d2}`);
}

$('#logClear').addEventListener('click', () => {
  logLines = []; lastNoteMsgTime = null; otherCount = 0; logEl.textContent = '';
});
// --- end TEMPORARY ---

calibBtn.addEventListener('click', () => {
  calibrating = !calibrating;          // a second tap cancels
  calibBtn.classList.toggle('active', calibrating);
  showHint();
});
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus, onRaw));

showHint();
connectMidi(onNote, onStatus, onRaw);
