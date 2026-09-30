// Range map (E1 step 3): for one level (scale × pattern — the caller passes
// only that level's runs), how clean each note is, per key. Two views:
// 'range' = key (12 rows, plus all keys pooled) × written pitch (low B♭ 58
// → high F♯ 90); 'degrees' = key × scale degree, all octaves pooled (boss,
// 2026-09-25: "which degree is wrong"). Each square is rated the way every
// game rates (rating.js): each time its note came up scored (hit on the
// beat 1, sliding to 0.6 at the edge of the hit window; wrong or missed 0),
// a score per day, NOW weighted by recency (colour), BEST the best day
// (corner mark) — so "clean low, falls apart above the break" shows as a
// colour change along the row. Built from the raw `expected` arrays of the
// lane games' events (docs/data.md).

import { SCALES, SAX_RANGE, NOTES, pc, noteName, inMiddle } from './music.js';
import { createRating, timedScore, squareStyle, ratingText } from './rating.js';

// Every square's rating. Keys: "<keyPc>|<column>" and "all|<column>", the
// column being the written pitch ('range') or the degree ('degrees'). Notes
// never reached in a stopped run stay 'pending' and are not evidence
// either way. Expected rows: [written, ms, degree, status, offset].
function rate(events, view) {
  const rating = createRating();
  for (const e of events) {
    if (!e.expected || e.falseStart) continue;       // the caller passes one level's runs
    for (const x of e.expected) {
      if (x[3] === 'pending') continue;
      const hit = x[3] === 'hit';
      const col = view === 'range' ? x[0] : x[2];
      for (const k of [`${e.keyWritten}|${col}`, `all|${col}`]) rating.add(k, e.t, timedScore(hit, x[4]), hit ? x[4] : null);
    }
  }
  return rating;
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
  const rating = rate(events, view);
  const steps = SCALES[scale].steps;
  const cols = view === 'range' ? PITCHES : SCALES[scale].degrees;
  const note = rowNote ? ' 30px' : '';
  let h = `<div class="rm-grid ${view}" style="grid-template-columns: 28px repeat(${cols.length}, 1fr)${note}"><div></div>`;
  // Column heads: in the range view only the Cs, so the octaves read
  // without clutter; in the degree view every degree.
  // The horn's extremes (below low C, above high D — music.js HORN_MIDDLE)
  // are shaded: shown in full, but they don't hold progress back.
  const edge = c => (view === 'range' && !inMiddle(c) ? ' edge' : '');
  h += cols.map(c => `<div class="rm-head${edge(c)}">${view === 'degrees' ? c : pc(c) === 0 ? noteName(c) : ''}</div>`).join('');
  if (rowNote) h += '<div class="rm-head rm-bpm">bpm</div>';
  const rows = [['all', 'All'], ...NOTES.map((n, k) => [String(k), n])];
  for (const [rk, label] of rows) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (const c of cols) {
      // Range view: in a key's row only its scale notes get a cell; the pooled row takes all.
      if (view === 'range' && rk !== 'all' && !steps.includes(pc(c - Number(rk)))) { h += `<div class="rm-cell na${edge(c)}"></div>`; continue; }
      const key = `${rk}|${c}`;
      const sq = squareStyle(rating.get(key));
      h += `<div class="rm-cell${sq.cls}${edge(c)}${key === selected ? ' selected' : ''}" data-cell="${key}"${sq.style}></div>`;
    }
    if (rowNote) h += `<div class="rm-bpm${rk === 'all' ? ' all' : ''}">${rowNote(rk)}</div>`;
  }
  h += '</div>';
  // Caption: the selected cell in words, or how to use the map.
  let cap = view === 'range' ? 'Tap a square: now (colour), best day (corner), timing. Shaded: the horn’s extremes — below low C, above high D.'
    : 'Tap a square: now (colour), best day (corner), timing.';
  if (selected) {
    const [rk, c] = selected.split('|');
    const note = view === 'range' ? noteName(Number(c)) : `the ${c}`;
    const where = `${rk === 'all' ? 'All keys' : `${NOTES[Number(rk)]} ${SCALES[scale].name.toLowerCase()}`} · ${note}`;
    const extreme = view === 'range' && !inMiddle(Number(c)) ? ' (an extreme: not counted toward tempo)' : '';
    cap = `${where}${extreme} — ${ratingText(rating.get(selected))}`;
  }
  el.innerHTML = h + `<div class="rm-cap">${cap}</div>`;
}
