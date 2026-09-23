// Degree drill: a chord symbol and a degree appear, the pad sounds the
// chord in concert pitch, the player blows the note on the horn.
//
// Learn mode: a wrong note is shown but doesn't end the question; it waits
// for the right one. Practice mode: the first note decides, then it moves on.
// Either way only the first attempt counts as "right first time".
//
// Every question is saved as a raw event (events.js, docs/data.md) the
// moment it's answered, so quitting mid-round loses nothing.

import { NOTES, QUALITIES, DEG_SEMI, pc, writtenPc, concertPc } from './music.js';
import { initAudio, playChord, stopAll } from './audio.js';
import { addEvent, requestPersistence } from './events.js';

export const ROUND_LENGTH = 20;
const CHORD_SECONDS = 1.4;     // pad length per question (prototype value)
const PAUSE_RIGHT_MS = 600;    // after a right answer, before the next question
const PAUSE_WRONG_MS = 1500;   // practice miss: time to read the right answer
const DEGREES = ['3', '5', '7'];
const QUALITY_IDS = Object.keys(QUALITIES);
const SCHEMA_VERSION = 1;

const $ = sel => document.querySelector(sel);
const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// Random root, quality and degree; never the exact same question twice in
// a row. All pitch values WRITTEN.
function pickQuestion(prev) {
  let q;
  do {
    q = { root: Math.floor(Math.random() * 12), quality: rand(QUALITY_IDS), degree: rand(DEGREES) };
  } while (prev && q.root === prev.root && q.quality === prev.quality && q.degree === prev.degree);
  q.target = pc(q.root + DEG_SEMI[q.quality][q.degree]);
  return q;
}

let s = null;          // round state while running, else null
let wakeLock = null;

// Keep the screen on during a round. Battery saver may override it anyway.
async function lockScreen() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not granted */ }
}
function unlockScreen() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export const isRunning = () => s !== null;

// mode: 'learn' | 'practice'. calib: MIDI pitch class of a written C.
// onEnd(result | null): result = {mode, total, firstTry} after a full round,
// null when stopped early.
export function startRound(mode, calib, onEnd) {
  initAudio();            // inside the Start tap, so Chrome allows sound
  requestPersistence();
  lockScreen();
  s = {
    mode, calib, onEnd,
    round: Date.now().toString(36),   // groups this round's events
    index: 0, firstTry: 0, q: null,
    accepting: false, timer: null,
  };
  ask();
}

function ask() {
  s.q = pickQuestion(s.q);
  s.index++;
  const { root, quality, degree } = s.q;
  $('#progress').textContent = `${s.index} / ${ROUND_LENGTH}`;
  $('#chord').textContent = NOTES[root] + QUALITIES[quality];
  $('#degree').textContent = degree;
  $('#feedback').textContent = '';
  $('#feedback').className = '';
  playChord(concertPc(root, s.calib), quality, CHORD_SECONDS);
  s.shownAt = performance.now();   // for note timings
  s.shownT = Date.now();           // wall clock, stored in the event
  s.notes = [];
  s.missed = false;
  s.accepting = true;
}

// Called with every note-on from the horn (raw MIDI number).
export function drillNote(midi) {
  if (!s || !s.accepting) return;
  s.notes.push([midi, Math.round(performance.now() - s.shownAt)]);
  const played = writtenPc(midi, s.calib);
  if (played === s.q.target) {
    finish(!s.missed, PAUSE_RIGHT_MS, '✓');
  } else if (s.mode === 'practice') {
    s.missed = true;
    finish(false, PAUSE_WRONG_MS, `✗ ${NOTES[played]} — it’s ${NOTES[s.q.target]}`);
  } else {
    // Learn: show the wrong note, keep waiting for the right one.
    s.missed = true;
    $('#feedback').textContent = `✗ ${NOTES[played]}`;
    $('#feedback').className = 'wrong';
  }
}

function finish(ok, pauseMs, text) {
  s.accepting = false;
  if (ok) s.firstTry++;
  $('#feedback').textContent = text;
  $('#feedback').className = text.startsWith('✓') ? 'right' : 'wrong';

  // Raw, game-agnostic event — format documented in docs/data.md.
  addEvent({
    v: SCHEMA_VERSION,
    t: s.shownT,
    round: s.round,
    game: 'degrees',
    mode: s.mode,
    rootWritten: s.q.root,
    quality: s.q.quality,
    degrees: [s.q.degree],
    targetsWritten: [s.q.target],
    calib: s.calib,
    notes: s.notes,
    ok,
  });

  s.timer = setTimeout(s.index >= ROUND_LENGTH ? endRound : ask, pauseMs);
}

function endRound() {
  const { mode, index: total, firstTry, onEnd } = s;
  cleanup();
  onEnd({ mode, total, firstTry });
}

// Stop mid-round. Answered questions are already saved.
export function stopRound() {
  if (!s) return;
  const { onEnd } = s;
  cleanup();
  onEnd(null);
}

function cleanup() {
  clearTimeout(s.timer);
  stopAll();
  unlockScreen();
  s = null;
}

// Switching away from the tab stops the round, or the pad hangs.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRound();
});
