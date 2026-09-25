// Range map (E1 step 3): for one scale, how clean each part of the horn's
// range is, per key. A grid of key (12 rows, plus all keys pooled) × written
// pitch (low B♭ 58 → high F♯ 90). Each cell covers the last RECENT times
// that note came up in a run of that key: coloured by the mean per-note
// score (hit on the beat 1, sliding to 0.6 at the edge of the hit window;
// wrong or missed 0), so "clean low, falls apart above the break" shows as
// a colour change along the row. Built from the raw `expected` arrays of
// scales events (docs/data.md).

import { SCALES, SAX_RANGE, NOTES, pc, noteName } from './music.js';

const RECENT = 10;         // occurrences per cell
const WINDOW_MS = 150;     // the widest hit window (scales.js MAX_WINDOW_MS)
const LATE_FLOOR = 0.6;    // a hit at the window's edge still scores this

// One expected note's score: [written, ms, degree, status, offset].
export function noteScore([, , , status, off]) {
  if (status !== 'hit') return 0;
  return 1 - (1 - LATE_FLOOR) * Math.min(Math.abs(off || 0), WINDOW_MS) / WINDOW_MS;
}

// key → [{hit, off, score}] newest last, capped. Keys: "<keyPc>|<written>"
// and "all|<written>". Notes never reached in a stopped run stay 'pending'
// and are not evidence either way.
function recentNotes(events, scale) {
  const byKey = new Map();
  const push = (k, a) => {
    const list = byKey.get(k) || [];
    list.push(a);
    if (list.length > RECENT) list.shift();
    byKey.set(k, list);
  };
  for (const e of events) {
    if (e.game !== 'scales' || e.scale !== scale || !e.expected) continue;
    for (const x of e.expected) {
      if (x[3] === 'pending') continue;
      const a = { hit: x[3] === 'hit', off: x[4], score: noteScore(x) };
      push(`${e.keyWritten}|${x[0]}`, a);
      push(`all|${x[0]}`, a);
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
function colour(score) {
  const hue = Math.round(120 * Math.max(0, Math.min(1, (score - 0.4) / 0.6)));
  return `hsl(${hue} 55% 38%)`;
}

const PITCHES = [];
for (let w = SAX_RANGE.low; w <= SAX_RANGE.high; w++) PITCHES.push(w);

// Render into `el`. `selected` = a cell key ("3|70" / "all|70") or null; the
// selected cell is outlined and described in the caption (name, hits, timing).
export function renderRangeMap(el, events, scale, selected = null) {
  const recent = recentNotes(events, scale);
  const steps = SCALES[scale].steps;
  let h = '<div class="rm-grid"><div></div>';
  // Column heads: only the Cs, so the octaves read without clutter.
  h += PITCHES.map(w => `<div class="rm-head">${pc(w) === 0 ? noteName(w) : ''}</div>`).join('');
  const rows = [['all', 'All'], ...NOTES.map((n, k) => [String(k), n])];
  for (const [rk, label] of rows) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (const w of PITCHES) {
      // In a key's row only its scale notes get a cell; the pooled row takes all.
      if (rk !== 'all' && !steps.includes(pc(w - Number(rk)))) { h += '<div class="rm-cell na"></div>'; continue; }
      const key = `${rk}|${w}`;
      const fig = figures(recent.get(key));
      const cls = `rm-cell${fig ? '' : ' empty'}${key === selected ? ' selected' : ''}`;
      const style = fig ? ` style="background:${colour(fig.score)}"` : '';
      h += `<div class="${cls}" data-cell="${key}"${style}></div>`;
    }
  }
  h += '</div>';
  // Caption: the selected cell in words, or how to use the map.
  let cap = 'Tap a cell: which note, how often hit, early or late.';
  if (selected) {
    const [rk, w] = selected.split('|');
    const fig = figures(recent.get(selected));
    const where = `${rk === 'all' ? 'All keys' : `${NOTES[Number(rk)]} ${SCALES[scale].name.toLowerCase()}`} · ${noteName(Number(w))}`;
    cap = !fig ? `${where} — not played yet.`
      : `${where} — ${fig.hits} of ${fig.n} hit` +
        (fig.off === null ? '' : fig.off > 15 ? ` · ${fig.off} ms late` : fig.off < -15 ? ` · ${-fig.off} ms early` : ' · on the beat');
  }
  el.innerHTML = h + `<div class="rm-cap">${cap}</div>`;
}
