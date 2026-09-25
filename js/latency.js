// Latency calibration (⚙): how late the app sees a note played on a click
// it plays. The player blows a note on each of TAKES clicks (after a
// COUNT_IN); the MEDIAN offset between click and note-on is the latency.
//
// Why: the app judges timing against when it SCHEDULES a click, but the
// click is heard later (Android audio output latency, Bluetooth), and the
// horn's note reaches the page later still (breath gate, MIDI). Playing
// dead on the heard click then scores as late — half the hit window gone
// before the player does anything wrong (boss: "feels stringent",
// 2026-09-25). One measured number covers all of it, including the
// player's own habit of sitting ahead of or behind the click; the scale
// runner subtracts it from every note-on before judging.
//
// The median, not the mean: one fluffed note shouldn't move it. The spread
// (median absolute deviation) says whether the number can be trusted.

import { initAudio, click, audioTimeAt, stopAll } from './audio.js';

const BPM = 80;             // quarter clicks, slow enough to land each one
const COUNT_IN = 4;
const TAKES = 8;
const MIN_TAKES = 5;        // fewer usable notes than this: measure again
const ACCEPT_MS = 300;      // a note further than this from a click isn't an answer to it

let m = null;               // measuring state, else null

export const measuring = () => m !== null;

// onProgress(taken, TAKES) after each click is answered or passes;
// onDone({latency, spread, n} | {error}) at the end.
export function startLatency({ onProgress, onDone }) {
  initAudio();
  const beat = 60000 / BPM;
  const t0 = performance.now() + 400;
  const clicks = [];
  for (let b = 0; b < COUNT_IN + TAKES; b++) {
    const t = t0 + beat * b;
    click(audioTimeAt(t), b % 4 === 0);
    if (b >= COUNT_IN) clicks.push(t);
  }
  m = { clicks, offsets: new Array(TAKES).fill(null), onProgress, onDone, timers: [] };
  // After each measured click's window closes, report progress; after the
  // last, finish.
  clicks.forEach((t, i) => m.timers.push(setTimeout(() => {
    onProgress(i + 1, TAKES);
    if (i === TAKES - 1) finish();
  }, t + ACCEPT_MS - performance.now())));
}

export function stopLatency() {
  if (!m) return;
  m.timers.forEach(clearTimeout);
  stopAll();
  m = null;
}

// A note-on while measuring: the answer to the nearest click, if close enough
// and that click isn't answered yet.
export function latencyNote() {
  if (!m) return;
  const now = performance.now();
  let best = -1;
  m.clicks.forEach((t, i) => {
    if (m.offsets[i] === null && Math.abs(now - t) <= ACCEPT_MS &&
        (best < 0 || Math.abs(now - t) < Math.abs(now - m.clicks[best]))) best = i;
  });
  if (best >= 0) m.offsets[best] = now - m.clicks[best];
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function finish() {
  const { offsets, onDone } = m;
  stopLatency();
  const got = offsets.filter(x => x !== null);
  if (got.length < MIN_TAKES) return onDone({ error: `Only ${got.length} of ${TAKES} clicks answered — try again.` });
  const latency = Math.round(median(got));
  const spread = Math.round(median(got.map(x => Math.abs(x - latency))));
  onDone({ latency, spread, n: got.length });
}
