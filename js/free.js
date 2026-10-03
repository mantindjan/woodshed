// Free (boss, 2026-10-03): the lane games' third mode, before Learn — to
// kickstart a scale or a chord not known yet. "Set a tempo, tick, tick,
// tick … I see the time, I see the notes I'm playing … red when it's not
// right … at the end I see how my mistakes are."
//
// Nothing is laid out ahead and nothing stops: the click runs at the set
// tempo (eighths are the grid, as everywhere in the lane games), the player
// plays the level's scale or chord any way — top to bottom, a fragment,
// the same three notes again — and each note lands on a timeline scrolling
// past a now line, at its time and height, labelled with its degree:
//   gold   — in the scale/chord and the pattern's next step from the last
//            note (the level's pattern: in a thirds level a third is the
//            step; either direction the pattern goes)
//   amber  — in it, but a jump (skipped, lost the pattern)
//   red    — not in it, labelled with what it is ("♭7", "♮3")
// A reference ladder on the left shows the notes (degree big, name small),
// always on — the point is a chord not known yet. One key at a time (drawn
// like the other modes — weak keys or random), until Next key.
//
// Stop gives the read per key (readTake): in key, on the pattern, in time
// (and rushing/dragging by direction), the wrong notes with what was
// meant, where the pattern breaks. Each key's take is logged as one event
// (mode 'free', no `expected`): every rating, tempo and key-weight reader
// keys off `expected`, so a take moves none of them — it's a warm-up.

import { SCALES, SAX_RANGE, NOTES, QUALITY_TEXT, pc } from './music.js';
import { initAudio, click, audioTimeAt, stopAll } from './audio.js';
import { addEvent, requestPersistence } from './events.js';
import { pickScaleKey, PATTERNS } from './scalelevels.js';

const SCHEMA_VERSION = 13;     // free takes: `played` judged, no `expected` (docs/data.md)
const PER_BEAT = 2;            // the grid: eighths, two per click
const ON_BEAT_MS = 100;        // in time = within this of an eighth (narrowed at fast tempos)
const GLITCH_MS = 80;          // a note replaced this fast was the horn's in-between note (scales.js)
const PHRASE_GAP_BEATS = 2;    // after this much silence the next note starts afresh (not judged as a step)
const HISTORY_BEATS = 7;       // the timeline shows this many beats behind the now line
const ROWS = 11;               // scale notes in view; the view follows the playing
const LADDER_W = 64;           // the reference ladder's width (px)

const $ = sel => document.querySelector(sel);

// Every written note of `scale` in key `key` (pc) within the sax range, low to high.
export function scaleNotes(scale, key) {
  const out = [];
  for (let w = SAX_RANGE.low; w <= SAX_RANGE.high; w++) if (SCALES[scale].steps.includes(pc(w - key))) out.push(w);
  return out;
}

// A note's degree in the key. In the scale/chord: its own label. Outside:
// the chromatic name from the root, and where the scale has that number at
// another pitch, ♮ marks the raised one ("♮3" on a minor chord, "♮7" on a
// dominant), so a red label never reads like a gold one.
const CHROMA = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
export function degreeLabel(scale, key, w) {
  const sc = SCALES[scale];
  const semi = pc(w - key);
  const i = sc.steps.indexOf(semi);
  if (i >= 0) return sc.degrees[i];
  const name = CHROMA[semi];
  return /^\d/.test(name) && sc.degrees.includes(name) ? `♮${name}` : name;
}

// The level's pattern as the set of moves it makes between scale positions
// ("from>to"): every consecutive pair of its corner-to-corner path, from
// every start it allows. A played move in the set is a step; a move in the
// scale but not in the set is a jump.
export function patternMoves(scale, pattern, key) {
  const notes = scaleNotes(scale, key);
  const P = PATTERNS[pattern];
  const moves = new Set();
  for (let i = 0; i < notes.length; i++) {
    if (P.rootOnly && pc(notes[i] - key) !== 0) continue;
    const idx = P.indices(i, notes.length, notes);
    for (let j = 1; j < idx.length; j++) moves.add(`${idx[j - 1]}>${idx[j]}`);
  }
  return moves;
}

// Judge one played note against the last one kept (`prev`, or null): its
// kind, degree label, and its offset from the nearest eighth of the grid.
// `t` is when it was played (latency taken off), on the page clock.
export function judge(ctx, prev, w, t) {
  const { scale, key, notes, moves, t0, step } = ctx;
  const idx = notes.indexOf(w);
  const slot = Math.round((t - t0) / step);
  const off = Math.round(t - (t0 + slot * step));
  let kind;
  if (idx < 0) kind = 'wrong';
  else if (!prev || t - prev.t > PHRASE_GAP_BEATS * step * PER_BEAT) kind = 'start';
  else if (prev.idx === idx) kind = 'repeat';
  else kind = moves.has(`${prev.idx}>${idx}`) ? 'step' : 'jump';
  return { w, t, idx, kind, off, deg: degreeLabel(scale, key, w),
           dir: prev && idx >= 0 && idx !== prev.idx ? Math.sign(idx - prev.idx) : 0 };
}

// --- The read: a take (one key's notes) summed up for the recap ---
const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function readTake(take, scale, pattern, key, step) {
  const p = take.played;
  const inKey = p.filter(x => x.kind !== 'wrong');
  const moves = p.filter(x => x.kind === 'step' || x.kind === 'jump');
  const window = Math.min(ON_BEAT_MS, step * 0.3);
  // Rushing (early) / dragging (late) by direction: the mean offset of the
  // notes played going up, and going down, when there are enough of them.
  const lean = dir => {
    const offs = inKey.filter(x => x.dir === dir).map(x => x.off);
    if (offs.length < 4) return null;
    const m = mean(offs);
    return Math.abs(m) < 25 ? null : `${m < 0 ? 'rushing' : 'dragging'} on the way ${dir > 0 ? 'up' : 'down'} (${m > 0 ? '+' : '−'}${Math.abs(Math.round(m))} ms)`;
  };
  // Wrong notes, with what was meant: the scale note a semitone away — if
  // both neighbours are, the one that would have been the pattern's step.
  const notes = scaleNotes(scale, key);
  const moveSet = patternMoves(scale, pattern, key);
  const wrongs = new Map();
  p.forEach((x, i) => {
    if (x.kind !== 'wrong') return;
    const near = [x.w - 1, x.w + 1].filter(n => notes.includes(n));
    const prevIdx = p.slice(0, i).reverse().find(y => y.idx >= 0)?.idx;
    const meant = near.length === 1 ? near[0]
      : near.find(n => prevIdx !== undefined && moveSet.has(`${prevIdx}>${notes.indexOf(n)}`)) ?? null;
    const k = `${pc(x.w)}|${meant === null ? '' : pc(meant)}`;
    const e = wrongs.get(k) || { played: pc(x.w), meant: meant === null ? null : pc(meant), deg: meant === null ? null : degreeLabel(scale, key, meant), n: 0 };
    e.n++;
    wrongs.set(k, e);
  });
  // Where the pattern breaks: jumps by the degrees they went between.
  const breaks = new Map();
  p.forEach((x, i) => {
    if (x.kind !== 'jump') return;
    const prev = p.slice(0, i).reverse().find(y => y.idx >= 0);
    const k = `${prev.deg} → ${x.deg}`;
    breaks.set(k, (breaks.get(k) || 0) + 1);
  });
  return {
    key, notes: p.length,
    inKey: pct(inKey.length, p.length),
    onPattern: pct(moves.filter(x => x.kind === 'step').length, moves.length),
    inTime: pct(inKey.filter(x => Math.abs(x.off) <= window).length, inKey.length),
    lean: [lean(1), lean(-1)].filter(Boolean),
    wrongs: [...wrongs.values()].sort((a, b) => b.n - a.n).slice(0, 3),
    breaks: [...breaks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([move, n]) => ({ move, n })),
  };
}

// --- The session ---
let s = null;
let raf = 0;
let wakeLock = null;

export const freeRunning = () => s !== null;
export const freePaused = () => !!s?.paused;

// opts: {game, exercise: {id, scale, pattern, keys}, pick, model (the weak-
// key model: it draws the key, a take never feeds it), bpm, calib,
// calibOffset, latency}. onEnd(recap) on Stop.
export function startFree(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, scale: opts.exercise.scale, pattern: opts.exercise.pattern, keys: opts.exercise.keys, onEnd,
        session: Date.now().toString(36), takes: [], take: null, paused: null, cam: null };
  startGrid(performance.now() + 400);
  newTake(pickScaleKey(s.model, { scale: s.scale, pattern: s.pattern, keys: s.keys, pick: s.pick, prev: null }));
  resize();
  message('<b>Free</b> — the click runs; play it any way. Stop for the read.');
  raf = requestAnimationFrame(frame);
}

// The click grid: beat 0 at t0; clicks are queued just ahead in frame().
function startGrid(t0) {
  s.beat = 60000 / s.bpm;
  s.step = s.beat / PER_BEAT;
  s.t0 = t0;
  s.nextBeat = 0;
}

function newTake(key) {
  const notes = scaleNotes(s.scale, key);
  s.take = { key, notes, moves: patternMoves(s.scale, s.pattern, key), played: [], raw: [], wall: Date.now(), t0: s.t0 };
  // The view starts a few notes above the lowest root.
  const root = notes.findIndex(w => pc(w - key) === 0);
  s.cam = Math.min(notes.length - 1, Math.max(0, root) + (ROWS >> 1) - 1);
  topBar();
}

// Log the take (if anything was played) and keep its read for the recap.
function endTake() {
  const tk = s.take;
  if (!tk || !tk.played.length) return;
  s.takes.push(readTake(tk, s.scale, s.pattern, tk.key, s.step));
  addEvent({
    v: SCHEMA_VERSION,
    t: tk.wall,
    round: s.session,
    game: s.game,
    mode: 'free',
    exercise: s.exercise.id,
    scale: s.scale,
    keyWritten: tk.key,
    pattern: s.pattern,
    bpm: s.bpm,
    perBeat: PER_BEAT,
    latency: s.latency,
    calib: s.calib,
    calibOffset: s.calibOffset,
    // Each note kept, as judged: [written pitch, ms after the take began
    // (latency taken off), kind (start/step/jump/repeat/wrong), ms off the
    // nearest eighth].
    played: tk.played.map(x => [x.w, Math.round(x.t - tk.t0), x.kind, x.off]),
    notes: tk.raw,                    // every note-on: [raw MIDI, ms after the take began], as received
  });
}

export function freeNote(midi) {
  if (!s || s.paused) return;
  const arrived = performance.now();
  const tk = s.take;
  tk.raw.push([midi, Math.round(arrived - tk.t0)]);
  const t = arrived - s.latency;
  const w = midi - s.calibOffset;
  // Within GLITCH_MS of the last note: the same pitch again is the horn's
  // double send (more than half of all note-ons, docs/data.md) — ignored;
  // another pitch means the last was its in-between note — replaced.
  const last = tk.played[tk.played.length - 1];
  if (last && t - last.t < GLITCH_MS) {
    if (last.w === w) return;
    tk.played.pop();
  }
  // Steps are judged from the last note IN the scale: a slip and its
  // correction shouldn't turn the next note into a jump.
  const prev = [...tk.played].reverse().find(x => x.kind !== 'wrong') || null;
  const x = judge({ scale: s.scale, key: tk.key, notes: tk.notes, moves: tk.moves, t0: s.t0, step: s.step }, prev, w, t);
  x.at = arrived;
  tk.played.push(x);
  message('');
}

export function freeNextKey() {
  if (!s) return;
  endTake();
  newTake(pickScaleKey(s.model, { scale: s.scale, pattern: s.pattern, keys: s.keys, pick: s.pick, prev: s.take.key }));
}

// Pause: the click stops and the stage freezes. Resume: everything shifts
// by the time paused, so the picture carries on where it was — on a new
// tempo (set while paused) the grid starts afresh a beat on.
export function pauseFree() {
  if (!s || s.paused) return;
  stopAll();
  s.paused = { at: performance.now(), bpm: s.bpm };
  message('<b>Paused</b> — ▶ to carry on; the tempo can change now');
  document.dispatchEvent(new Event('woodshed:pause'));
}
export function resumeFree() {
  if (!s?.paused) return;
  const now = performance.now();
  const gap = now - s.paused.at;
  for (const x of s.take.played) { x.t += gap; x.at += gap; }
  s.take.t0 += gap;
  if (s.bpm !== s.paused.bpm) startGrid(now + 60000 / s.bpm);
  else { s.t0 += gap; }
  s.paused = null;
  message('');
  document.dispatchEvent(new Event('woodshed:pause'));
}
// ↻: this key's take starts over, unlogged; the grid too.
export function restartFree() {
  if (!s) return;
  stopAll();
  s.paused = null;
  startGrid(performance.now() + 400);
  newTake(s.take.key);
  message('');
}
// The tempo, set while paused (the tempo strip; main.js opens it then).
export function setFreeBpm(v) {
  if (!s?.paused) return;
  s.bpm = v;
  topBar();
}

export function stopFree() {
  if (!s) return;
  endTake();
  cancelAnimationFrame(raf);
  stopAll();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  const { onEnd, takes, bpm, scale, pattern } = s;
  const recap = takes.length ? { free: true, takes, bpm, scale, pattern } : null;
  s = null;
  topBar();
  message('');
  $('#scaleNext').hidden = true;
  const c = canvas();
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  onEnd(recap);
}

// --- Stage ---
function what(k) {
  const q = SCALES[s.scale].chord;
  return q ? `${NOTES[k]}${QUALITY_TEXT[q]}` : `${NOTES[k]} ${SCALES[s.scale].name.toLowerCase()}`;
}
function topBar() {
  $('#scaleKey').textContent = s ? what(s.take.key) : '';
  $('#scalePattern').textContent = s ? `free · ${PATTERNS[s.pattern].chip.toLowerCase()}` : '';
  $('#scaleBpm').textContent = s ? s.bpm : '';
  $('#scaleBpmNote').textContent = s ? 'bpm' : '';
  $('#scaleInfo').textContent = '';
  $('#scaleNext').hidden = !s || s.keys.length < 2;
  for (const id of ['#scaleOwn', '#scaleHint', '#scaleNudge', '#scaleLoop']) $(id).hidden = true;
}
function message(html) {
  const el = $('#scaleMsg');
  el.classList.remove('tally');
  el.innerHTML = html;
  el.hidden = !html;
}

const canvas = () => $('#lane');
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
  const now = s.paused ? s.paused.at : performance.now();
  if (!s.paused) {
    // Clicks queued a quarter second ahead, heard on the beat (audioTimeAt).
    while (s.t0 + s.nextBeat * s.beat < now + 250) {
      const tb = s.t0 + s.nextBeat * s.beat;
      if (tb >= now - 20) click(audioTimeAt(tb), s.nextBeat % 4 === 0);
      s.nextBeat++;
    }
  }
  draw(now);
  raf = requestAnimationFrame(frame);
}

// Scale position of a written pitch: its index, or between its neighbours.
function posOf(notes, w) {
  const i = notes.indexOf(w);
  if (i >= 0) return i;
  const hi = notes.findIndex(n => n > w);
  if (hi <= 0) return hi === 0 ? -0.5 : notes.length - 0.5;
  return hi - 0.5;
}

const KIND_COLOR = { step: '#ffe2a8', start: '#d9a441', repeat: '#d9a441', jump: '#e8933a', wrong: '#d65a5a' };
function draw(now) {
  const c = canvas();
  const g = c.getContext('2d');
  const W = c.clientWidth, H = c.clientHeight;
  g.clearRect(0, 0, W, H);
  const tk = s.take;
  const notes = tk.notes;
  // The view follows the last few notes played (smoothly), else stays put.
  const recent = tk.played.slice(-4).map(x => posOf(notes, x.w));
  if (recent.length) {
    const target = Math.min(notes.length - 1 - (ROWS >> 1) + 1, Math.max((ROWS >> 1) - 1, mean(recent)));
    s.cam += (target - s.cam) * 0.08;
  }
  const rowH = H / ROWS;
  const y = pos => H / 2 - (pos - s.cam) * rowH;
  const nowX = LADDER_W + (W - LADDER_W) * 0.8;
  const pxPerMs = (nowX - LADDER_W) / (HISTORY_BEATS * s.beat);
  const x = t => nowX + (t - now) * pxPerMs;

  // Rows: a faint line per scale note, the roots banded in gold.
  for (let i = Math.floor(s.cam - ROWS / 2); i <= Math.ceil(s.cam + ROWS / 2); i++) {
    if (i < 0 || i >= notes.length) continue;
    const yy = y(i);
    const root = pc(notes[i] - tk.key) === 0;
    g.fillStyle = root ? 'rgba(217,164,65,.10)' : 'rgba(255,255,255,.03)';
    g.fillRect(LADDER_W, yy - rowH / 2 + 1, W - LADDER_W, rowH - 2);
    // The ladder: degree big, note name small (always on in Free).
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.fillStyle = root ? '#ffe2a8' : '#d8d2c4';
    g.font = `700 ${Math.min(18, rowH * 0.62)}px system-ui, sans-serif`;
    g.fillText(degreeLabel(s.scale, tk.key, notes[i]), 30, yy);
    g.textAlign = 'left';
    g.fillStyle = '#8d8778';
    g.font = `500 ${Math.min(12, rowH * 0.45)}px system-ui, sans-serif`;
    g.fillText(NOTES[pc(notes[i])], 36, yy);
  }

  // Beat lines (bars stronger) and the eighths between them, faint.
  const first = Math.floor((now - HISTORY_BEATS * s.beat - s.t0) / s.step);
  const last = Math.ceil((now + (W - nowX) / pxPerMs - s.t0) / s.step);
  for (let j = Math.max(first, 0); j <= last; j++) {
    const xx = x(s.t0 + j * s.step);
    if (xx < LADDER_W) continue;
    const beat = j % PER_BEAT === 0;
    const bar = beat && (j / PER_BEAT) % 4 === 0;
    g.fillStyle = bar ? 'rgba(255,255,255,.22)' : beat ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)';
    g.fillRect(xx, 0, bar ? 2 : 1, H);
  }
  // Ahead of the now line: dimmed — nothing is there yet.
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(nowX, 0, W - nowX, H);
  g.fillStyle = '#d9a441';
  g.fillRect(nowX - 1, 0, 2, H);

  // The notes played: discs at their time and height. Off the grid by more
  // than the in-time window, a thin line shows where the eighth was.
  const rad = Math.min(rowH * 0.42, 14);
  const window = Math.min(ON_BEAT_MS, s.step * 0.3);
  g.textAlign = 'center';
  for (const n of tk.played) {
    const xx = x(n.t);
    if (xx < LADDER_W - rad) continue;
    const yy = y(posOf(notes, n.w));
    if (Math.abs(n.off) > window && n.kind !== 'wrong') {
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx - n.off * pxPerMs, yy); g.stroke();
    }
    g.fillStyle = KIND_COLOR[n.kind];
    g.beginPath(); g.arc(xx, yy, rad, 0, Math.PI * 2); g.fill();
    g.fillStyle = n.kind === 'wrong' ? '#fff' : '#1a1206';
    g.font = `700 ${n.deg.length > 1 ? rad * 0.95 : rad * 1.2}px system-ui, sans-serif`;
    g.fillText(n.deg, xx, yy + 1);
  }
}
