// Guide tones runner (G2, boss 2026-09-28): an exercise's cadence goes
// round the keys on a staff with bars; only the TARGETS are judged
// (guidelib.js) — play anything in between. The targets are drawn ahead
// on the staff: the tone in a ring on its beat, or along a bar for a
// "late" one, with the note name under it (a setting); between keys a bar
// of drums only (guidelib.js KEY_REST_BARS), then the key change: a tall
// line with the new key's name. After a one-bar count-in the band (or
// the click) plays ONE round; its tally comes up with Play again. Nothing
// stops a round and there are no modes: it's all practice.
//
// Judging (played time = note-on − the ⚙ latency):
//  - a target on a beat is HIT by its pitch class starting within the hit
//    window of the beat, or already sounding there — the last note started
//    before the window, with nothing started since (held over the bar line);
//  - a "late" target by its pitch class starting anywhere in its span;
//  - along the guide-tone line the octave counts (guidelib.js onTheLine):
//    a 3 an octave away from the 7 it resolves is WRONG, "off the line".
// A target nobody played is a MISS; one where the right pitch class came
// only off the line is WRONG.

import { NOTES, degreeLabel } from './music.js';
import { chordHTML } from './notation.js';
import { initAudio, stopAll } from './audio.js';
import { bandParts, scheduleBand } from './band.js';
import { addEvent, requestPersistence } from './events.js';
import { exerciseKeys, EXERCISES } from './celllib.js';
import { buildRound, onTheLine, BAR, LATE } from './guidelib.js';

const MAX_WINDOW_MS = 150;
const COUNT_IN = BAR;            // one bar of clicks
// v2: exercises (guideId + guide snapshot, targets at any beat or late,
// tones drawn from choices); v1 (2026-09-28, never synced): cadence +
// pattern, places one/three/late.
const SCHEMA_VERSION = 2;

const $ = sel => document.querySelector(sel);

let s = null;        // session while running, else null
let raf = 0;
let wakeLock = null;

export const guidesRunning = () => s !== null;
export const guidesPaused = () => !!s?.paused;

// opts: {guide (the exercise {id, name, chords, targets}), exercise (key
// path id), bpm, backing, names (show note names), calib, calibOffset,
// latency}. onEnd() on Stop.
export function startGuides(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, onEnd, session: Date.now().toString(36), timers: [], run: null };
  startRound();
  resize();
  raf = requestAnimationFrame(frame);
}

// Pause drops the round unlogged (half a round is no evidence); resume,
// restart and Play again all start a fresh round from a count-in.
function halt() {
  s.timers.forEach(clearTimeout);
  s.timers = [];
  stopAll();
}
export function pauseGuides() {
  if (!s || s.paused) return;
  halt();
  s.paused = true;
  s.run.phase = 'paused';
  message('<b>Paused</b> — ▶ to go again from the count-in');
}
// The tempo changed while paused (boss, 2026-10-01): ▶ and ↻ both start
// the round again from the count-in, at s.bpm.
export function setGuidesBpm(v) {
  if (!s?.paused) return;
  s.bpm = v;
  $('#guideInfo').textContent = `${v} bpm`;
}
export function resumeGuides() {
  if (!s?.paused) return;
  s.paused = false;
  startRound();
}
export function restartGuides() {
  if (!s) return;
  halt();
  s.paused = false;
  startRound();
}
export function stopGuides() {
  if (!s) return;
  const { onEnd } = s;
  halt();
  cancelAnimationFrame(raf);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $('#guideChords').innerHTML = '';
  s = null;
  message('');
  $('#guideInfo').textContent = '';
  draw();
  onEnd();
}

// A round: the cadence round the path's keys, targets placed, the band's
// parts for it, a count-in from now.
function startRound() {
  const now = performance.now();
  const beat = 60000 / s.bpm;
  const keys = exerciseKeys(s.exercise);
  const round = buildRound(s.guide, keys);
  const t0 = now + 300;
  const first = t0 + COUNT_IN * beat;
  // The band per key, placed at its cadence's start: nothing sounds in the
  // rest bars between keys but the drums (or the click).
  const bass = [], comp = [];
  keys.forEach((_, k) => {
    const cs = round.chords.filter(c => c.keyIdx === k);
    const parts = bandParts(cs, s.backing, s.calib, BAR);
    const at = x => ({ ...x, beat: x.beat + cs[0].start });
    bass.push(...parts.bass.map(at));
    comp.push(...parts.comp.map(at));
  });
  s.run = {
    t0, beat, countIn: COUNT_IN, beats: COUNT_IN + round.beats, nextBeat: 0, bass, comp, bassAt: 0, compAt: 0,
    window: Math.min(MAX_WINDOW_MS, beat * 0.45), keys, phase: 'running', notes: [], played: [],
    chords: round.chords.map(c => ({ ...c, t: first + c.start * beat })),
    targets: round.targets.map(tg => ({ ...tg, t: first + tg.from * beat, tEnd: first + tg.to * beat,
                                         status: 'pending', off: null, w: null, offLine: false, hitAt: null })),
    end: first + round.beats * beat,
  };
  $('#guideChords').innerHTML = s.run.chords.map(c => `<div class="guidechord">${chordHTML(c.key, c.q, c.alt)}</div>`).join('');
  s.run.chordEls = [...$('#guideChords').children];
  scheduleBand(s.run, now, s.bpm, s.backing, k => k % BAR === 0);
  message('');
  $('#guideTitle').textContent = `${s.guide.name} · ${EXERCISES[s.exercise].name}`;
  $('#guideInfo').textContent = `${s.bpm} bpm`;
}

// The last target before `tg` that was hit (the line's previous note).
const prevHit = (r, tg) => {
  for (let i = r.targets.indexOf(tg) - 1; i >= 0; i--) if (r.targets[i].status === 'hit') return r.targets[i];
  return null;
};
function tryHit(r, tg, w, at) {
  if (((w % 12) + 12) % 12 !== tg.pc) return false;
  if (!onTheLine(w, tg.pc, prevHit(r, tg)?.w)) { tg.offLine = true; return false; }
  tg.status = 'hit';
  tg.w = w;
  tg.off = at === null ? null : Math.round(at - (tg.at === LATE ? Math.max(tg.t, Math.min(tg.tEnd, at)) : tg.t));
  tg.hitAt = performance.now();
  return true;
}

// Every note-on while the runner is active.
export function guideNote(midi) {
  if (!s || s.run?.phase !== 'running') return;
  const r = s.run;
  const arrived = performance.now();
  r.notes.push([midi, Math.round(arrived - r.t0)]);           // raw, as received
  const w = midi - (s.calibOffset ?? s.calib);
  const now = arrived - s.latency;
  r.played.push({ w, t: now });
  for (const tg of r.targets) {
    if (tg.status !== 'pending') continue;
    if (now < tg.t - r.window) break;                          // in time order: the rest are later
    if (now > tg.tEnd + r.window) continue;
    if (tryHit(r, tg, w, now)) break;
  }
}

// Frames: a target whose window has passed is judged. A beat target still
// pending is hit by a note held over it (the last one started before the
// window, nothing started since), else it's a miss — or wrong, when its
// pitch came only off the line.
function expire(now) {
  const r = s.run;
  if (r.phase !== 'running') return;
  const played = now - s.latency;
  for (const tg of r.targets) {
    if (tg.status !== 'pending' || played <= tg.tEnd + r.window) continue;
    if (tg.at !== LATE) {
      const held = r.played.filter(p => p.t < tg.t - r.window).pop();
      const since = r.played.some(p => p.t >= tg.t - r.window && p.t <= tg.t + r.window);
      if (held && !since && tryHit(r, tg, held.w, null)) continue;
    }
    tg.status = tg.offLine ? 'wrong' : 'miss';
  }
  if (played > r.end + r.window) score();
}

// The round's tally and its event; then Play again.
function score() {
  const r = s.run;
  r.phase = 'done';
  const base = r.t0;
  const hits = r.targets.filter(tg => tg.status === 'hit').length;
  const offLine = r.targets.filter(tg => tg.status === 'wrong').length;
  addEvent({
    v: SCHEMA_VERSION,
    t: Date.now() - Math.round(performance.now() - base),      // wall clock of the count-in's first click
    round: s.session,
    game: 'guides',
    guideId: s.guide.id,               // the exercise (a preset "p:…" or one of yours)
    guide: { name: s.guide.name, chords: s.guide.chords, targets: s.guide.targets },   // snapshot: history outlives edits
    exercise: s.exercise,              // the key path (celllib.js EXERCISES)
    keys: r.keys,                      // written tonics, in order
    bpm: s.bpm,
    backing: s.backing,
    latency: s.latency,
    calib: s.calib,
    calibOffset: s.calibOffset,
    // Each target: [written tonic pc, chord index in the cadence, the tone drawn,
    //   at (beat from the chord's start, or 'late'),
    //   ms after the count-in's first click (a late target: its span's start),
    //   'hit' | 'wrong' (off the line) | 'miss', timing offset ms (null if held over),
    //   written pitch played (hits)].
    targets: r.targets.map(tg => [tg.key, tg.chordIdx, tg.deg, tg.at, Math.round(tg.t - base), tg.status, tg.off, tg.w]),
    notes: r.notes,                    // every note-on: [raw MIDI, ms after the count-in's first click]
  });
  message(`<b>${hits} / ${r.targets.length} targets</b>` +
          (offLine ? ` · ${offLine} off the line (the right note, an octave away)` : '') +
          '<br><button id="guideAgain">Play again</button>');
}
$('#guideMsg').addEventListener('click', e => { if (e.target.closest('#guideAgain')) restartGuides(); });

function message(html) {
  const el = $('#guideMsg');
  el.innerHTML = html;
  el.hidden = !html;
}

// --- Drawing: a staff with bars scrolling to a fixed now line ---
const canvas = () => $('#guideLane');
function resize() {
  const c = canvas();
  const b = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(b.width * dpr);
  c.height = Math.round(b.height * dpr);
  c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (s) resize(); });

function frame() {
  if (!s) return;
  if (!s.paused && s.run.phase === 'running') {
    const now = performance.now();
    scheduleBand(s.run, now, s.bpm, s.backing, k => k % BAR === 0);
    expire(now);
  }
  draw();
  raf = requestAnimationFrame(frame);
}

const COLORS = { hit: '#ffe2a8', wrong: '#d65a5a', miss: '#6a3434' };

function draw() {
  const c = canvas();
  const g = c.getContext('2d');
  const W = c.clientWidth, H = c.clientHeight;
  g.clearRect(0, 0, W, H);
  const r = s?.run;
  if (!r) return;
  const now = performance.now();
  const nowX = W * 0.22;
  // Two to three bars in view ahead.
  const pxBeat = Math.max(34, W * 0.075);
  const x = t => nowX + ((t - now) / r.beat) * pxBeat;
  const cy = H * 0.58, half = 36, gap = 14;
  g.strokeStyle = 'rgba(217,164,65,.18)';
  g.lineWidth = 1;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(0, cy + k * gap); g.lineTo(W, cy + k * gap); g.stroke(); }
  // Count-in: four dots filling, one per click.
  const first = r.t0 + COUNT_IN * r.beat;
  if (now < first) {
    const filled = Math.max(0, Math.min(COUNT_IN, Math.floor((now - r.t0) / r.beat) + 1));
    for (let b = 0; b < COUNT_IN; b++) {
      g.beginPath(); g.arc(W * 0.6 + (b - 1.5) * 30, 18, 8, 0, Math.PI * 2);
      g.fillStyle = b < filled ? '#ffe2a8' : 'transparent'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,226,168,.7)'; g.stroke();
    }
  }
  // Beats faint, bar lines stronger, chord changes stronger still — and a
  // KEY change the tallest, with the new key's name (boss, 2026-09-28).
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const ch of r.chords) {
    if (ch.chordIdx !== 0 || ch.keyIdx === 0) continue;
    const kx = x(ch.t);
    if (kx < -20 || kx > W + 20) continue;
    // From above the chord symbols to the staff's foot — the note names
    // below stay clear; the key's name under them.
    g.strokeStyle = '#ffe2a8'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(kx, cy - half - 78); g.lineTo(kx, cy + half); g.stroke();
    g.fillStyle = '#ffe2a8'; g.font = '800 13px system-ui, sans-serif';
    g.fillText(`key of ${NOTES[ch.tonic]}`, kx, cy + half + 32);
  }
  for (let k = 0; k <= r.beats - COUNT_IN; k++) {
    const tk = first + k * r.beat;
    const bx = x(tk);
    if (bx < -20 || bx > W + 20) continue;
    const change = r.chords.some(ch => Math.abs(ch.t - tk) < 1);
    const bar = k % BAR === 0;
    g.strokeStyle = change ? 'rgba(255,226,168,.7)' : bar ? 'rgba(217,164,65,.45)' : 'rgba(217,164,65,.12)';
    g.lineWidth = change ? 3 : bar ? 1.5 : 1;
    g.beginPath(); g.moveTo(bx, cy - half); g.lineTo(bx, cy + half); g.stroke();
  }
  // Targets: a ring on its beat, or a bar along a late span; the degree in
  // it, the note name under it (a setting).
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const tg of r.targets) {
    const a = x(tg.t), b = x(tg.tEnd);
    if (b < -30 || a > W + 30) continue;
    const done = tg.status !== 'pending';
    const fill = done ? COLORS[tg.status] : 'rgba(24,24,24,.9)';
    const stroke = done ? COLORS[tg.status] : '#d9a441';
    g.lineWidth = 2;
    if (tg.at === LATE) {
      const rr = 13;
      g.beginPath(); g.roundRect(a - rr, cy - rr, b - a + 2 * rr, 2 * rr, rr);
      g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.stroke();
    } else {
      g.beginPath(); g.arc(a, cy, 15, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.stroke();
    }
    const mid = tg.at === LATE ? (a + b) / 2 : a;
    g.fillStyle = done && tg.status !== 'hit' ? '#fff' : done ? '#181818' : '#ffe2a8';
    // ♯11 or ♭13 is three glyphs: smaller, so it stays in the ring.
    const label = degreeLabel(tg.deg);
    g.font = `800 ${label.length > 2 ? 11 : label.length > 1 ? 13 : 16}px system-ui, sans-serif`;
    g.fillText(label, mid, cy + 1);
    if (s.names) {
      g.fillStyle = 'rgba(255,226,168,.8)';
      g.font = '700 13px system-ui, sans-serif';
      g.fillText(NOTES[tg.pc], mid, cy + half + 12);
    }
    if (tg.status === 'hit' && now - tg.hitAt < 500) {
      const age = (now - tg.hitAt) / 500;
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,214,130,${0.5 * (1 - age)})`;
      g.beginPath(); g.arc(mid, cy, 15 + 18 * age, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  // Every note played: a small tick where it was played, for feedback
  // between the targets.
  g.fillStyle = 'rgba(255,255,255,.35)';
  for (const p of r.played) {
    const px = x(p.t + s.latency);
    if (px > -5 && px < W) { g.beginPath(); g.arc(px, cy - half - 6, 2.5, 0, Math.PI * 2); g.fill(); }
  }
  // The now line.
  g.save();
  g.shadowColor = 'rgba(255,200,110,.9)'; g.shadowBlur = 10;
  g.strokeStyle = '#ffe2a8'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(nowX, cy - half - 50); g.lineTo(nowX, cy + half + 26); g.stroke();
  g.restore();
  // Chord symbols above the staff; the one being played pinned at the left
  // (none during a rest bar).
  let current = -1;
  r.chords.forEach((ch, i) => { if (ch.t <= now && now < ch.t + ch.beats * r.beat) current = i; });
  r.chordEls?.forEach((el, i) => {
    let cx = x(r.chords[i].t);
    if (i === current) cx = Math.max(cx, 6);
    const vis = (i === current || r.chords[i].t > now) && cx >= 0 && cx < W + 10;
    el.style.display = vis ? '' : 'none';
    if (vis) el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy - half - 70)}px)`;
  });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopGuides(); });
