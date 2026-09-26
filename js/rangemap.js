// Range map (E1 step 3): for one level (scale × pattern — the caller passes
// only that level's runs), how clean each note is, per key. Two views:
// 'range' = key (12 rows, plus all keys pooled) × written pitch (low B♭ 58
// → high F♯ 90); 'degrees' = key × scale degree, all octaves pooled (boss,
// 2026-09-25: "which degree is wrong"). Each cell covers the last RECENT
// times that note came up in a run of that key: coloured by the mean per-note
// score (hit on the beat 1, sliding to 0.6 at the edge of the hit window;
// wrong or missed 0), so "clean low, falls apart above the break" shows as
// a colour change along the row. Built from the raw `expected` arrays of
// scales events (docs/data.md).

import { SCALES, SAX_RANGE, NOTES, pc, noteName } from './music.js';

// Occurrences per cell. A degree comes up in every octave of a run, so its
// cell fills about twice as fast; it keeps twice as many to stay as recent.
const RECENT = { range: 10, degrees: 20 };
const WINDOW_MS = 150;     // the widest hit window (scales.js MAX_WINDOW_MS)
const LATE_FLOOR = 0.6;    // a hit at the window's edge still scores this

// One expected note's score: [written, ms, degree, status, offset].
export function noteScore([, , , status, off]) {
  if (status !== 'hit') return 0;
  return 1 - (1 - LATE_FLOOR) * Math.min(Math.abs(off || 0), WINDOW_MS) / WINDOW_MS;
}

// key → [{hit, off, score}] newest last, capped. Keys: "<keyPc>|<column>"
// and "all|<column>", the column being the written pitch ('range') or the
// degree ('degrees'). Notes never reached in a stopped run stay 'pending'
// and are not evidence either way.
function recentNotes(events, view) {
  const byKey = new Map();
  const push = (k, a) => {
    const list = byKey.get(k) || [];
    list.push(a);
    if (list.length > RECENT[view]) list.shift();
    byKey.set(k, list);
  };
  for (const e of events) {
    if (e.game !== 'scales' || !e.expected || e.falseStart) continue;
    for (const x of e.expected) {
      if (x[3] === 'pending') continue;
      const a = { hit: x[3] === 'hit', off: x[4], score: noteScore(x) };
      const col = view === 'range' ? x[0] : x[2];
      push(`${e.keyWritten}|${col}`, a);
      push(`all|${col}`, a);
    }
  }
  return byKey;
}

export function figures(list) {
  if (!list || !list.length) return null;
  const hits = list.filter(a => a.hit);
  const off = hits.length ? Math.round(hits.reduce((s, a) => s + a.off, 0) / hits.length) : null;
  return { n: list.length, hits: hits.length, off,
           score: list.reduce((s, a) => s + a.score, 0) / list.length };
}

// Same ramp as the degree heatmap: ≤ 0.4 red … 1 green.
export function colour(score) {
  const hue = Math.round(120 * Math.max(0, Math.min(1, (score - 0.4) / 0.6)));
  return `hsl(${hue} 55% 38%)`;
}

const PITCHES = [];
for (let w = SAX_RANGE.low; w <= SAX_RANGE.high; w++) PITCHES.push(w);

// Render into `el`. `events` = the level's runs; `scale` names its degrees;
// `view` = 'range' | 'degrees'. `selected` = a cell key ("3|70" / "all|70",
// or "3|5" in the degree view) or null; the selected cell is outlined and
// described in the caption (name, hits, timing).
// `rowNote(rowKey)` (optional): text for a last column per row — the key's
// auto tempo, from the caller.
export function renderRangeMap(el, events, scale, view = 'range', selected = null, rowNote = null) {
  const recent = recentNotes(events, view);
  const steps = SCALES[scale].steps;
  const cols = view === 'range' ? PITCHES : SCALES[scale].degrees;
  const note = rowNote ? ' 30px' : '';
  let h = `<div class="rm-grid ${view}" style="grid-template-columns: 28px repeat(${cols.length}, 1fr)${note}"><div></div>`;
  // Column heads: in the range view only the Cs, so the octaves read
  // without clutter; in the degree view every degree.
  h += cols.map(c => `<div class="rm-head">${view === 'degrees' ? c : pc(c) === 0 ? noteName(c) : ''}</div>`).join('');
  if (rowNote) h += '<div class="rm-head rm-bpm">bpm</div>';
  const rows = [['all', 'All'], ...NOTES.map((n, k) => [String(k), n])];
  for (const [rk, label] of rows) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (const c of cols) {
      // Range view: in a key's row only its scale notes get a cell; the pooled row takes all.
      if (view === 'range' && rk !== 'all' && !steps.includes(pc(c - Number(rk)))) { h += '<div class="rm-cell na"></div>'; continue; }
      const key = `${rk}|${c}`;
      const fig = figures(recent.get(key));
      const cls = `rm-cell${fig ? '' : ' empty'}${key === selected ? ' selected' : ''}`;
      const style = fig ? ` style="background:${colour(fig.score)}"` : '';
      h += `<div class="${cls}" data-cell="${key}"${style}></div>`;
    }
    if (rowNote) h += `<div class="rm-bpm${rk === 'all' ? ' all' : ''}">${rowNote(rk)}</div>`;
  }
  h += '</div>';
  // Caption: the selected cell in words, or how to use the map.
  let cap = 'Tap a cell: which note, how often hit, early or late.';
  if (selected) {
    const [rk, c] = selected.split('|');
    const fig = figures(recent.get(selected));
    const note = view === 'range' ? noteName(Number(c)) : `the ${c}`;
    const where = `${rk === 'all' ? 'All keys' : `${NOTES[Number(rk)]} ${SCALES[scale].name.toLowerCase()}`} · ${note}`;
    cap = !fig ? `${where} — not played yet.`
      : `${where} — ${fig.hits} of ${fig.n} hit` +
        (fig.off === null ? '' : fig.off > 15 ? ` · ${fig.off} ms late` : fig.off < -15 ? ` · ${-fig.off} ms early` : ' · on the beat');
  }
  el.innerHTML = h + `<div class="rm-cap">${cap}</div>`;
}
