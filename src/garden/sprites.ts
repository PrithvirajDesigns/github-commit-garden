import { mulberry32 } from './data';

/**
 * Watercolour sprites. Everything here runs once (per size / DPR / palette),
 * never per frame, so it can afford many translucent layers per shape.
 *
 * Technique: each shape is a dense polygon, deformed by recursive midpoint
 * displacement (wobbly "painted" edges), then filled several times with low
 * alpha and fresh deformations so edges come out soft and uneven. A darker
 * second wash, pigment pooling at the edge, granulation specks and a few
 * lifted (erased) blooms finish the look.
 */

export interface FlowerColors {
  base: string; // deeper pigment, near the centre / shaded side
  tip: string; // lighter wash
  edge: string; // pigment pooling along the edge
  center: string;
  centerDark: string;
}

export const VARIETIES = ['cosmos', 'buttercup', 'aster', 'daisy', 'calendula', 'coneflower', 'tulip', 'fritillary'] as const;
export type VarietyName = (typeof VARIETIES)[number];
export type FlowerKind = 'radial' | 'cup' | 'bell';

export interface GardenPalette {
  /** Resting square colour. */
  empty: string;
  /** GitHub levels 1–4. */
  greens: [string, string, string, string];
  stems: string[];
  leaves: [string, string][]; // [shaded, light]
  flowers: Record<VarietyName, FlowerColors>;
  background: string;
  text: string;
}

// Muted, slightly dusty pigments pulled from the reference sheet.
const FLOWERS: Record<VarietyName, FlowerColors> = {
  cosmos: { base: '#c0609a', tip: '#eab0d4', edge: '#a24a82', center: '#efc04a', centerDark: '#a8742a' },
  buttercup: { base: '#eeb22c', tip: '#f8d873', edge: '#d0901c', center: '#ea8f78', centerDark: '#8c4a3a' },
  aster: { base: '#7c4c97', tip: '#b997d0', edge: '#643a80', center: '#f0c23e', centerDark: '#b07a1e' },
  daisy: { base: '#e0d3bd', tip: '#fbf8f2', edge: '#a8967a', center: '#f0b23a', centerDark: '#b06e16' },
  calendula: { base: '#e27a1e', tip: '#f6b04e', edge: '#c8621a', center: '#d8761e', centerDark: '#8e430e' },
  coneflower: { base: '#a8467a', tip: '#d98bb2', edge: '#8c3664', center: '#df8a30', centerDark: '#7a3a12' },
  tulip: { base: '#861a46', tip: '#b8406c', edge: '#6a1236', center: '#000', centerDark: '#000' },
  fritillary: { base: '#771f50', tip: '#a8507f', edge: '#5e163e', center: '#000', centerDark: '#000' },
};

const BASE = {
  greens: ['#c6e48b', '#7bc96f', '#239a3b', '#196127'] as [string, string, string, string],
  stems: ['#6a8a3a', '#5c7d33', '#78954a'],
  leaves: [
    ['#557a2c', '#9bb45c'],
    ['#4a7436', '#8eae63'],
    ['#356d50', '#78a585'],
  ] as [string, string][],
  flowers: FLOWERS,
};

export const PALETTES: Record<'light' | 'cream', GardenPalette> = {
  light: { ...BASE, empty: '#ebedf0', background: '#ffffff', text: '#57606a' },
  cream: { ...BASE, empty: '#e7e2d4', background: '#f5f1e6', text: '#7a7262' },
};

interface PetalDef {
  L: number; // length, in flower radii
  W: number; // half-width, in flower radii
  a: number; // profile exponents: width ∝ s^a·(1-s)^b
  b: number;
  notch?: number; // cosmos / coneflower toothed tips
}

export interface VarietyDef {
  name: VarietyName;
  kind: FlowerKind;
  weight: number;
  petal: PetalDef;
  counts: number[];
  centerR: number;
  centerDy?: number; // coneflower's raised cone sits above the petals
  centerSquash?: number;
  arc?: [number, number]; // petals only within this angle range (drooping coneflower)
  /** Where bees land / petals fall from, in flower radii, in the flower's frame. */
  head: [number, number];
}

export const VARIETY_DEFS: VarietyDef[] = [
  { name: 'cosmos', kind: 'radial', weight: 0.16, petal: { L: 1, W: 0.36, a: 0.55, b: 0.22, notch: 0.07 }, counts: [7, 8], centerR: 0.22, head: [0, 0] },
  { name: 'buttercup', kind: 'radial', weight: 0.14, petal: { L: 0.88, W: 0.5, a: 0.6, b: 0.32 }, counts: [5, 6], centerR: 0.27, head: [0, 0] },
  { name: 'aster', kind: 'radial', weight: 0.13, petal: { L: 1, W: 0.2, a: 0.35, b: 0.35 }, counts: [8, 9], centerR: 0.26, head: [0, 0] },
  { name: 'daisy', kind: 'radial', weight: 0.11, petal: { L: 1, W: 0.22, a: 0.35, b: 0.3 }, counts: [8, 9], centerR: 0.28, head: [0, 0] },
  { name: 'calendula', kind: 'radial', weight: 0.12, petal: { L: 0.95, W: 0.22, a: 0.45, b: 0.8 }, counts: [9, 10], centerR: 0.25, head: [0, 0] },
  { name: 'coneflower', kind: 'radial', weight: 0.12, petal: { L: 1.05, W: 0.21, a: 0.4, b: 0.35, notch: 0.05 }, counts: [9, 10], centerR: 0.3, centerDy: -0.18, centerSquash: 0.78, arc: [-0.12 * Math.PI, 1.12 * Math.PI], head: [0, -0.15] },
  { name: 'tulip', kind: 'cup', weight: 0.11, petal: { L: 1, W: 0.32, a: 0.6, b: 0.5 }, counts: [3], centerR: 0, head: [0, -0.7] },
  { name: 'fritillary', kind: 'bell', weight: 0.11, petal: { L: 0.9, W: 0.3, a: 0.5, b: 0.55 }, counts: [3], centerR: 0, head: [0.62, 0.55] },
];

export const petalCountsFor = (v: number) => VARIETY_DEFS[v].counts;

/** A pre-rendered bitmap plus the anchor it should be drawn around (CSS px). */
export interface Sprite {
  c: HTMLCanvasElement;
  ax: number;
  ay: number;
  w: number;
  h: number;
}

function mk(w: number, h: number, s: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * s));
  c.height = Math.max(1, Math.ceil(h * s));
  const g = c.getContext('2d')!;
  g.scale(s, s);
  g.translate(ax, ay);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  return { c, ax, ay, w: c.width / s, h: c.height / s };
}

// ── Watercolour primitives ─────────────────────────────────────────────────

type Poly = number[]; // flat [x0,y0,x1,y1,…]
type Rng = () => number;

const gauss = (r: Rng) => {
  let u = 0;
  while (u === 0) u = r();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  return n > 1.8 ? 1.8 : n < -1.8 ? -1.8 : n; // clamp tails: no spikes
};

/** Recursive midpoint displacement: each edge gets a jittered midpoint. */
function deform(p: Poly, depth: number, variance: number, r: Rng): Poly {
  let cur = p;
  let v = variance;
  for (let d = 0; d < depth; d++) {
    const out: number[] = [];
    const n = cur.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = cur[2 * i], ay = cur[2 * i + 1];
      const j = (i + 1) % n;
      const bx = cur[2 * j], by = cur[2 * j + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-6;
      const off = gauss(r) * len * v;
      out.push(ax, ay, (ax + bx) / 2 - (dy / len) * off, (ay + by) / 2 + (dx / len) * off);
    }
    cur = out;
    v *= 0.75;
  }
  return cur;
}

function tracePoly(g: CanvasRenderingContext2D, p: Poly) {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
}

function transformPoly(p: Poly, ang: number, sx: number, sy: number, dx: number, dy: number): Poly {
  const c = Math.cos(ang), s = Math.sin(ang);
  const out: number[] = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i] * sx, y = p[i + 1] * sy;
    out[i] = x * c - y * s + dx;
    out[i + 1] = x * s + y * c + dy;
  }
  return out;
}

function centroid(p: Poly): [number, number] {
  let x = 0, y = 0;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    y += p[i + 1];
  }
  const n = p.length / 2;
  return [x / n, y / n];
}

/** Overall paint density. ~1 = very translucent washes, 2 = solid body colour with soft painted edges. */
const OPACITY = 2;

/** Layered washes. Returns the base (deformed) outline. */
function wash(g: CanvasRenderingContext2D, p: Poly, color: string, r: Rng, layers = 5, alpha = 0.2, variance = 0.7): Poly {
  // `variance` is a 0–1 "looseness"; mapped to small, coherent edge wobble.
  const base = deform(p, 2, 0.3 * variance, r);
  g.fillStyle = color;
  g.globalAlpha = Math.min(0.6, alpha * OPACITY);
  for (let i = 0; i < layers; i++) {
    tracePoly(g, deform(base, 2, 0.16 * variance, r));
    g.fill();
  }
  g.globalAlpha = 1;
  return base;
}

/** Pigment pools at the edge of a dried wash. */
function pool(g: CanvasRenderingContext2D, p: Poly, color: string, width: number, alpha: number) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.globalAlpha = alpha;
  tracePoly(g, p);
  g.stroke();
  g.globalAlpha = 1;
}

/** Granulation: tiny pigment specks scattered inside a (star-shaped) outline. */
function specks(g: CanvasRenderingContext2D, p: Poly, color: string, n: number, size: number, alpha: number, r: Rng) {
  const [cx, cy] = centroid(p);
  const m = p.length / 2;
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(r() * m);
    const t = Math.sqrt(r()) * 0.85;
    const x = cx + (p[2 * k] - cx) * t, y = cy + (p[2 * k + 1] - cy) * t;
    g.globalAlpha = alpha * (0.5 + r() * 0.5);
    g.beginPath();
    g.arc(x, y, size * (0.4 + r() * 0.8), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Lifted pigment: soft lighter blooms erased out of the wash. */
function lift(g: CanvasRenderingContext2D, p: Poly, n: number, size: number, r: Rng) {
  const [cx, cy] = centroid(p);
  const m = p.length / 2;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    const k = Math.floor(r() * m);
    const t = 0.3 + r() * 0.5;
    g.globalAlpha = 0.04 + r() * 0.05;
    g.beginPath();
    g.ellipse(cx + (p[2 * k] - cx) * t, cy + (p[2 * k + 1] - cy) * t, size * (0.6 + r()), size * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Petal / leaf outline along +x from the origin. Width ∝ s^a·(1-s)^b. */
function bladePoly(L: number, W: number, a: number, b: number, notch = 0, asym = 0): Poly {
  const N = 22;
  let max = 0;
  for (let i = 1; i < 200; i++) {
    const s = i / 200;
    max = Math.max(max, s ** a * (1 - s) ** b);
  }
  const top: number[] = [], bot: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const w = (s ** a * (1 - s) ** b) / max;
    let xt = L * s, xb = L * s;
    const yt = -W * w * (1 + asym), yb = W * w * (1 - asym);
    if (notch && s > 0.8) {
      xt -= L * notch * Math.abs(Math.sin((yt / W) * Math.PI * 1.5));
      xb -= L * notch * Math.abs(Math.sin((yb / W) * Math.PI * 1.5));
    }
    top.push(xt, yt);
    bot.push(xb, yb);
  }
  const out = [...top];
  for (let i = bot.length - 2; i >= 2; i -= 2) out.push(bot[i], bot[i + 1]);
  return out;
}

function circlePoly(r: number, squash = 1, n = 30): Poly {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(Math.cos(a) * r, Math.sin(a) * r * squash);
  }
  return out;
}

// ── Sprite builders ────────────────────────────────────────────────────────

function paintPetal(g: CanvasRenderingContext2D, def: PetalDef, col: FlowerColors, R: number, r: Rng, edgeAlpha = 0.22) {
  const L = def.L * R, W = def.W * R;
  const shape = bladePoly(L, W, def.a, def.b, def.notch, (r() - 0.5) * 0.25);
  const base = wash(g, shape, col.tip, r, 5, 0.27, 0.75);
  // deeper pigment settles toward the centre of the flower
  wash(g, transformPoly(shape, 0, 0.55 + r() * 0.15, 0.85, 0, 0), col.base, r, 4, 0.2, 0.8);
  // a few fine veins
  g.strokeStyle = col.edge;
  g.lineWidth = 0.35;
  for (let i = -1; i <= 1; i++) {
    g.globalAlpha = 0.16;
    g.beginPath();
    g.moveTo(L * 0.06, 0);
    g.quadraticCurveTo(L * 0.4, W * 0.25 * i + (r() - 0.5) * W * 0.2, L * (0.62 + r() * 0.15), W * 0.45 * i);
    g.stroke();
  }
  pool(g, base, col.edge, 0.45, edgeAlpha);
  specks(g, base, col.base, Math.round(10 + L * 0.6), Math.max(0.25, R * 0.025), 0.3, r);
  lift(g, base, 2, W * 0.35, r);
}

function paintCenter(g: CanvasRenderingContext2D, def: VarietyDef, col: FlowerColors, R: number, r: Rng) {
  const cr = def.centerR * R;
  const sq = def.centerSquash ?? 1;
  const dy = (def.centerDy ?? 0) * R;
  const disc = transformPoly(circlePoly(cr, sq), 0, 1, 1, 0, dy);
  const base = wash(g, disc, col.center, r, 5, 0.28, 0.5);
  // shadowed lower-right half
  wash(g, transformPoly(circlePoly(cr * 0.75, sq), 0, 1, 1, cr * 0.22, dy + cr * 0.2), col.centerDark, r, 3, 0.16, 0.5);
  specks(g, base, col.centerDark, 22, Math.max(0.3, cr * 0.09), 0.55, r);
  pool(g, base, col.centerDark, 0.45, 0.35);
}

function paintTulip(g: CanvasRenderingContext2D, col: FlowerColors, R: number, r: Rng) {
  const H = R * 1.45;
  // back petals, leaning out
  for (const side of [-1, 1]) {
    const p = transformPoly(bladePoly(H, R * 0.34, 0.65, 0.55), -Math.PI / 2 + side * 0.24, 1, 1, side * R * 0.1, 0);
    const b = wash(g, p, col.base, r, 5, 0.2, 0.7);
    pool(g, b, col.edge, 0.5, 0.35);
  }
  // front petal: lighter top, deep base
  const front = transformPoly(bladePoly(H * 0.96, R * 0.42, 0.55, 0.45), -Math.PI / 2, 1, 1, 0, 0);
  const fb = wash(g, front, col.tip, r, 5, 0.22, 0.7);
  wash(g, transformPoly(bladePoly(H * 0.6, R * 0.38, 0.55, 0.6), -Math.PI / 2, 1, 1, 0, 0), col.base, r, 4, 0.2, 0.8);
  pool(g, fb, col.edge, 0.55, 0.4);
  specks(g, fb, col.edge, 30, Math.max(0.3, R * 0.03), 0.3, r);
  lift(g, fb, 3, R * 0.12, r);
}

function paintBell(g: CanvasRenderingContext2D, col: FlowerColors, stem: string, R: number, r: Rng) {
  // arching pedicel from the stem tip
  const hx = R * 0.62, hy = R * 0.02;
  g.strokeStyle = stem;
  g.lineWidth = 1.1;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(R * 0.3, -R * 0.55, hx, hy);
  g.stroke();
  g.globalAlpha = 1;
  // bell hangs straight down from the hook
  const H = R * 1.05;
  for (const side of [-1, 1]) {
    const p = transformPoly(bladePoly(H, R * 0.3, 0.55, 0.5), Math.PI / 2 - side * 0.2, 1, 1, hx + side * R * 0.06, hy);
    const b = wash(g, p, col.base, r, 5, 0.2, 0.7);
    pool(g, b, col.edge, 0.5, 0.35);
  }
  const front = transformPoly(bladePoly(H * 0.98, R * 0.36, 0.5, 0.45), Math.PI / 2, 1, 1, hx, hy);
  const fb = wash(g, front, col.tip, r, 5, 0.22, 0.7);
  wash(g, transformPoly(bladePoly(H * 0.55, R * 0.32, 0.5, 0.6), Math.PI / 2, 1, 1, hx, hy), col.base, r, 4, 0.2, 0.8);
  pool(g, fb, col.edge, 0.55, 0.4);
  // the fritillary's faint chequering
  specks(g, fb, col.tip, 26, Math.max(0.4, R * 0.05), 0.45, r);
  // green cap where the bell meets the pedicel
  g.fillStyle = stem;
  g.globalAlpha = 0.8;
  g.beginPath();
  g.ellipse(hx, hy + R * 0.04, R * 0.1, R * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

export interface FlowerSpec {
  angles: number[];
  lens: number[];
  widths: number[];
}

export interface VarietySprites {
  def: VarietyDef;
  kind: FlowerKind;
  petals: Sprite[]; // anchored at petal base, pointing +x (radial); also used for falling petals
  center: Sprite | null;
  bud: Sprite; // anchored at stem tip
  /** Full flowers keyed by `${petalCount}:${variant}`. */
  full: Map<string, { sprite: Sprite; spec: FlowerSpec }>;
  colors: FlowerColors;
}

export interface SpriteSet {
  R: number; // flower radius in CSS px at flowerSize = 1
  varieties: VarietySprites[];
  leaves: Sprite[]; // anchored at base, pointing +x, unit length leafL
  leafL: number;
  bee: Sprite; // centred, facing +x
  beeL: number;
  /** Lazily build (and cache) the full-flower sprite + its petal layout. */
  flower(variety: number, count: number, variant: number): { sprite: Sprite; spec: FlowerSpec };
}

export function flowerSpec(variety: number, count: number, variant: number): FlowerSpec {
  const def = VARIETY_DEFS[variety];
  const rng = mulberry32(9001 + variety * 131 + count * 17 + variant * 7);
  const angles: number[] = [], lens: number[] = [], widths: number[] = [];
  const off = rng() * Math.PI;
  for (let i = 0; i < count; i++) {
    if (def.arc) {
      const [a0, a1] = def.arc;
      angles.push(a0 + ((i + 0.5) / count) * (a1 - a0) + (rng() - 0.5) * 0.12);
    } else {
      angles.push(off + (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.24);
    }
    lens.push(0.86 + rng() * 0.18);
    widths.push(0.88 + rng() * 0.24);
  }
  return { angles, lens, widths };
}

export function buildSprites(R: number, pitch: number, dpr: number, palette: GardenPalette, leafScale = 0.7): SpriteSet {
  const s = Math.max(2, dpr * 1.75);

  const varieties: VarietySprites[] = VARIETY_DEFS.map((def, vi) => {
    const colors = palette.flowers[def.name];
    const L = def.petal.L * R, W = def.petal.W * R;
    const pad = Math.max(3, L * 0.18);
    const petals = [0, 1, 2].map((k) =>
      mk(L * 1.1 + pad * 2, W * 2.6 + pad * 2, s, pad, W * 1.3 + pad, (g) =>
        paintPetal(g, def.petal, colors, R, mulberry32(500 + vi * 37 + k * 11), def.name === 'daisy' ? 0.55 : 0.22),
      ),
    );

    let center: Sprite | null = null;
    if (def.kind === 'radial') {
      const cr = def.centerR * R, dy = (def.centerDy ?? 0) * R, p = cr * 0.5 + 3;
      center = mk((cr + p) * 2, (cr + p) * 2 + Math.abs(dy) * 2, s, cr + p, cr + p + Math.abs(dy), (g) =>
        paintCenter(g, def, colors, R, mulberry32(77 + vi)),
      );
    }

    // bud: a coloured teardrop held by two small green sepals
    const bw = R * 0.5, bh = R * 0.72, bp = 4;
    const bud = mk(bw + bp * 2, bh + bp * 2, s, bw / 2 + bp, bh + bp, (g) => {
      const r = mulberry32(300 + vi);
      const tear = transformPoly(bladePoly(bh * 0.9, bw * 0.34, 0.75, 0.6), -Math.PI / 2, 1, 1, 0, -bh * 0.05);
      const b = wash(g, tear, colors.base, r, 5, 0.22, 0.6);
      pool(g, b, colors.edge, 0.45, 0.35);
      const [dark, light] = palette.leaves[0];
      for (const side of [-1, 1]) {
        const sep = transformPoly(bladePoly(bh * 0.5, bw * 0.13, 0.5, 0.9), -Math.PI / 2 + side * 0.5, 1, 1, 0, -bh * 0.02);
        wash(g, sep, light, r, 3, 0.3, 0.5);
        wash(g, sep, dark, r, 2, 0.2, 0.5);
      }
    });

    return { def, kind: def.kind, petals, center, bud, full: new Map(), colors };
  });

  const leafL = pitch * leafScale;
  const leaves = palette.leaves.map(([dark, light], li) => {
    const L = leafL, W = leafL * 0.19, pad = 4;
    return mk(L * 1.1 + pad * 2, W * 2.8 + pad * 2, s, pad, W * 1.4 + pad, (g) => {
      const r = mulberry32(42 + li * 13);
      const shape = bladePoly(L, W, 0.6, 1.0);
      const base = wash(g, shape, light, r, 5, 0.22, 0.6);
      // one shaded half, like the reference leaves
      const half: number[] = [];
      for (let i = 0; i < shape.length / 2; i += 2) half.push(shape[i], shape[i + 1]);
      half.push(L, 0);
      wash(g, half, dark, r, 4, 0.22, 0.5);
      wash(g, transformPoly(shape, 0, 0.45, 0.6, 0, 0), dark, r, 2, 0.14, 0.6);
      g.strokeStyle = dark;
      g.lineWidth = 0.45;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(L * 0.04, 0);
      g.quadraticCurveTo(L * 0.5, -W * 0.06, L * 0.9, 0);
      g.stroke();
      pool(g, base, dark, 0.5, 0.3);
      specks(g, base, dark, 18, 0.35, 0.25, r);
      lift(g, base, 2, W * 0.4, r);
    });
  });

  const beeL = Math.max(10, pitch * 0.72);
  const bee = (() => {
    const B = beeL, rx = B * 0.4, ry = B * 0.29, pad = 2;
    return mk(B * 1.3 + pad * 2, B * 0.9 + pad * 2, s, B * 0.6 + pad, B * 0.45 + pad, (g) => {
      const r = mulberry32(5);
      g.fillStyle = '#3a2d22';
      g.beginPath();
      g.moveTo(-rx - B * 0.12, 0);
      g.lineTo(-rx + 1, -ry * 0.25);
      g.lineTo(-rx + 1, ry * 0.25);
      g.fill();
      const body = circlePoly(rx, ry / rx);
      const bb = wash(g, body, '#f2c14e', r, 5, 0.3, 0.3);
      wash(g, transformPoly(body, 0, 0.7, 0.7, rx * 0.15, ry * 0.25), '#d99a2b', r, 2, 0.25, 0.3);
      g.save();
      tracePoly(g, bb);
      g.clip();
      g.fillStyle = '#3a2d22';
      g.globalAlpha = 0.85;
      g.fillRect(-rx, -ry * 1.2, B * 0.1, ry * 2.4);
      g.fillRect(-B * 0.16, -ry * 1.2, B * 0.11, ry * 2.4);
      g.fillRect(B * 0.08, -ry * 1.2, B * 0.1, ry * 2.4);
      g.restore();
      pool(g, bb, '#6a4a1a', 0.5, 0.4);
      g.globalAlpha = 0.9;
      g.fillStyle = '#3a2d22';
      g.beginPath();
      g.arc(rx * 0.98, -ry * 0.05, B * 0.19, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(rx * 1.08, -ry * 0.22, B * 0.05, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#3a2d22';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(rx * 1.05, -ry * 0.5);
      g.quadraticCurveTo(rx * 1.2, -ry * 1.3, rx * 1.45, -ry * 1.35);
      g.stroke();
      g.globalAlpha = 1;
    });
  })();

  return {
    R,
    varieties,
    leaves,
    leafL,
    bee,
    beeL,
    flower(variety, count, variant) {
      const vs = varieties[variety];
      const key = count + ':' + variant;
      let hit = vs.full.get(key);
      if (hit) return hit;
      const spec = flowerSpec(variety, count, variant);
      let sprite: Sprite;
      if (vs.kind === 'cup') {
        const p = R * 0.5;
        sprite = mk(R * 1.4 + p * 2, R * 1.6 + p * 2, s, R * 0.7 + p, R * 1.55 + p, (g) =>
          paintTulip(g, vs.colors, R, mulberry32(900 + variant)),
        );
      } else if (vs.kind === 'bell') {
        const p = R * 0.4;
        sprite = mk(R * 1.6 + p * 2, R * 2 + p * 2, s, R * 0.3 + p, R * 0.75 + p, (g) =>
          paintBell(g, vs.colors, palette.stems[0], R, mulberry32(950 + variant)),
        );
      } else {
        const size = R * 2.6;
        sprite = mk(size, size, s, size / 2, size / 2, (g) => {
          for (let i = 0; i < count; i++) {
            const pt = vs.petals[i % vs.petals.length];
            g.save();
            g.rotate(spec.angles[i]);
            g.scale(spec.lens[i], spec.widths[i]);
            g.drawImage(pt.c, -pt.ax, -pt.ay, pt.w, pt.h);
            g.restore();
          }
          const c = vs.center!;
          g.drawImage(c.c, -c.ax, -c.ay, c.w, c.h);
        });
      }
      hit = { sprite, spec };
      vs.full.set(key, hit);
      return hit;
    },
  };
}
