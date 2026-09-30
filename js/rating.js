// How every game rates what it shows (boss, 2026-09-30: one philosophy for
// all the ratings — "how do you take recency into account … without
// overwriting with the last one, but rewarding a better one?").
//
// Each square of a stats grid (a degree on a quality, a note in a key, a
// target …) gathers its attempts, each scored 0–1 by its game (right and
// fast; hit and on time). Then:
//  - the attempts of a DAY are averaged into one day score — a 200-note day
//    counts once, like a 20-note day;
//  - NOW = the day scores averaged with weights halving every HALF_LIFE_DAYS
//    (today 1, 10 days ago ½, 20 days ¼ …) — where you are, ebbing and
//    flowing; the newest days count most;
//  - BEST = the best day score among days with at least MIN_BEST attempts —
//    proven once, not overwritten by a bad day; over what the phone keeps
//    (six months, sync.js WINDOW_DAYS);
//  - THIN = fewer than MIN_BEST attempts in all, or only old evidence (the
//    weights add up to under ½: nothing in about HALF_LIFE_DAYS) — shown
//    faint. An average alone doesn't fade when a square rests: its days
//    all age together.
// Colour = now; a corner mark = best. The pickers of what to practise next
// (weakspots.js, the scales key model) stay quick on purpose — this is
// what's SHOWN.

export const HALF_LIFE_DAYS = 10;
export const MIN_BEST = 5;
const DAY_MS = 86400000;

// A local calendar day, as the player lives it (not UTC like the sync files).
const dayOf = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// Collects attempts per square. add(key, t, score, off?) — `off` = a timing
// offset in ms, for hits where timing counts (averaged with the same
// weights, for "late / early"). get(key, now) → {now, best, bestDay, n,
// days, thin, off} or null.
export function createRating() {
  const squares = new Map();                   // key → Map(day → {sum, n, offSum, offN})
  return {
    add(key, t, score, off = null) {
      let days = squares.get(key);
      if (!days) squares.set(key, days = new Map());
      const d = dayOf(t);
      const a = days.get(d) || { sum: 0, n: 0, offSum: 0, offN: 0 };
      a.sum += score; a.n++;
      if (off != null) { a.offSum += off; a.offN++; }
      days.set(d, a);
    },
    get(key, now = Date.now()) {
      const days = squares.get(key);
      if (!days) return null;
      const today = dayOf(now);
      let w = 0, ws = 0, wo = 0, wOff = 0, n = 0, best = null, bestDay = null;
      for (const [d, a] of days) {
        const weight = 0.5 ** (Math.max(0, today - d) / DAY_MS / HALF_LIFE_DAYS);
        const s = a.sum / a.n;
        w += weight; ws += weight * s; n += a.n;
        if (a.offN) { wo += weight; wOff += weight * (a.offSum / a.offN); }
        if (a.n >= MIN_BEST && (best === null || s > best)) { best = s; bestDay = d; }
      }
      return { now: ws / w, best, bestDay, n, days: days.size, thin: n < MIN_BEST || w < 0.5, off: wo ? Math.round(wOff / wo) : null };
    },
  };
}

// Score 0..1 → colour, red (≤ 0.4) through amber to green (1).
export function colour(score) {
  const hue = Math.round(120 * Math.max(0, Math.min(1, (score - 0.4) / 0.6)));
  return `hsl(${hue} 55% 38%)`;
}

// A timed hit's score: 1 dead on, sliding to 0.6 at the widest window's
// edge (150 ms); not a hit = 0. The lanes, Cells and Guide tones all use it.
const WINDOW_MS = 150;
export const timedScore = (hit, off) => (hit ? 1 - 0.4 * Math.min(Math.abs(off || 0), WINDOW_MS) / WINDOW_MS : 0);

// A square's look, the same in every grid: its background (now), the faint
// class when thin, and the best as a corner mark (a CSS variable the
// `.rated` class draws). `extraClass` = the grid's own cell classes.
export function squareStyle(r) {
  if (!r) return { cls: ' empty', style: '' };
  const best = r.best === null ? '' : `;--best:${colour(r.best)}`;
  return { cls: `${r.thin ? ' thin' : ''}${r.best === null ? '' : ' rated'}`, style: ` style="background:${colour(r.now)}${best}"` };
}

// "now 78% · best 96% (12 Sep) · 42 over 7 days · 20 ms late" — the words
// every grid's caption uses for a tapped square.
export function ratingText(r, { timing = true } = {}) {
  if (!r) return 'not played yet';
  const pct = x => `${Math.round(100 * x)}%`;
  const when = r.bestDay === null ? '' : ` (${new Date(r.bestDay).toLocaleDateString([], { day: 'numeric', month: 'short' })})`;
  const best = r.best === null ? `best: not yet (${MIN_BEST}+ in a day)` : `best ${pct(r.best)}${when}`;
  const off = !timing || r.off === null ? '' : r.off > 15 ? ` · ${r.off} ms late` : r.off < -15 ? ` · ${-r.off} ms early` : ' · on the beat';
  return `now ${pct(r.now)} · ${best} · ${r.n} over ${r.days} day${r.days === 1 ? '' : 's'}${off}`;
}

// A pane's two figures for a whole level or exercise (rated under one
// key): "78%" and "96% · 12 Sep".
export function paneFigures(r) {
  if (!r) return { now: '–', best: '–' };
  const pct = x => `${Math.round(100 * x)}%`;
  return { now: pct(r.now), best: r.best === null ? '–' : `${pct(r.best)} · ${new Date(r.bestDay).toLocaleDateString([], { day: 'numeric', month: 'short' })}` };
}
