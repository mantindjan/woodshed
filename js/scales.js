// Scale runner (E1, step 1): play a scale up or down across the horn's
// range, in time, hitting each note as it reaches the "now" line.
//
// Flow per run: waiting (blow any note of the scale — that's where the run
// starts) → count-in (4 clicks) → running (scale notes in EIGHTHS — two per
// click at the set bpm — from the start note to the edge of the range, low
// B♭ / high F♯) → summary → next run (a new key if Random) … until Stop.
//
// Judging: a note is HIT if it's the right written pitch (octave included)
// within the window around its time — ±150 ms, narrowed at fast tempos so
// neighbouring notes' windows never overlap; early/late is shown and graded
// but isn't an error. A wrong pitch in the window, or nothing by the end of it, is a
// MISS. After `misses` misses the run stops ("start again").
//
// Pitch: written = MIDI − calibOffset, where calibOffset = the MIDI note the
// horn sends for written middle C (C5 = 72) minus 72 (main.js calibration).
//
// Display: a canvas lane. Notes are degree discs (no note names), placed by
// pitch step and beat, gliding toward the now line near the left: going up
// they arrive from the upper right, going down from the lower right.

import { SCALES, SAX_RANGE, NOTES, pc } from './music.js';
import { initAudio, click, audioTimeAt, stopAll } from './audio.js';
import { addEvent, requestPersistence } from './events.js';

const MAX_WINDOW_MS = 150;     // hit window either side of a note (as G2)
const COUNT_IN = 4;            // clicks before the first note
const PER_BEAT = 2;            // eighths: two scale notes per click (boss, 2026-09-25)
const SUMMARY_MS = 1800;       // how long a run's summary shows before the next
const SCHEMA_VERSION = 2;

const $ = sel => document.querySelector(sel);

// Every written note of `scale` in key `key` (pc) within the sax range.
function scaleNotes(scale, key) {
  const out = [];
  for (let w = SAX_RANGE.low; w <= SAX_RANGE.high; w++) {
    if (SCALES[scale].steps.includes(pc(w - key))) out.push(w);
  }
  return out;
}
const degreeOf = (scale, key, w) => SCALES[scale].degrees[SCALES[scale].steps.indexOf(pc(w - key))];

let s = null;        // session state while running, else null
let raf = 0;
let wakeLock = null;

export const scalesRunning = () => s !== null;

// opts: {scale: 'major'|'penta', key: 0–11 | 'random', direction: 'up'|'down',
// bpm, misses, calib, calibOffset}. onEnd() when stopped.
export function startScales(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, onEnd, session: Date.now().toString(36), run: null, timers: [] };
  nextRun(opts.key === 'random' ? null : opts.key);
  resize();
  raf = requestAnimationFrame(frame);
}

export function stopScales() {
  if (!s) return;
  const { onEnd } = s;
  s.timers.forEach(clearTimeout);
  cancelAnimationFrame(raf);
  stopAll();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  s = null;
  message('');
  draw(null);
  onEnd();
}

// A new run in `key` (or a random key different from the last).
function nextRun(key) {
  const prev = s.run?.key;
  let k = key;
  while (k === null || k === undefined || (s.key === 'random' && k === prev)) k = Math.floor(Math.random() * 12);
  s.run = { key: k, phase: 'waiting', notes: [], expected: [], misses: 0 };
  topBar();
  message(`Blow any note of <b>${NOTES[k]} ${SCALES[s.scale].name.toLowerCase()}</b> to start — ` +
          `${s.direction === 'up' ? 'going up ↑' : 'going down ↓'}`);
}

function topBar() {
  const r = s?.run;
  $('#scaleTitle').textContent = r ? `${NOTES[r.key]} ${SCALES[s.scale].name.toLowerCase()} ${s.direction === 'up' ? '↑' : '↓'}` : '';
  $('#scaleInfo').textContent = r ? `${s.bpm} bpm · misses ${r.misses}/${s.misses}` : '';
}

function message(html) {
  const el = $('#scaleMsg');
  el.innerHTML = html;
  el.hidden = !html;
}

// Every note-on from the horn while the scale runner is active.
export function scaleNote(midi) {
  if (!s) return;
  const r = s.run;
  const now = performance.now();
  const w = midi - s.calibOffset;
  if (r.phase === 'waiting') return startRun(w, now, midi);
  if (r.phase !== 'running' && r.phase !== 'countin') return;
  r.notes.push([midi, Math.round(now - r.t0)]);
  if (r.phase !== 'running') return;
  // The pending note whose beat is nearest, within the window.
  let best = null;
  for (const e of r.expected) {
    if (e.status !== 'pending') continue;
    const d = Math.abs(now - e.t);
    if (d <= r.window && (!best || d < Math.abs(now - best.t))) best = e;
  }
  if (!best) return;                  // between beats: just recorded
  if (w === best.w) {
    best.status = 'hit';
    best.off = Math.round(now - best.t);
  } else {
    best.status = 'wrong';
    miss();
  }
  checkDone();
}

function startRun(w, now, midi) {
  const r = s.run;
  const notes = scaleNotes(s.scale, r.key);
  if (!notes.includes(w)) {
    message(`That's ${NOTES[pc(w)]} — not in <b>${NOTES[r.key]} ${SCALES[s.scale].name.toLowerCase()}</b>` +
            (w < SAX_RANGE.low || w > SAX_RANGE.high ? ' (or outside low B♭–high F♯)' : '') +
            '. Blow a scale note to start.');
    return;
  }
  // From the start note to the edge of the range, in the chosen direction.
  const i = notes.indexOf(w);
  const run = s.direction === 'up' ? notes.slice(i) : notes.slice(0, i + 1).reverse();
  const beat = 60000 / s.bpm;
  const step = beat / PER_BEAT;       // time between scale notes
  r.t0 = now;
  r.beat = step;                      // the lane moves one slot per note
  r.window = Math.min(MAX_WINDOW_MS, step * 0.45);
  r.notes = [[midi, 0]];
  // Count-in clicks on beats 1–4 after the start note; note j at beat 5 +
  // j/2. Clicks keep going on every beat through the run.
  r.expected = run.map((nw, j) => ({ w: nw, deg: degreeOf(s.scale, r.key, nw),
                                      t: now + beat * (COUNT_IN + 1) + step * j, status: 'pending', off: null }));
  const beats = COUNT_IN + Math.ceil(run.length / PER_BEAT);
  for (let b = 1; b <= beats; b++) click(audioTimeAt(now + beat * b), b === 1);
  r.phase = 'countin';
  message('');
  s.timers.push(setTimeout(() => { if (s?.run === r) r.phase = 'running'; },
                           beat * (COUNT_IN + 1) - r.window - 1));
}

function miss() {
  const r = s.run;
  r.misses++;
  topBar();
  if (r.misses >= s.misses) endRun(true);
}

// Called from frames: notes whose window has passed unplayed are misses.
function expire(now) {
  const r = s.run;
  if (r.phase !== 'running') return;
  for (const e of r.expected) {
    if (e.status === 'pending' && now > e.t + r.window) {
      e.status = 'miss';
      miss();
      if (r.phase !== 'running') return;
    }
  }
  checkDone();
}

function checkDone() {
  const r = s?.run;
  if (r && r.phase === 'running' && r.expected.every(e => e.status !== 'pending')) endRun(false);
}

function endRun(stopped) {
  const r = s.run;
  r.phase = 'summary';
  stopAll();                          // drop the rest of the clicks
  const hits = r.expected.filter(e => e.status === 'hit');
  const offs = hits.map(e => e.off);
  const mean = offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : null;
  addEvent({
    v: SCHEMA_VERSION,
    t: Date.now() - Math.round(performance.now() - r.t0),   // wall clock of the start note
    round: s.session,
    game: 'scales',
    mode: 'practice',
    exercise: `${s.scale}-${s.direction}`,
    scale: s.scale,
    keyWritten: r.key,
    direction: s.direction,
    bpm: s.bpm,
    perBeat: PER_BEAT,                // scale notes per click (2 = eighths)
    allowedMisses: s.misses,
    calib: s.calib,
    calibOffset: s.calibOffset,
    startWritten: r.expected[0].w,
    // Each expected note: [written pitch, ms after the start note, degree, status, timing offset ms].
    expected: r.expected.map(e => [e.w, Math.round(e.t - r.t0), e.deg, e.status, e.off]),
    notes: r.notes,                   // every note-on: [raw MIDI, ms after the start note]
    stopped,
  });
  const lateness = mean === null ? '' : mean > 15 ? ` · ${mean} ms late on average` : mean < -15 ? ` · ${-mean} ms early on average` : ' · right on the beat';
  message(stopped
    ? `<b>${r.misses} misses — start again.</b> ${hits.length} of ${r.expected.length} hit.`
    : `<b>${hits.length} / ${r.expected.length} hit</b>${lateness}`);
  s.timers.push(setTimeout(() => { if (s) nextRun(s.key === 'random' ? null : s.key); }, SUMMARY_MS));
}

// --- Drawing ---
const canvas = () => $('#lane');
function resize() {
  const c = canvas();
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr);
  c.height = Math.round(r.height * dpr);
  c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (s) resize(); });

function frame() {
  if (!s) return;
  expire(performance.now());
  draw(s.run);
  raf = requestAnimationFrame(frame);
}

const COLORS = { pending: '#d9a441', hit: '#ffe2a8', wrong: '#d65a5a', miss: '#6a3434' };

function draw(r) {
  const c = canvas();
  const g = c.getContext('2d');
  const W = c.clientWidth, H = c.clientHeight;
  g.clearRect(0, 0, W, H);
  const nowX = W * 0.22, cy = H * 0.5;
  // The now line.
  g.strokeStyle = 'rgba(217,164,65,.55)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(nowX, 12); g.lineTo(nowX, H - 12); g.stroke();
  if (!r || !r.expected.length) return;

  const now = performance.now();
  // Position along the run in beats (note 0 at 0), smooth in time.
  const pos = (now - r.expected[0].t) / r.beat;
  const pxBeat = Math.min(120, W * 0.2);
  const stepPx = Math.min(26, H / 14);
  const dir = s.direction === 'up' ? 1 : -1;
  // Count-in numbers.
  if (r.phase === 'countin' && pos < 0) {
    const n = Math.ceil(-pos / PER_BEAT);   // pos is in notes; count in beats
    if (n >= 1 && n <= COUNT_IN) {
      g.fillStyle = 'rgba(255,226,168,.9)';
      g.font = '800 64px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), W * 0.6, cy);
    }
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  r.expected.forEach((e, i) => {
    const d = i - pos;                        // beats until this note
    const x = nowX + d * pxBeat;
    const y = cy - dir * d * stepPx;          // up: arrives from upper right
    if (x < -30 || x > W + 30) return;
    const root = e.deg === '1';
    const rad = root ? 20 : 17;
    const fade = x < nowX - 10 ? Math.max(0, 1 - (nowX - x) / (nowX + 30)) : 1;
    g.globalAlpha = fade;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
    g.fillStyle = e.status === 'pending' ? '#1c1a14' : COLORS[e.status];
    g.fill();
    g.lineWidth = root ? 3 : 2;
    g.strokeStyle = COLORS[e.status];
    g.stroke();
    g.fillStyle = e.status === 'pending' ? '#ffe2a8' : '#1a1206';
    g.font = `800 ${root ? 18 : 16}px system-ui, sans-serif`;
    g.fillText(e.deg, x, y + 1);
    // Early/late tick for hits: a small bar left (early) or right (late).
    if (e.status === 'hit' && Math.abs(e.off) > 30) {
      g.fillStyle = '#ffe2a8';
      g.fillRect(x + (e.off > 0 ? rad + 3 : -rad - 7), y - 2, 4, 4);
    }
    g.globalAlpha = 1;
  });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopScales(); });
