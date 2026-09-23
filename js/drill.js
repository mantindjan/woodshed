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
import { chordHTML } from './notation.js';
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

// Median of a list of ms values, or null when empty.
function medianMs(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// mode: 'learn' | 'practice'. calib: MIDI pitch class of a written C.
// onEnd(result | null): result = {mode, total, firstTry, median} after a full
// round (median: ms from chord to correct note, or null),
// null when stopped early.
export function startRound(mode, calib, onEnd) {
  initAudio();            // inside the Start tap, so Chrome allows sound
  requestPersistence();
  lockScreen();
  s = {
    mode, calib, onEnd,
    round: Date.now().toString(36),   // groups this round's events
    index: 0, firstTry: 0, q: null,
    times: [],        // ms from chord to correct note, per answered question
    accepting: false, timer: null,
  };
  ask();
}

function ask() {
  s.q = pickQuestion(s.q);
  s.index++;
  const { root, quality, degree } = s.q;
  $('#progress').textContent = `${s.index} / ${ROUND_LENGTH}`;
  $('#chord').innerHTML = chordHTML(root, quality);
  $('#degree').textContent = degree;
  $('#degree').classList.remove('reveal');
  $('#feedback').textContent = '';
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
  const ms = Math.round(performance.now() - s.shownAt);
  s.notes.push([midi, ms]);
  const played = writtenPc(midi, s.calib);
  if (played === s.q.target) {
    // Right: brass glow, and a cloud with the reaction time (feature #7).
    s.times.push(ms);
    flash('good');
    pop(`${(ms / 1000).toFixed(2)} s`, false, speedLabel(ms));
    finish(!s.missed, PAUSE_RIGHT_MS);
  } else {
    // Wrong: red glow, the chord shakes, the played note sinks away in smoke.
    s.missed = true;
    flash('bad');
    shake();
    pop(NOTES[played], true);
    if (s.mode === 'practice') {
      // Practice moves on: the disc flips to show the right note first.
      $('#degree').textContent = NOTES[s.q.target];
      $('#degree').classList.add('reveal');
      finish(false, PAUSE_WRONG_MS);
    }
    // Learn: keep waiting for the right note.
  }
}

// --- Feedback effects: a radial glow behind the question, a puffy cloud
// that bounces in and floats up with sparks (right) or a red smoke puff that
// deflates and sinks (wrong), and a shake on a miss. ---

// Cloud outline: overlapping circles on a rounded base, in a 200×120 box.
const CLOUD = `<svg viewBox="0 0 200 120" aria-hidden="true">
  <g class="puff"><circle cx="62" cy="72" r="34"/><circle cx="100" cy="50" r="44"/>
  <circle cx="142" cy="70" r="34"/><rect x="40" y="62" width="124" height="46" rx="23"/></g>
  <ellipse class="shine" cx="86" cy="36" rx="22" ry="9"/></svg>`;

// Speed is the skill: under a second is playing, four seconds is theory.
function speedLabel(ms) {
  if (ms < 800) return 'blazing';
  if (ms < 1500) return 'nice';
  return '';
}

function flash(kind) {
  const f = $('#fx');
  f.className = '';
  void f.offsetWidth;   // restart the animation if it's already running
  f.className = kind;
}

// text: big line in the cloud; sub: optional small line under it.
function pop(text, bad, sub = '') {
  const c = document.createElement('div');
  c.className = bad ? 'cloud bad' : 'cloud';
  c.innerHTML = CLOUD + '<div class="cloud-text"><b></b><small></small></div>';
  c.querySelector('b').textContent = text;
  c.querySelector('small').textContent = sub;
  if (!bad) {
    // Sparks fly out in a ring, each at its own angle and distance.
    for (let i = 0; i < 10; i++) {
      const k = document.createElement('i');
      const a = (i / 10) * 2 * Math.PI + Math.random() * 0.4;
      const d = 90 + Math.random() * 50;
      k.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      k.style.setProperty('--dy', `${Math.sin(a) * d * 0.7}px`);
      c.append(k);
    }
  }
  $('.drill').append(c);
  setTimeout(() => c.remove(), 1100);
}

function shake() {
  const q = $('.question');
  q.classList.remove('shake');
  void q.offsetWidth;
  q.classList.add('shake');
}

// ok: right first time (the scored outcome).
function finish(ok, pauseMs) {
  s.accepting = false;
  if (ok) s.firstTry++;

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
  const median = medianMs(s.times);
  cleanup();
  onEnd({ mode, total, firstTry, median });
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
