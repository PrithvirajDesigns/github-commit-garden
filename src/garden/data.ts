export interface ContributionDay {
  /** ISO date, YYYY-MM-DD (UTC). */
  date: string;
  count: number;
}

export interface GardenCell extends ContributionDay {
  level: number; // 0–4, GitHub-style
  col: number;
  row: number; // 0 = Sunday
}

/** Small fast deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Fake but believable contribution history: weekday bias, streaks,
 * a seasonal swell and the odd big day. 53 columns ending on `end`.
 */
export function generateFakeData(seed = 7, end: Date = new Date()): ContributionDay[] {
  const rng = mulberry32(seed);
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const dow = new Date(endUtc).getUTCDay();
  const start = endUtc - (52 * 7 + dow) * DAY;
  const out: ContributionDay[] = [];
  let streak = rng() < 0.5;
  for (let t = start, i = 0; t <= endUtc; t += DAY, i++) {
    const d = new Date(t).getUTCDay();
    const weekday = d === 0 || d === 6 ? 0.35 : 1;
    const season = 0.65 + 0.35 * Math.sin((i / 365) * Math.PI * 2 + seed);
    if (streak && rng() < 0.11) streak = false;
    else if (!streak && rng() < 0.22) streak = true;
    let count = 0;
    if (streak) {
      count = Math.floor(-Math.log(1 - rng()) * 5.5 * season * weekday);
      if (rng() < 0.04) count += 10 + Math.floor(rng() * 18);
    } else if (rng() < 0.12) {
      count = 1 + Math.floor(rng() * 3);
    }
    out.push({ date: iso(t), count });
  }
  return out;
}

/** Lay days out GitHub-style: columns are weeks (Sun–Sat). */
export function layoutCells(data: ContributionDay[]): GardenCell[] {
  if (!data.length) return [];
  const sorted = [...data].sort((a, b) => (a.date < b.date ? -1 : 1));
  const t0 = Date.parse(sorted[0].date + 'T00:00:00Z');
  const dow0 = new Date(t0).getUTCDay();
  // Quartile-ish levels over non-zero days, like GitHub.
  const nz = sorted.filter((d) => d.count > 0).map((d) => d.count).sort((a, b) => a - b);
  const q = (p: number) => (nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 1);
  const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
  return sorted.map((d) => {
    const t = Date.parse(d.date + 'T00:00:00Z');
    const i = Math.round((t - t0) / DAY);
    const level = d.count <= 0 ? 0 : d.count <= q1 ? 1 : d.count <= q2 ? 2 : d.count <= q3 ? 3 : 4;
    return { ...d, level, col: Math.floor((i + dow0) / 7), row: new Date(t).getUTCDay() };
  });
}

export function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
