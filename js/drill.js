// Degree drill: a chord symbol and a degree appear (silently), the player
// blows the note on the horn; a right answer sounds the chord and the note.
//
// Learn mode: a wrong note shows the answer on the disc for a moment, then
// waits for it to be played. Practice mode: the first note decides — a miss
// floats the right note away in red — then it moves on.
// Either way only the first attempt counts as "right first time".
//
// Every question is saved as a raw event (events.js, docs/data.md) the
// moment it's answered, so quitting mid-round loses nothing.

import { NOTES, DEG_SEMI, degreeLabel, pc, writtenPc, concertPc } from './music.js';
import { chordHTML } from './notation.js';
import { initAudio, playChord, playPing, stopAll } from './audio.js';
import { addEvent, allEvents, requestPersistence } from './events.js';
import { createModel, pickWeighted, FAST_MS, GOOD_MS, SLOW_MS } from './weakspots.js';
import { points, comboMult } from './scoring.js';

// The question appears in silence: sounding the chord first made the boss
// wait for it before answering (2026-09-24). The chord plays briefly as a
// reward with the right answer instead.
const CHORD_SECONDS = 0.9;     // reward chord length
const PAUSE_RIGHT_MS = 1000;   // after a right answer, before the next question (boss: 1 s)
const PAUSE_WRONG_MS = 1200;   // practice miss: the right note floats away, then next
const LEARN_REVEAL_MS = 1000;  // learn miss: the disc shows the right note this long
const FLOAT_GAP_PX = 6;        // floating note starts this far above the disc
const SCHEMA_VERSION = 2;       // v2 adds `exercise` (docs/data.md)

const $ = sel => document.querySelector(sel);
const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// Next question from the exercise's cells ({quality, degree}; any root):
// weighted toward weak spots when a model is given (D3), otherwise uniformly
// random. Never the exact same question twice in a row. All pitch values
// WRITTEN.
function pickQuestion(prev, model, cells) {
  let q;
  do {
    q = model
      ? pickWeighted(model, cells)
      : { ...rand(cells), root: Math.floor(Math.random() * 12) };
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
// exercise: {id, name, cells} from levels.js — what gets asked.
// length: questions per round, 0 = endless (until Stop).
// pick: 'weak' (weighted toward weak spots, D3) | 'random'.
// onEnd(result | null): result = {mode, total, firstTry, median, score,
// bestStreak} when the round ends or is stopped with at least one answer
// (median: ms from chord to correct note, or null); null if stopped before
// any answer.
export async function startRound(mode, calib, onEnd, { length = 20, pick = 'weak', exercise } = {}) {
  initAudio();            // inside the Start tap, so Chrome allows sound
  requestPersistence();
  lockScreen();
  const round = {
    mode, calib, onEnd, length,
    round: Date.now().toString(36),   // groups this round's events
    exercise,
    index: 0, answered: 0, firstTry: 0, q: null,
    score: 0, streak: 0, bestStreak: 0,   // D5: practice only
    times: [],        // ms from chord to correct note, per answered question
    model: null,      // weak-spot model, built from the whole event log
    accepting: false, timer: null,
  };
  s = round;
  if (pick === 'weak') {
    const model = createModel();
    for (const e of await allEvents()) model.add(e);
    if (s !== round) return;          // stopped while loading
    round.model = model;
  }
  showScore();
  ask();
}

// Score and combo, top right of the stage (practice only).
function showScore() {
  const practice = s.mode === 'practice';
  $('#score').textContent = practice ? s.score.toLocaleString('en') : '';
  const mult = comboMult(s.streak);
  $('#combo').textContent = practice && mult > 1 ? `×${mult} · ${s.streak} in a row` : '';
}

function ask() {
  clearTimeout(s.revealTimer);
  s.q = pickQuestion(s.q, s.model, s.exercise.cells);
  s.index++;
  const { root, quality, degree } = s.q;
  $('#progress').textContent = `${s.index} / ${s.length || '∞'}`;
  $('#chord').innerHTML = chordHTML(root, quality);
  const label = degreeLabel(degree);
  $('#degree').textContent = label;
  $('#degree').classList.toggle('long', label.length > 2);   // ♯11 needs a smaller size
  $('#degree').classList.remove('reveal', 'pulse', 'miss');
  $('#feedback').textContent = '';
  $('#feedback').className = '';
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
    playChord(concertPc(s.q.root, s.calib), s.q.quality, CHORD_SECONDS);
    playPing(concertPc(s.q.target, s.calib));
    // D5: points only for right-first-time in practice; the streak grows.
    let gained = 0;
    if (s.mode === 'practice' && !s.missed) {
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      gained = points(ms, s.streak);
      s.score += gained;
      showScore();
    }
    const sub = [speedLabel(ms), gained ? `+${gained}` : ''].filter(Boolean).join(' · ');
    label(`${(ms / 1000).toFixed(2)} s`, sub, false);
    finish(!s.missed, PAUSE_RIGHT_MS);
  } else {
    // Wrong: red shaking burst and the chord shakes. The wrong note itself
    // isn't shown — only what the right one was.
    s.missed = true;
    s.streak = 0;          // a miss breaks the combo
    showScore();
    flash('bad');
    burst(true);
    shake();
    if (s.mode === 'practice') {
      // Practice moves on: the right note floats up out of the disc, in red.
      floatNote(NOTES[s.q.target], true);
      finish(false, PAUSE_WRONG_MS);
    } else {
      // Learn: the disc turns red showing the right note for a moment, then
      // flips back to the degree and waits for it to be played.
      const disc = $('#degree');
      disc.textContent = NOTES[s.q.target];
      disc.classList.remove('long');
      disc.classList.add('reveal');
      label('', 'try again', true);
      clearTimeout(s.revealTimer);
      const q = s.q;
      s.revealTimer = setTimeout(() => {
        if (!s || s.q !== q || !s.accepting) return;
        const d = degreeLabel(q.degree);
        disc.textContent = d;
        disc.classList.remove('reveal');
        disc.classList.toggle('long', d.length > 2);
      }, LEARN_REVEAL_MS);
    }
  }
}

// --- Feedback effects, game style: a burst that flashes out from the
// degree disc (brass expanding ring when right, red shaking burst when
// wrong), a glow behind the question, and a label under it. ---

// Speed is the skill: under a second is playing, four seconds is theory.
// Tiers agreed with the boss; the weak-spot score uses the same edges
// (full marks under FAST_MS, floor from SLOW_MS).
function speedLabel(ms) {
  if (ms < FAST_MS) return 'blazing';
  if (ms < GOOD_MS) return 'good';
  if (ms < SLOW_MS) return 'to improve';
  return 'slow';
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

// The right note drifts gently up out of the disc on a random wobble and
// fades — like floating score numbers in a game. Each gets its own sway
// (amplitude, speed, direction) so no two rise the same way. Kept low and
// soft, and done within the 1 s pause before the next question.
// bad: a practice miss — the right note, in red.
function floatNote(text, bad = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const drill = $('.drill').getBoundingClientRect();
  const disc = $('#degree').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = bad ? 'float-note bad' : 'float-note';
  el.textContent = text;
  $('.drill').append(el);
  // Start just above the disc's top edge, not its centre: light text over
  // the brass disc is hard to read, and it looks like part of the disc.
  el.style.left = `${disc.left - drill.left + disc.width / 2}px`;
  el.style.top = `${disc.top - drill.top - el.offsetHeight / 2 - FLOAT_GAP_PX}px`;

  const sway = 4 + Math.random() * 5;           // px either side
  const cycles = 0.5 + Math.random() * 0.5;     // wobbles on the way up
  const phase = Math.random() * 2 * Math.PI;
  const rise = 45 + Math.random() * 20;         // px
  const drift = (Math.random() - 0.5) * 20;     // slow sideways lean
  const steps = 12;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = drift * t + sway * Math.sin(phase + t * cycles * 2 * Math.PI) - sway * Math.sin(phase);
    const y = -rise * t;
    const tilt = 4 * Math.cos(phase + t * cycles * 2 * Math.PI);
    frames.push({
      transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${tilt}deg) scale(${t < 0.15 ? 0.6 + t * 2.7 : 1})`,
      opacity: t < 0.1 ? t * 10 : t > 0.6 ? (1 - t) / 0.4 : 1,
    });
  }
  el.animate(frames, { duration: 950, easing: 'cubic-bezier(.25,.6,.4,1)' }).onfinish = () => el.remove();
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
  const event = {
    v: SCHEMA_VERSION,
    t: s.shownT,
    round: s.round,
    game: 'degrees',
    mode: s.mode,
    exercise: s.exercise.id,
    rootWritten: s.q.root,
    quality: s.q.quality,
    degrees: [s.q.degree],
    targetsWritten: [s.q.target],
    calib: s.calib,
    notes: s.notes,
    ok,
  };
  addEvent(event);
  s.answered++;
  // The weak-spot model learns within the round too.
  if (s.model) s.model.add(event);

  s.timer = setTimeout(s.length && s.index >= s.length ? endRound : ask, pauseMs);
}

function endRound() {
  const result = summary();
  const { onEnd } = s;
  cleanup();
  onEnd(result);
}

// Stop mid-round (or end an endless one). Answered questions are already
// saved; a summary is shown if at least one was answered.
export function stopRound() {
  if (!s) return;
  const result = s.answered ? summary() : null;
  const { onEnd } = s;
  cleanup();
  onEnd(result);
}

function summary() {
  return { mode: s.mode, total: s.answered, firstTry: s.firstTry, median: medianMs(s.times),
           score: s.score, bestStreak: s.bestStreak };
}

function cleanup() {
  clearTimeout(s.timer);
  clearTimeout(s.revealTimer);
  stopAll();
  unlockScreen();
  s = null;
}

// Switching away from the tab stops the round, or the pad hangs.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRound();
});
