// Cells runner (I1; the Pattern game until 2026-09-27, see migrate.js):
// play a 4-note cell from memory over chords going by. The stage shows no
// notes ahead (boss, 2026-09-26: "we want the player
// to remember, to feel the cell"): chord symbols scroll toward a fixed
// now line along a staff: a line a beat (a note a beat), stronger where
// each cell starts, thickest where the chord changes; after a clicked count-in a jazz trio plays the
// changes — walking bass, drums, Rhodes comping (trio.js, audio.js).
// Played notes leave marks behind the line — gold right, red wrong.
// The cell itself, heights included, is always shown at the top.
//
// A ROUND = the exercise's keys in order (celllib.js EXERCISES; a fresh
// shuffle each round for 'random'), the cell `reps` times on each chord,
// a note a beat. Start goes straight into a 4-beat count-in (nothing to
// blow), then ONE round; its tally comes up with Play again, which counts
// in the next (boss, 2026-09-27 — rounds on an endless loop, his
// 2026-09-26 idea, "not that great an idea"). A round is scored and
// logged once its last note is judged.
//
// Judging: a note is HIT if it's the right degree of that bar's chord, on
// time (±150 ms, narrowed at fast tempos), with the cell's heights
// relative to the cell's other notes — the octave is the player's choice
// (the first right note of a cell anchors it). The right pitch anywhere in
// the window wins over a glitch, as in scales. Latency (⚙) is subtracted.
//
// Learn: the cell as a b c d c b (playedNotes) goes round the cycle of
// 4ths ×4 → ×2 → ×1; two solid runs (≥ 95 %) in a row move to the next
// stage. Practice: the 4 notes, another path, once per chord. `s.cell` is
// the cell (logged as is), `s.play` what's played.

import { pc, degreeLabel } from './music.js';
import { chordHTML } from './notation.js';
import { initAudio, stopAll } from './audio.js';
import { bandParts, scheduleBand } from './band.js';
import { addEvent, requestPersistence } from './events.js';
import { EXERCISES, STAGES, SOLID, noteSemis, exerciseKeys, playedNotes } from './celllib.js';

const MAX_WINDOW_MS = 150;
const BEATS = 4;                 // the count-in (and the drums' phrase)
// ONE NOTE PER BEAT, no bars (boss, 2026-09-26, after we tangled ourselves
// in bars, eighths and 16ths): the tempo is notes per minute, and a chord
// lasts as long as the cell on it — n notes × reps beats. His measure:
// mastered at ~4 notes a second = 240 bpm, where a 4-note cell ×1
// changes chord every second; learnt slower (70–100). Runs record
// `cellBeats` (= the cell's length; a v2 run from before said 2 or 1).
const SCHEMA_VERSION = 3;         // v3: learn plays a b c d c b, `cellBeats` 6; v2: `cellBeats` (v1 runs: a cell per bar, 4)

const $ = sel => document.querySelector(sel);
// Cell names are typed by the player: escape before they meet innerHTML.
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let s = null;        // session while running, else null
let raf = 0;
let wakeLock = null;

export const cellsRunning = () => s !== null;

// The timeline of a run, pure (tests use it): count-in bar from `t0`, then
// for each key, `reps` passes of the cell. Each expected note: {t, pass
// (which play of the cell), j (which note of it), key, deg,
// semis (above the root, heights included), pc (written pitch class)}.
// `keys`: an exercise id (its fixed path) or the round's keys.
export function buildRun(cell, keys, reps, bpm, t0) {
  const beat = 60000 / bpm;
  const n = cell.notes.length;
  const slot = beat;                  // a note a beat
  const cellBeats = n;
  if (!Array.isArray(keys)) keys = EXERCISES[keys].keys;
  const first = t0 + BEATS * beat;
  const expected = [];
  const chords = [];
  keys.forEach((key, i) => {
    chords.push({ key, t: first + i * reps * cellBeats * beat, beats: reps * cellBeats });
    for (let r = 0; r < reps; r++) {
      const pass = i * reps + r;       // one play of the cell over a chord
      cell.notes.forEach((note, j) => {
        const semis = noteSemis(cell.quality, note);
        expected.push({ t: first + pass * cellBeats * beat + j * slot, pass, j, key, deg: note.deg, semis,
                        pc: pc(key + semis), status: 'pending', off: null, wrongAt: null, hitAt: null });
      });
    }
  });
  return { beat, slot, n, window: Math.min(MAX_WINDOW_MS, slot * 0.45), expected, chords,
           end: first + keys.length * reps * cellBeats * beat };
}

// Judge one note-on (written pitch `w`, played time `now`) against a run.
// Returns the expected note it landed on, or null (between slots).
export function judge(run, anchors, w, now) {
  let best = null;
  for (const e of run.expected) {
    if (e.status !== 'pending') continue;
    const d = Math.abs(now - e.t);
    if (d <= run.window && (!best || d < Math.abs(now - best.t))) best = e;
  }
  if (!best) return null;
  const anchor = anchors.get(best.pass);
  const right = pc(w) === best.pc && (anchor === undefined || w - best.semis === anchor);
  if (right) {
    best.status = 'hit';
    best.off = Math.round(now - best.t);
    if (anchor === undefined) anchors.set(best.pass, w - best.semis);
  } else if (!best.wrongAt) {
    best.wrongAt = now;
  }
  return best;
}

// opts: {cell, exercise, stage (index into STAGES, learn), mode, bpm,
// backing ('band' | 'root' | 'click'), calib, calibOffset, latency}. onEnd() on Stop.
export function startCells(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, onEnd, session: Date.now().toString(36), timers: [], streak: 0, run: null,
        play: { ...opts.cell, notes: playedNotes(opts.cell, opts.mode) } };
  showCell(s.play);
  startStream();
  resize();
  raf = requestAnimationFrame(frame);
}

// Pause / restart, as in scales: the round under way is dropped unlogged
// and the stage freezes; resume or restart starts again from a count-in
// (same cell, path and stage).
export const cellsPaused = () => !!s?.paused;
function halt() {
  s.timers.forEach(clearTimeout);
  s.timers = [];
  stopAll();
}
export function pauseCells() {
  if (!s || s.paused) return;
  halt();
  s.paused = true;
  if (s.run) s.run.phase = 'paused';
  message('<b>Paused</b> — ▶ to go again from the count-in');
}
export function resumeCells() {
  if (!s?.paused) return;
  s.paused = false;
  startStream();
}
export function restartCells() {
  if (!s) return;
  halt();
  s.paused = false;
  startStream();
}

export function stopCells() {
  if (!s) return;
  const { onEnd } = s;
  s.timers.forEach(clearTimeout);
  cancelAnimationFrame(raf);
  stopAll();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  clearChords();
  s = null;
  message('');
  $('#cellInfo').textContent = '';
  draw();
  onEnd();
}

const reps = () => (s.mode === 'learn' ? STAGES[s.stage] : 1);

// A stream: a count-in from now, then rounds added as it goes (appendRound)
// and sound queued ahead (schedule). One `run` object holds it all: the
// expected notes, chords and band parts of every round so far.
function startStream() {
  const now = performance.now();
  const beat = 60000 / s.bpm;
  const t0 = now + 300;
  s.run = { t0, beat, n: s.play.notes.length, window: Math.min(MAX_WINDOW_MS, beat * 0.45),
            expected: [], chords: [], bass: [], comp: [], rounds: [], anchors: new Map(), notes: [],
            phase: 'running', passes: 0, end: t0 + BEATS * beat, beats: BEATS, countIn: BEATS,
            nextBeat: 0, bassAt: 0, compAt: 0, chordEls: [] };
  clearChords();
  appendRound();
  scheduleBand(s.run, now, s.bpm, s.backing, k => k % s.run.n === 0);
  message('');
  $('#cellInfo').textContent = `${s.bpm} bpm`;
}

// Add the next round at the end of the stream: its notes, chords, and the
// band's parts for it (beats counted from the stream's first beat after
// the count-in). Called when the stream's end comes within reach.
function appendRound() {
  const r = s.run;
  const keys = exerciseKeys(s.exercise, r.chords.length ? r.chords[r.chords.length - 1].key : null);
  const n = reps();
  const part = buildRun(s.play, keys, n, s.bpm, r.end - BEATS * r.beat);
  const round = { keys, reps: n, start: r.end, end: part.end, from: r.expected.length, to: r.expected.length + part.expected.length, logged: false };
  for (const e of part.expected) e.pass += r.passes;
  r.passes += keys.length * n;
  r.expected.push(...part.expected);
  r.chords.push(...part.chords);
  // The band, for this round's chords (band.js; the root struck each pass).
  const off = Math.round((round.start - (r.t0 + BEATS * r.beat)) / r.beat);
  const { bass, comp } = bandParts(part.chords.map(c => ({ key: c.key, beats: c.beats, q: s.cell.quality })), s.backing, s.calib, r.n);
  const shift = xs => xs.map(x => ({ ...x, beat: x.beat + off }));
  r.bass.push(...shift(bass));
  r.comp.push(...shift(comp));
  r.end = part.end;
  r.beats = Math.round((r.end - r.t0) / r.beat);
  r.rounds.push(round);
  addChords(part.chords);
  if (r.rounds.length === 1) $('#cellTitle').textContent = `${EXERCISES[s.exercise].name} · ×${n}`;
}

// Every note-on while the cells runner is active.
export function cellNote(midi) {
  if (!s || s.run?.phase !== 'running') return;
  const r = s.run;
  const arrived = performance.now();
  r.notes.push([midi, Math.round(arrived - r.t0)]);           // raw, as received
  const w = midi - (s.calibOffset ?? s.calib);                 // octave is free, so either works
  const e = judge(r, r.anchors, w, arrived - s.latency);
  if (e?.status === 'hit') e.hitAt = arrived;
}

// Frames: close windows that have passed (in played time); score each
// round once its last note is judged.
function expire(now) {
  const r = s.run;
  if (r.phase !== 'running') return;
  const played = now - s.latency;
  for (const e of r.expected) {
    if (e.status === 'pending' && played > e.t + r.window) e.status = e.wrongAt ? 'wrong' : 'miss';
  }
  for (const round of r.rounds) {
    if (!round.logged && played > round.end + r.window) {
      round.logged = true;
      scoreRound(round);
    }
  }
}

// Log a round as one event and show its tally while the music goes on.
// Learn: two solid rounds in a row move to the next stage — from the round
// after the one already queued.
function scoreRound(round) {
  const r = s.run;
  const exp = r.expected.slice(round.from, round.to);
  const hits = exp.filter(e => e.status === 'hit').length;
  const rate = hits / exp.length;
  const offs = exp.filter(e => e.status === 'hit').map(e => e.off);
  const p = s.cell;
  // Times as for a run of its own: from a (virtual) count-in 4 beats
  // before its first note.
  const base = round.start - BEATS * r.beat;
  addEvent({
    v: SCHEMA_VERSION,
    t: Date.now() - Math.round(performance.now() - base),    // wall clock of the round's count-in
    round: s.session,
    game: 'cells',
    mode: s.mode,
    cellId: p.id,
    cell: { name: p.name, quality: p.quality, notes: p.notes },   // the cell — a snapshot: history outlives edits
    exercise: s.exercise,
    reps: round.reps,
    backing: s.backing,               // 'band' | 'root' | 'click'
    cellBeats: s.play.notes.length,   // beats per chord pass: a note a beat — 6 in learn (a b c d c b), 4 else (v1 runs: 4, a cell per bar)
    keys: round.keys,                 // written roots, in order (a shuffle for 'random')
    bpm: s.bpm,
    latency: s.latency,
    calib: s.calib,
    calibOffset: s.calibOffset,
    // Each expected note: [written root pc, degree, semitones above the root
    // (heights), ms after the round's count-in, status, timing offset ms].
    expected: exp.map(e => [e.key, e.deg, e.semis, Math.round(e.t - base), e.status, e.off]),
    // Every note-on during the round: [raw MIDI, ms after its count-in].
    notes: r.notes.map(([m, ms]) => [m, Math.round(r.t0 + ms - base)])
      .filter(([, ms]) => ms >= BEATS * r.beat - r.window && ms <= round.end - base + r.window),
  });
  let note = '';
  if (s.mode === 'learn') {
    s.streak = rate >= SOLID ? s.streak + 1 : 0;
    if (s.streak >= 2 && s.stage < STAGES.length - 1) {
      s.stage++;
      s.streak = 0;
      note = `<br>Solid twice — <b>×${STAGES[s.stage]}</b> on each chord from the next round`;
    } else if (s.streak >= 2) {
      note = '<br><b>Learnt</b> — solid ×1 round the cycle. Time for Practice.';
    } else if (rate >= SOLID) {
      note = `<br><small>solid ${s.streak} of 2 at ×${round.reps}</small>`;
    }
  } else if (rate >= SOLID) {
    note = `<br><b>${EXERCISES[s.exercise].name}</b> — solid.`;
  }
  const mean = offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : null;
  const drift = mean === null || Math.abs(mean) <= 15 ? '' : mean > 0 ? ` · ${mean} ms late on average` : ` · ${-mean} ms early on average`;
  r.phase = 'done';
  message(`<b>${hits} / ${exp.length} right</b>${drift}${note}<br><button id="cellAgain">Play again</button>`);
  $('#cellTitle').textContent = `${EXERCISES[s.exercise].name} · ×${reps()}`;
}
// Play again: the next round, from a count-in (the stage may have moved on).
$('#cellMsg').addEventListener('click', e => { if (e.target.closest('#cellAgain')) restartCells(); });

function message(html) {
  const el = $('#cellMsg');
  el.innerHTML = html;
  el.hidden = !html;
}

// --- The cell, always on top: degrees placed by height ---
// Each degree sits higher the more semitones above the root it is, so
// "5 3 1 5" from the low 5 and from the high 5 look different. Notes from
// `back` on are learn's way back (a b c d | c b), drawn in blue so the
// cell itself stands out (boss, 2026-09-27).
export function cellHTML(p, sel = -1, back = Infinity) {
  const semis = p.notes.map(n => noteSemis(p.quality, n));
  const lo = Math.min(0, ...semis), hi = Math.max(0, ...semis);
  const px = 3;                                     // per semitone
  const h = (hi - lo) * px + 26;
  const notes = p.notes.map((n, i) => {
    const y = (hi - semis[i]) * px;
    return `<span class="cellnote${i === sel ? ' sel' : ''}${i >= back ? ' back' : ''}" data-i="${i}" style="top:${y}px">${degreeLabel(n.deg)}</span>`;
  }).join('');
  // The root's line, for reference.
  return `<div class="cellshape" style="height:${h}px"><i class="cellroot" style="top:${hi * px + 11}px"></i>${notes}</div>`;
}
function showCell(p) {
  $('#cellShow').innerHTML = `<b>${esc(p.name)}</b>${cellHTML(p, -1, s.cell.notes.length)}`;
}

// --- Chord symbols: HTML over the canvas (Real Book notation) ---
// Added round by round as the stream grows.
function addChords(chords) {
  const box = $('#cellChords');
  box.insertAdjacentHTML('beforeend', chords.map(c => `<div class="cellchord">${chordHTML(c.key, s.cell.quality)}</div>`).join(''));
  s.run.chordEls = [...box.children];
}
function clearChords() { $('#cellChords').innerHTML = ''; }

// --- Drawing ---
const canvas = () => $('#cellLane');
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
  if (s.paused) { raf = requestAnimationFrame(frame); return; }   // the stage stays as it was
  // The metronome alone accents each pass of the cell.
  if (s.run.phase === 'running') scheduleBand(s.run, performance.now(), s.bpm, s.backing, k => k % s.run.n === 0);
  expire(performance.now());
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
  // The now line a third in: the notes just played stay in view a while,
  // since that's the only feedback (nothing is shown ahead).
  const nowX = W * 0.34;
  // A note a beat: a cell or two in view ahead.
  const pxBeat = Math.max(46, W * 0.11);
  const x = t => nowX + ((t - now) / r.beat) * pxBeat;
  const cy = H * 0.56, half = 38, gap = 15;
  // Staff: five faint lines.
  g.strokeStyle = 'rgba(217,164,65,.18)';
  g.lineWidth = 1;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(0, cy + k * gap); g.lineTo(W, cy + k * gap); g.stroke(); }
  // Count-in: four dots filling, one per click.
  if (now < r.t0 + BEATS * r.beat) {
    const filled = Math.max(0, Math.min(BEATS, Math.floor((now - r.t0) / r.beat) + 1));
    for (let b = 0; b < BEATS; b++) {
      const dx = W * 0.6 + (b - 1.5) * 30;
      g.beginPath(); g.arc(dx, 18, 8, 0, Math.PI * 2);
      g.fillStyle = b < filled ? '#ffe2a8' : 'transparent'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,226,168,.7)'; g.stroke();
    }
  }
  // No bars: a faint line a beat, stronger where a cell starts, the
  // thickest where the chord changes.
  const first = r.t0 + BEATS * r.beat;
  for (let k = 0; k <= r.beats - BEATS; k++) {
    const tk = first + k * r.beat;
    const bx = x(tk);
    if (bx < -20 || bx > W + 20) continue;
    const change = r.chords.some(ch => Math.abs(ch.t - tk) < 1);
    const cellStart = k % r.n === 0;
    g.strokeStyle = change ? 'rgba(255,226,168,.75)' : cellStart ? 'rgba(217,164,65,.45)' : 'rgba(217,164,65,.14)';
    g.lineWidth = change ? 3 : cellStart ? 1.5 : 1;
    g.beginPath(); g.moveTo(bx, cy - half); g.lineTo(bx, cy + half); g.stroke();
  }
  for (const e of r.expected) {
    const ex = x(e.t);
    if (ex < -20 || ex > W + 20) continue;
    // Slot tick: where a note falls (a beat each).
    g.strokeStyle = 'rgba(217,164,65,.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(ex, cy - 11); g.lineTo(ex, cy + 11); g.stroke();
    g.beginPath(); g.arc(ex, cy, 9, 0, Math.PI * 2);
    if (e.status === 'pending') {
      g.strokeStyle = 'rgba(255,226,168,.45)'; g.lineWidth = 1.5; g.stroke();
    } else {
      g.fillStyle = COLORS[e.status]; g.fill();
      if (e.status === 'hit') {
        // A short glow as it lands.
        const age = now - e.hitAt;
        if (age < 500) {
          g.save(); g.globalCompositeOperation = 'lighter';
          g.fillStyle = `rgba(255,214,130,${0.5 * (1 - age / 500)})`;
          g.beginPath(); g.arc(ex, cy, 9 + 16 * (age / 500), 0, Math.PI * 2); g.fill();
          g.restore();
        }
      }
    }
  }
  // The now line: taller, thicker, bright and glowing, so it stands apart
  // from the beat and chord lines (boss: "hard to distinguish").
  g.save();
  g.shadowColor = 'rgba(255,200,110,.9)';
  g.shadowBlur = 10;
  g.strokeStyle = '#ffe2a8';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(nowX, cy - half - 50); g.lineTo(nowX, cy + half + 26); g.stroke();
  g.restore();
  // Chord symbols above the staff, at their chord change. Only the chord
  // being played (the last one started) is pinned at the left edge; older
  // ones go — at 240 the last one lingered beside it ("B7 B♭7").
  let current = -1;
  r.chords.forEach((ch, i) => { if (ch.t <= now) current = i; });
  r.chordEls?.forEach((el, i) => {
    let cx = x(r.chords[i].t);
    if (i === current) cx = Math.max(cx, 6);
    const vis = i >= current && cx >= 0 && cx < W + 10;
    el.style.display = vis ? '' : 'none';
    if (vis) el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy - half - 44)}px)`;
  });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopCells(); });
