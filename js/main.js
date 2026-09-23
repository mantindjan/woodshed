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

calibBtn.addEventListener('click', () => {
  calibrating = !calibrating;          // a second tap cancels
  calibBtn.classList.toggle('active', calibrating);
  showHint();
});
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus));

showHint();
connectMidi(onNote, onStatus);
