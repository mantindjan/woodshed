// Heatmap (D4): weak spots made visible. A grid of chord quality × degree,
// then a row by root. Each square is rated the way every game rates
// (rating.js): each first attempt scored as the weak-spot picker scores it
// (wrong 0, right 1 → 0.6 as it slows), a score per day, NOW = those days
// weighted by recency (colour and the big figure), BEST = the best day
// (the corner mark). The small figure is the median time of its last
// right answers. Built from the raw event log.

import { QUALITY_ORDER, QUALITY_TEXT, DEGREES, VALID_DEGREES, NOTES, degreeLabel } from './music.js';
import { eventScore } from './weakspots.js';
import { createRating, squareStyle, ratingText } from './rating.js';

const RECENT_TIMES = 20;   // right answers per square for the median time

// Per square: its rating, and the times of its last right answers.
function gather(events) {
  const rating = createRating();
  const times = new Map();
  const add = (key, e, score) => {
    rating.add(key, e.t, score);
    if (!e.ok) return;
    const l = times.get(key) || [];
    l.push(e.notes[0][1]);
    if (l.length > RECENT_TIMES) l.shift();
    times.set(key, l);
  };
  for (const e of events) {
    if (e.game !== 'degrees' || !e.notes || !e.notes.length) continue;
    const score = eventScore(e) ?? 0;
    add(`${e.quality}|${e.degrees[0]}`, e, score);
    add(`root|${e.rootWritten}`, e, score);
    // Per cell + root, for the root row when a cell is selected.
    add(`root|${e.quality}|${e.degrees[0]}|${e.rootWritten}`, e, score);
  }
  const median = key => { const t = [...(times.get(key) || [])].sort((a, b) => a - b); return t.length ? t[t.length >> 1] : null; };
  return { get: key => rating.get(key), median };
}

function cellHTML(r, med, attrs = '', label = '') {
  if (!r) return `<div class="hm-cell empty" ${attrs}>${label}<span>·</span></div>`;
  const { cls, style } = squareStyle(r);
  const time = med === null ? '–' : `${(med / 1000).toFixed(1)}s`;
  return `<div class="hm-cell${cls}" ${attrs}${style}>${label}<b>${Math.round(r.now * 100)}%</b><span>${time}</span></div>`;
}

// Render into `el` from all events. `selected` is a cell key ("m7|3") or
// null: when set, that cell is outlined and the root row shows only that
// quality × degree, so you can see which chords the degree is missed on.
export function renderHeatmap(el, events, selected = null) {
  const g = gather(events);

  let h = '<div class="hm-grid"><div class="hm-corner"></div>';
  h += DEGREES.map(d => `<div class="hm-head">${degreeLabel(d)}</div>`).join('');
  for (const q of QUALITY_ORDER) {
    h += `<div class="hm-row">${QUALITY_TEXT[q]}</div>`;
    for (const d of DEGREES) {
      if (!VALID_DEGREES[q].includes(d)) { h += '<div class="hm-cell na"></div>'; continue; }
      const key = `${q}|${d}`;
      const cls = key === selected ? ' selected' : '';
      h += cellHTML(g.get(key), g.median(key), `data-cell="${key}"`).replace('class="hm-cell', `class="hm-cell${cls}`);
    }
  }
  const [sq, sd] = selected ? selected.split('|') : [];
  h += `</div><div class="hm-sub">By root${selected ? ` · ${QUALITY_TEXT[sq]} ${degreeLabel(sd)}` : ''}</div>`;
  h += '<div class="hm-roots">';
  for (let r = 0; r < 12; r++) {
    const key = selected ? `root|${selected}|${r}` : `root|${r}`;
    h += cellHTML(g.get(key), g.median(key), `data-root="${r}"`, `<i>${NOTES[r]}</i>`);
  }
  // The selected square in words.
  const cap = selected ? `${QUALITY_TEXT[sq]} ${degreeLabel(sd)} — ${ratingText(g.get(selected), { timing: false })}`
    : 'Tap a square: now (colour), best day (corner), how much.';
  el.innerHTML = h + `</div><div class="rm-cap">${cap}</div>`;
}
