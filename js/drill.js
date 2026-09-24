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
const PAUSE_RIGHT_MS = 1000;   // after a right answer, before the next question (boss: 1 s)
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
  $('#degree').classList.remove('reveal', 'pulse', 'miss');
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
  const ms = Math.round(performance.now() - s.shownAt);
  s.notes.push([midi, ms]);
  const played = writtenPc(midi, s.calib);
  if (played === s.q.target) {
    // Right: brass burst from the disc, and the reaction time (D2).
    s.times.push(ms);
    flash('good');
    burst(false);
    floatNote(NOTES[s.q.target]);
    label(`${(ms / 1000).toFixed(2)} s`, speedLabel(ms), false);
    finish(!s.missed, PAUSE_RIGHT_MS);
  } else {
    // Wrong: red shaking burst and the chord shakes. The wrong note itself
    // isn't shown — only what the right one was.
    s.missed = true;
    flash('bad');
    burst(true);
    shake();
    if (s.mode === 'practice') {
      // Practice moves on: the disc turns red and flips to the right note.
      $('#degree').textContent = NOTES[s.q.target];
      $('#degree').classList.add('reveal');
      finish(false, PAUSE_WRONG_MS);
    } else {
      // Learn: the disc flashes red, no answer given; keep waiting.
      restart($('#degree'), 'miss');
      label('', 'try again', true);
    }
  }
}

// --- Feedback effects, game style: a burst that flashes out from the
// degree disc (brass expanding ring when right, red shaking burst when
// wrong), a glow behind the question, and a label under it. ---

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

// A burst centred on the degree disc — the thing the player answered.
function burst(bad) {
  const drill = $('.drill').getBoundingClientRect();
  const disc = $('#degree').getBoundingClientRect();
  const b = document.createElement('div');
  b.className = bad ? 'burst bad' : 'burst good';
  b.style.left = `${disc.left - drill.left + disc.width / 2}px`;
  b.style.top = `${disc.top - drill.top + disc.height / 2}px`;
  $('.drill').append(b);
  setTimeout(() => b.remove(), 700);
  if (!bad) restart($('#degree'), 'pulse');
}

// The right note drifts up out of the disc on a random, slow wobble and
// fades — like floating score numbers in a game. Each gets its own sway
// (amplitude, speed, direction) so no two rise the same way.
function floatNote(text) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const drill = $('.drill').getBoundingClientRect();
  const disc = $('#degree').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-note';
  el.textContent = text;
  el.style.left = `${disc.left - drill.left + disc.width / 2}px`;
  el.style.top = `${disc.top - drill.top + disc.height / 2}px`;
  $('.drill').append(el);

  const sway = 8 + Math.random() * 12;          // px either side
  const cycles = 0.8 + Math.random() * 0.8;     // wobbles on the way up
  const phase = Math.random() * 2 * Math.PI;
  const rise = 120 + Math.random() * 50;        // px
  const drift = (Math.random() - 0.5) * 40;     // slow sideways lean
  const steps = 12;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = drift * t + sway * Math.sin(phase + t * cycles * 2 * Math.PI) - sway * Math.sin(phase);
    const y = -rise * t;
    const tilt = 6 * Math.cos(phase + t * cycles * 2 * Math.PI);
    frames.push({
      transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${tilt}deg) scale(${t < 0.15 ? 0.6 + t * 2.7 : 1})`,
      opacity: t < 0.1 ? t * 10 : t > 0.6 ? (1 - t) / 0.4 : 1,
    });
  }
  el.animate(frames, { duration: 900, easing: 'ease-out' }).onfinish = () => el.remove();
}

// The line under the question: reaction time + speed, or "try again".
function label(text, sub, bad) {
  const f = $('#feedback');
  f.innerHTML = '<b></b><small></small>';
  f.querySelector('b').textContent = text;
  f.querySelector('small').textContent = sub;
  f.className = '';
  restart(f, bad ? 'fb-bad' : 'fb-good');
}

// Re-trigger a CSS animation class on an element.
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function shake() {
  restart($('.question'), 'shake');
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
