// Heatmap (D4): weak spots made visible. A grid of chord quality × degree,
// then a row by root. Each cell covers its last RECENT answers: coloured by
// their mean score (the same per-answer accuracy + speed score the weak-spot
// picker uses: wrong 0, right 1 → 0.6 as it slows) from red (weak) to green
// (strong), showing first-try accuracy and median right-answer time. Built
// from the raw event log.

import { QUALITY_ORDER, QUALITY_TEXT, DEGREES, VALID_DEGREES, NOTES, degreeLabel } from './music.js';
import { eventScore } from './weakspots.js';

const RECENT = 20;   // answers per cell for the accuracy/median figures

// Per-key recent answers: key → [{ok, ms}] (newest last, capped).
function recentAnswers(events) {
  const byKey = new Map();
  const push = (key, a) => {
    const list = byKey.get(key) || [];
    list.push(a);
    if (list.length > RECENT) list.shift();
    byKey.set(key, list);
  };
  for (const e of events) {
    if (e.game !== 'degrees' || !e.notes || !e.notes.length) continue;
    const a = { ok: !!e.ok, ms: e.notes[0][1], score: eventScore(e) ?? 0 };
    push(`${e.quality}|${e.degrees[0]}`, a);
    push(`root|${e.rootWritten}`, a);
    // Per cell + root, for the root row when a cell is selected.
    push(`root|${e.quality}|${e.degrees[0]}|${e.rootWritten}`, a);
  }
  return byKey;
}

function figures(list) {
  if (!list || !list.length) return null;
  const ok = list.filter(a => a.ok);
  const t = ok.map(a => a.ms).sort((a, b) => a - b);
  return {
    n: list.length,
    acc: ok.length / list.length,
    median: t.length ? t[t.length >> 1] : null,
    score: list.reduce((sum, a) => sum + a.score, 0) / list.length,
  };
}

// Score 0..1 → colour from red through amber to green.
function colour(score) {
  const hue = Math.round(120 * Math.max(0, Math.min(1, (score - 0.4) / 0.6)));   // ≤0.4 red … 1 green
  return `hsl(${hue} 55% 38%)`;
}

function cellHTML(fig, attrs = '', label = '') {
  if (!fig) return `<div class="hm-cell empty" ${attrs}>${label}<span>·</span></div>`;
  const time = fig.median === null ? '–' : `${(fig.median / 1000).toFixed(1)}s`;
  return `<div class="hm-cell" ${attrs} style="background:${colour(fig.score)}">${label}` +
    `<b>${Math.round(fig.acc * 100)}%</b><span>${time}</span></div>`;
}

// Render into `el` from all events. `selected` is a cell key ("m7|3") or
// null: when set, that cell is outlined and the root row shows only that
// quality × degree, so you can see which chords the degree is missed on.
export function renderHeatmap(el, events, selected = null) {
  const recent = recentAnswers(events);

  let h = '<div class="hm-grid"><div class="hm-corner"></div>';
  h += DEGREES.map(d => `<div class="hm-head">${degreeLabel(d)}</div>`).join('');
  for (const q of QUALITY_ORDER) {
    h += `<div class="hm-row">${QUALITY_TEXT[q]}</div>`;
    for (const d of DEGREES) {
      if (!VALID_DEGREES[q].includes(d)) { h += '<div class="hm-cell na"></div>'; continue; }
      const key = `${q}|${d}`;
      const cls = key === selected ? ' selected' : '';
      h += cellHTML(figures(recent.get(key)), `data-cell="${key}"`).replace('class="hm-cell', `class="hm-cell${cls}`);
    }
  }
  const [sq, sd] = selected ? selected.split('|') : [];
  h += `</div><div class="hm-sub">By root${selected ? ` · ${QUALITY_TEXT[sq]} ${degreeLabel(sd)}` : ''}</div>`;
  h += '<div class="hm-roots">';
  for (let r = 0; r < 12; r++) {
    const key = selected ? `root|${selected}|${r}` : `root|${r}`;
    h += cellHTML(figures(recent.get(key)), `data-root="${r}"`, `<i>${NOTES[r]}</i>`);
  }
  el.innerHTML = h + '</div>';
}
