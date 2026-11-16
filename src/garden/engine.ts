import { TUNING } from './tuning';
import { GardenCell, hashString, mulberry32 } from './data';
import { buildSprites, GardenPalette, petalCountsFor, Sprite, SpriteSet, VARIETY_DEFS } from './sprites';

export interface GardenLayout {
  cellSize: number;
  gap: number;
  pitch: number;
  cols: number;
  gridLeft: number; // x of column 0, in root/canvas CSS px
  gridTop: number; // y of row 0
  width: number; // root size == canvas size
  height: number;
}

/** Inclusive rectangle in grid space (weeks × weekdays). */
export interface GridRect {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

export interface EngineOptions {
  radius: number;
  growSeconds: number;
  retractSeconds: number;
  maxBees: number;
  palette: GardenPalette;
  commitBias: boolean;
}

/** Per-square "plant DNA". Derived from a hash of the date, so a square always grows the same plant. */
interface DNA {
  variety: number;
  height: number; // cell heights
  lean: number;
  kink: number;
  leafCount: number;
  leafSize: number;
  leafAngle: number;
  leafShade: number;
  side: number;
  flowerSize: number;
  petalCount: number;
  variant: number;
  tilt: number;
  swayPhase: number;
  swayFreq: number;
  delayRand: number;
  stemShade: number;
}

interface Petal {
  alive: boolean;
  x: number; y: number; vy: number;
  rot: number; vrot: number; ph: number;
  life: number; max: number;
  variety: number; size: number;
}

const enum BeeMode { Fly, Hover, Leave }
interface Bee {
  mode: BeeMode;
  x: number; y: number; px: number; py: number;
  p0x: number; p0y: number; c1x: number; c1y: number; c2x: number; c2y: number;
  tx: number; ty: number; // leave target (static)
  cell: number;
  u: number; dur: number;
  hoverLeft: number;
  seed: number;
  alpha: number;
  face: number;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const seg = (g: number, r: number[]) => clamp((g - r[0]) / (r[1] - r[0]), 0, 1);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const PI2 = Math.PI * 2;

export class GardenEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private layout!: GardenLayout;
  private opts!: EngineOptions;
  private cells: GardenCell[] = [];
  private rects: (SVGRectElement | null)[] = [];
  private dna: DNA[] = [];
  private order: number[] = []; // back-to-front draw order
  private sprites: SpriteSet | null = null;
  private spriteKey = '';

  // Per-cell state, flat typed arrays.
  private g = new Float32Array(0);
  private v = new Float32Array(0);
  private target = new Float32Array(0);
  private delayLeft = new Float32Array(0);
  private alpha = new Float32Array(0); // reduced-motion fade
  private dip = new Float32Array(0);
  private dipT = new Float32Array(0);
  private headX = new Float32Array(0);
  private headY = new Float32Array(0);
  private bloom = new Float32Array(0);
  private colorKey = new Int8Array(0);
  private cellDist = new Float32Array(0);

  private hovered = -1;
  private dwell = 0;
  // Drag-selected patch: grows fully, independent of hover.
  private selection: GridRect | null = null;
  private selAnchor = { col: 0, row: 0 };
  private selAge = 0;
  private swayLevel = TUNING.swayMinAmp;
  private time = 0;
  private raf = 0;
  private last = 0;
  private reduced = false;
  private fx = mulberry32(12345); // randomness for particles only (never plant DNA)

  private petals: Petal[] = Array.from({ length: TUNING.maxPetals }, () => ({
    alive: false, x: 0, y: 0, vy: 0, rot: 0, vrot: 0, ph: 0, life: 0, max: 0, variety: 0, size: 1,
  }));
  private livePetals = 0;
  private bees: Bee[] = [];
  private beeCooldown = 0;

  private mql: MediaQueryList | null = null;
  private onDprChange = () => this.watchDpr();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.watchDpr();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  configure(cells: GardenCell[], rects: (SVGRectElement | null)[], layout: GardenLayout, opts: EngineOptions) {
    const cellsChanged = cells !== this.cells;
    const biasChanged = !this.opts || this.opts.commitBias !== opts.commitBias;
    this.layout = layout;
    this.opts = opts;
    this.rects = rects;
    if (cellsChanged) {
      this.cells = cells;
      const n = cells.length;
      this.g = new Float32Array(n);
      this.v = new Float32Array(n);
      this.target = new Float32Array(n);
      this.delayLeft = new Float32Array(n);
      this.alpha = new Float32Array(n);
      this.dip = new Float32Array(n);
      this.dipT = new Float32Array(n);
      this.headX = new Float32Array(n);
      this.headY = new Float32Array(n);
      this.bloom = new Float32Array(n);
      this.colorKey = new Int8Array(n);
      this.cellDist = new Float32Array(n);
      this.order = cells.map((_, i) => i).sort((a, b) => cells[a].row - cells[b].row || cells[a].col - cells[b].col);
      this.hovered = -1;
      this.selection = null;
      this.bees.length = 0;
      for (const p of this.petals) p.alive = false;
    }
    if (cellsChanged || biasChanged) this.dna = cells.map((c) => this.makeDNA(c));
    this.resize();
    // Re-apply targets (radius may have changed) and repaint squares.
    this.colorKey.fill(-1);
    this.retarget(false);
    this.kick();
  }

  setHover(i: number) {
    if (i === this.hovered) return;
    this.hovered = i;
    this.dwell = 0;
    if (!this.selection) {
      // Bees head home; petals already in the air fade out gracefully.
      // (With a planted patch they stay — bees on retracting flowers re-pick on their own.)
      for (const b of this.bees) if (b.mode !== BeeMode.Leave) this.sendBeeHome(b);
      for (const p of this.petals) if (p.alive) p.max = Math.min(p.max, p.life + 0.7);
    }
    this.retarget(true);
    this.kick();
  }

  /** Plant (or clear, with null) a rectangular patch. `anchor` is where the drag began: growth ripples out from it. */
  setSelection(rect: GridRect | null, anchor?: { col: number; row: number }) {
    const s = this.selection;
    if (s === rect || (s && rect && s.c0 === rect.c0 && s.c1 === rect.c1 && s.r0 === rect.r0 && s.r1 === rect.r1)) return;
    this.selection = rect;
    this.selAge = 0;
    if (anchor) this.selAnchor = anchor;
    if (!rect && this.hovered < 0) {
      for (const b of this.bees) if (b.mode !== BeeMode.Leave) this.sendBeeHome(b);
      for (const p of this.petals) if (p.alive) p.max = Math.min(p.max, p.life + 0.7);
    }
    this.retarget(true);
    this.kick();
  }

  /** How long the current garden has been left alone: drives sway, petals and bees. */
  private get calm(): number {
    return Math.max(this.hovered >= 0 ? this.dwell : 0, this.selection ? this.selAge : 0);
  }
  private get engaged(): boolean {
    return this.hovered >= 0 || this.selection !== null;
  }

  setReducedMotion(r: boolean) {
    if (r === this.reduced) return;
    this.reduced = r;
    if (!this.opts) return; // not configured yet; configure() will pick it up
    if (r) {
      this.bees.length = 0;
      for (const p of this.petals) p.alive = false;
      for (let k = 0; k < this.g.length; k++) {
        this.alpha[k] = this.target[k] > 0 ? 1 : 0;
        this.g[k] = this.target[k];
        this.v[k] = 0;
      }
    } else {
      this.alpha.fill(1);
    }
    this.colorKey.fill(-1);
    this.retarget(false);
    this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.mql?.removeEventListener('change', this.onDprChange);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  private watchDpr() {
    this.mql?.removeEventListener('change', this.onDprChange);
    this.dpr = window.devicePixelRatio || 1;
    this.mql = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
    this.mql.addEventListener('change', this.onDprChange);
    if (this.layout) {
      this.resize();
      this.kick();
    }
  }

  private resize() {
    const L = this.layout;
    const w = Math.round(L.width * this.dpr), h = Math.round(L.height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const R = L.pitch * TUNING.flowerScale;
    const key = [R, L.pitch, this.dpr].join('|');
    if (key !== this.spriteKey || !this.sprites || this.sprites.varieties[0].colors !== this.opts.palette.flowers.cosmos) {
      this.sprites = buildSprites(R, L.pitch, this.dpr, this.opts.palette, TUNING.leafScale);
      this.spriteKey = key;
    }
  }

  private makeDNA(c: GardenCell): DNA {
    const r = mulberry32(hashString('garden:' + c.date));
    const bias = this.opts.commitBias ? c.level / 4 : 0.5;
    let roll = r() * VARIETY_DEFS.reduce((a, d) => a + d.weight, 0);
    let variety = 0;
    while (variety < VARIETY_DEFS.length - 1 && (roll -= VARIETY_DEFS[variety].weight) > 0) variety++;
    const counts = petalCountsFor(variety);
    const radial = VARIETY_DEFS[variety].kind === 'radial';
    const [hMin, hMax] = TUNING.stemHeight;
    return {
      variety,
      height: hMin + (hMax - hMin) * (0.7 * r() + 0.3 * bias),
      lean: (r() - 0.5) * 2 * TUNING.maxLean,
      kink: (r() - 0.5) * 0.12,
      leafCount: 1 + Math.floor(r() * 2),
      leafSize: 0.8 + r() * 0.35,
      leafAngle: 0.75 + r() * 0.35,
      leafShade: VARIETY_DEFS[variety].name === 'coneflower' ? 2 : Math.floor(r() * 2),
      side: r() < 0.5 ? -1 : 1,
      flowerSize: (0.82 + r() * 0.3) * (this.opts.commitBias ? 0.82 + 0.36 * bias : 1),
      petalCount: counts[Math.floor(r() * counts.length)],
      variant: Math.floor(r() * 2),
      tilt: radial ? 0.78 + r() * 0.22 : 1,
      swayPhase: r() * PI2,
      swayFreq: 1.1 + r() * 0.7,
      delayRand: r(),
      stemShade: Math.floor(r() * 3),
    };
  }

  // ── Targets & square colours (only on hover change, never per frame) ──────

  private growthFor(d: number): number {
    const R = this.opts.radius;
    const core = Math.min(TUNING.bloomCore, R * 0.5);
    if (d <= core) return 1;
    const x = clamp(1 - (d - core) / (R - core), 0, 1);
    return x <= 0 ? 0 : Math.pow(x, TUNING.falloff);
  }

  private retarget(fromHover: boolean) {
    const { cells, opts } = this;
    const h = this.hovered >= 0 ? cells[this.hovered] : null;
    const pal = opts.palette;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      let t = 0, d = 99;
      if (h) {
        d = Math.hypot(c.col - h.col, c.row - h.row);
        t = d < opts.radius ? this.growthFor(d) : 0;
      }
      const sel = this.selection;
      if (sel && c.col >= sel.c0 && c.col <= sel.c1 && c.row >= sel.r0 && c.row <= sel.r1) {
        t = 1;
        // ripple outward from the drag's starting square
        const ds = Math.hypot(c.col - this.selAnchor.col, c.row - this.selAnchor.row);
        if (ds < d) d = Math.min(ds, opts.radius * 0.999);
      }
      this.cellDist[k] = d;
      const prev = this.target[k];
      if (t > prev && this.g[k] < 0.02 && !this.reduced) {
        // newly sprouting: ripple outward with a small random stagger
        const share = TUNING.rippleDistanceShare;
        this.delayLeft[k] = TUNING.rippleDelay * (share * clamp(d / opts.radius, 0, 1) + (1 - share) * this.dna[k].delayRand);
      } else if (t < prev) {
        this.delayLeft[k] = 0;
      }
      this.target[k] = t;
      if (this.reduced && t > 0) this.g[k] = t;

      // Square colour: its own slow CSS transition (cheap, compositor-friendly).
      const key = t <= 0 ? 0 : t < TUNING.stages.square[1] ? 1 : Math.max(1, c.level);
      if (key !== this.colorKey[k]) {
        const rect = this.rects[k];
        if (rect) {
          const growing = key > 0;
          const dur = this.reduced ? 0.3 : growing ? TUNING.squareFadeSeconds : opts.retractSeconds;
          const delay = growing && fromHover && !this.reduced ? this.delayLeft[k] : 0;
          rect.style.transition = `fill ${dur}s ease-in-out ${delay.toFixed(3)}s`;
          rect.style.fill = key === 0 ? pal.empty : pal.greens[key - 1];
        }
        this.colorKey[k] = key;
      }
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  private kick() {
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    const dt = Math.min(TUNING.maxDt, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.hovered >= 0) this.dwell += dt;
    if (this.selection) this.selAge += dt;

    const settled = this.step(dt);
    this.draw(dt);

    const busy = !settled || this.livePetals > 0 || this.bees.length > 0 || (this.engaged && !this.reduced);
    if (busy) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.raf = 0; // nothing alive — sleep until the next hover
    }
  };

  /** Advance every cell's growth. Returns true when everything is at rest. */
  private step(dt: number): boolean {
    const { g, v, target, delayLeft } = this;
    let settled = true;

    // global sway level: ramps 30%→100% over the first ~3 s of dwell
    const swayTarget = this.engaged ? TUNING.swayMinAmp + (1 - TUNING.swayMinAmp) * smooth(0, TUNING.swayRampSeconds, this.calm) : TUNING.swayMinAmp;
    this.swayLevel += (swayTarget - this.swayLevel) * Math.min(1, dt * 2);

    if (this.reduced) {
      const rate = dt / 0.35;
      for (let k = 0; k < g.length; k++) {
        const want = target[k] > 0 ? 1 : 0;
        const a = this.alpha[k];
        if (a !== want) {
          this.alpha[k] = want > a ? Math.min(1, a + rate) : Math.max(0, a - rate);
          settled = false;
        }
        if (want === 0 && this.alpha[k] === 0) g[k] = 0;
      }
      return settled;
    }

    const wGrow = TUNING.springSettle / Math.max(0.1, this.opts.growSeconds);
    const wRet = TUNING.springSettle / Math.max(0.05, this.opts.retractSeconds);
    for (let k = 0; k < g.length; k++) {
      const tgt = target[k];
      let x = g[k], vel = v[k];
      if (x === tgt && vel === 0) continue;
      settled = false;
      if (delayLeft[k] > 0) {
        delayLeft[k] -= dt;
        continue;
      }
      // Exact critically-damped spring step: stable for any dt, smooth on re-target.
      const w = tgt < x ? wRet : wGrow;
      const d0 = x - tgt;
      const c2 = vel + w * d0;
      const e = Math.exp(-w * dt);
      x = tgt + (d0 + c2 * dt) * e;
      vel = (vel - w * c2 * dt) * e;
      if (x < 0) { x = 0; vel = 0; }
      if (x > 1) { x = 1; vel = 0; }
      if (Math.abs(x - tgt) < 0.0015 && Math.abs(vel) < 0.01) { x = tgt; vel = 0; }
      g[k] = x;
      v[k] = vel;
    }

    // bee weight on flowers
    for (let k = 0; k < this.dip.length; k++) {
      const d = this.dip[k], t = this.dipT[k];
      if (d !== t) {
        const nd = d + (t - d) * Math.min(1, dt * 4);
        this.dip[k] = Math.abs(nd - t) < 0.002 ? t : nd;
        settled = false;
      }
    }
    return settled;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private xf(a: number, b: number, c: number, d: number, e: number, f: number) {
    const s = this.dpr;
    this.ctx.setTransform(a * s, b * s, c * s, d * s, e * s, f * s);
  }

  private blit(sp: Sprite) {
    this.ctx.drawImage(sp.c, -sp.ax, -sp.ay, sp.w, sp.h);
  }

  /** Draw a sprite at (x,y) rotated by ang, scaled (sx,sy). */
  private sprite(sp: Sprite, x: number, y: number, ang: number, sx: number, sy: number) {
    const c = Math.cos(ang), s = Math.sin(ang);
    this.xf(c * sx, s * sx, -s * sy, c * sy, x, y);
    this.blit(sp);
  }

  private draw(dt: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineCap = 'round';
    this.bloom.fill(0);
    for (let i = 0; i < this.order.length; i++) {
      const k = this.order[i];
      if (this.g[k] > 0.002) this.drawPlant(k);
    }
    ctx.globalAlpha = 1;
    if (!this.reduced) {
      this.updatePetals(dt);
      this.updateBees(dt);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private swayFn(t: number, D: DNA, x: number) {
    return (
      0.6 * Math.sin(t * D.swayFreq + D.swayPhase) +
      0.22 * Math.sin(t * D.swayFreq * 2.13 + D.swayPhase * 1.7) +
      0.35 * Math.sin(t * 0.55 - x * 0.012 + 0.4) * (0.6 + 0.4 * Math.sin(t * 0.21)) // travelling gust
    );
  }

  private drawPlant(k: number) {
    const ctx = this.ctx, L = this.layout, D = this.dna[k], c = this.cells[k];
    const sp = this.sprites!;
    const gk = this.g[k];
    const st = TUNING.stages;
    const cx = L.gridLeft + c.col * L.pitch + L.cellSize / 2;
    const cy = L.gridTop + c.row * L.pitch + L.cellSize / 2;

    const stemT = easeOutCubic(seg(gk, st.stem)) * TUNING.stemShareAtStage + (1 - TUNING.stemShareAtStage) * easeOutCubic(seg(gk, [st.stem[1], 1]));
    if (stemT <= 0) return;
    ctx.globalAlpha = this.reduced ? this.alpha[k] : 1;

    const H = D.height * L.pitch;
    const h = H * stemT;
    const amp = this.reduced ? 0 : this.swayLevel * gk * gk; // sprouts barely move
    const sw = amp * this.swayFn(this.time, D, cx);
    const swLag = amp * this.swayFn(this.time - TUNING.headLag, D, cx);
    const dipY = this.dip[k] * H * TUNING.beeDip;

    // Stem: cubic bezier whose bend grows toward the tip.
    const tipX = cx + Math.tan(D.lean) * h * (0.35 + 0.65 * stemT) + h * TUNING.swayTipBend * sw;
    const tipY = cy - h + dipY;
    const dx = tipX - cx;
    const c1x = cx + dx * 0.06 + D.kink * h, c1y = cy - h * 0.36;
    const c2x = cx + dx * 0.5, c2y = cy - h * 0.7 + dipY * 0.5;

    this.xf(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = this.opts.palette.stems[D.stemShade % this.opts.palette.stems.length];
    ctx.lineWidth = (0.5 + 0.6 * stemT) * Math.max(0.8, L.pitch / 17);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, tipX, tipY);
    ctx.stroke();
    // second, lighter pass slightly offset: reads as a brush stroke rather than a vector line
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * 0.45;
    ctx.lineWidth *= 0.6;
    ctx.strokeStyle = this.opts.palette.leaves[0][1];
    ctx.beginPath();
    ctx.moveTo(cx + 0.4, cy);
    ctx.bezierCurveTo(c1x + 0.5, c1y, c2x + 0.4, c2y, tipX + 0.3, tipY + 1);
    ctx.stroke();
    ctx.globalAlpha = a0;

    // Leaves: alternate along the stem, lower ones unfurl first.
    const lt = seg(gk, st.leaves);
    if (lt > 0) {
      const n = D.leafCount;
      const leaf = sp.leaves[D.leafShade % sp.leaves.length];
      const stagger = 0.4;
      for (let j = 0; j < n; j++) {
        const u = clamp((lt - (stagger * j) / n) / (1 - (stagger * (n - 1)) / n), 0, 1);
        if (u <= 0) continue;
        const ue = easeOutCubic(u);
        const t = 0.16 + (0.52 * (j + 0.5)) / n;
        const it = 1 - t;
        const px = it * it * it * cx + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * tipX;
        const py = it * it * it * cy + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * tipY;
        const tx = 3 * it * it * (c1x - cx) + 6 * it * t * (c2x - c1x) + 3 * t * t * (tipX - c2x);
        const ty = 3 * it * it * (c1y - cy) + 6 * it * t * (c2y - c1y) + 3 * t * t * (tipY - c2y);
        const side = j % 2 === 0 ? D.side : -D.side;
        const ang =
          Math.atan2(ty, tx) +
          side * (0.12 + (D.leafAngle - 0.12) * ue) +
          amp * TUNING.leafFlutter * Math.sin(this.time * D.swayFreq * 3.1 + D.swayPhase + j * 1.3);
        const len = D.leafSize * (1 - (0.25 * j) / n) * (0.25 + 0.75 * ue) * (0.55 + 0.45 * stemT);
        this.sprite(leaf, px, py, ang, len, len * (0.3 + 0.7 * ue));
      }
    }

    // Bud → flower
    const bt = seg(gk, st.bud);
    if (bt <= 0) return;
    const ot = seg(gk, st.open);
    const tanAng = Math.atan2(tipY - c2y, tipX - c2x);
    const headAng = (tanAng + Math.PI / 2) * 0.55 + clamp(swLag, -1, 1) * TUNING.nodMax + this.dip[k] * 0.12;
    const vs = sp.varieties[D.variety];
    const fs = D.flowerSize;
    const def = VARIETY_DEFS[D.variety];
    const hr = sp.R * fs;
    this.headX[k] = tipX + (Math.cos(headAng) * def.head[0] - Math.sin(headAng) * def.head[1]) * hr;
    this.headY[k] = tipY + (Math.sin(headAng) * def.head[0] + Math.cos(headAng) * def.head[1]) * hr;
    this.bloom[k] = ot;

    if (ot < 1) {
      const bs = easeOutBack(bt) * (1 - 0.45 * ot) * fs;
      ctx.globalAlpha = (this.reduced ? this.alpha[k] : 1) * (1 - ot * ot);
      this.sprite(vs.bud, tipX, tipY, headAng, bs, bs);
      ctx.globalAlpha = this.reduced ? this.alpha[k] : 1;
    }
    if (ot <= 0) return;

    const ca = Math.cos(headAng), sa = Math.sin(headAng);
    // Flower frame: T(tip)·R(head)·S(fs, fs·tilt) — tilt fakes a slightly upturned face.
    const ma = ca * fs, mb = sa * fs, mc = -sa * fs * D.tilt, md = ca * fs * D.tilt;
    const full = sp.flower(D.variety, D.petalCount, D.variant);
    if (vs.kind !== 'radial') {
      // Tulips and bells swell out of the bud rather than fanning open.
      const oe = easeOutBack(ot);
      const sx = 0.45 + 0.55 * oe, sy = 0.3 + 0.7 * oe;
      ctx.globalAlpha = (this.reduced ? this.alpha[k] : 1) * Math.min(1, ot * 3);
      this.xf(ma * sx, mb * sx, mc * sy, md * sy, tipX, tipY);
      this.blit(full.sprite);
      ctx.globalAlpha = 1;
      return;
    }
    if (ot >= 0.999) {
      this.xf(ma, mb, mc, md, tipX, tipY);
      this.blit(full.sprite);
      return;
    }
    // Opening: petals start clustered upward like a cup, then fan out and lengthen.
    const oe = easeOutCubic(ot);
    const spec = full.spec;
    for (let p = 0; p < D.petalCount; p++) {
      const fa = spec.angles[p];
      const ba = -Math.PI / 2 + wrapPi(fa + Math.PI / 2) * 0.15;
      const a = ba + (wrapPi(fa - ba)) * oe;
      const ls = spec.lens[p] * (0.3 + 0.7 * oe);
      const ws = spec.widths[p] * (0.45 + 0.55 * oe);
      const pc = Math.cos(a), ps = Math.sin(a);
      const la = pc * ls, lb = ps * ls, lc = -ps * ws, ld = pc * ws;
      this.xf(ma * la + mc * lb, mb * la + md * lb, ma * lc + mc * ld, mb * lc + md * ld, tipX, tipY);
      this.blit(vs.petals[p % vs.petals.length]);
    }
    const cs = 0.35 + 0.65 * oe;
    this.xf(ma * cs, mb * cs, mc * cs, md * cs, tipX, tipY);
    this.blit(vs.center!);
  }

  // ── Petals ────────────────────────────────────────────────────────────────

  private updatePetals(dt: number) {
    const ctx = this.ctx, L = this.layout, sp = this.sprites!;
    const fx = this.fx;

    // Spawn from fully bloomed flowers once the cursor has rested a while.
    if (this.engaged && this.calm > TUNING.petalStartDwell && this.livePetals < TUNING.maxPetals) {
      const rate = TUNING.petalRate * smooth(TUNING.petalStartDwell, TUNING.petalStartDwell + TUNING.petalRampSeconds, this.calm);
      for (let k = 0; k < this.bloom.length && this.livePetals < TUNING.maxPetals; k++) {
        if (this.bloom[k] < 0.999 || fx() > rate * dt) continue;
        const p = this.petals.find((q) => !q.alive);
        if (!p) break;
        const D = this.dna[k];
        const r = sp.R * D.flowerSize * 0.45;
        const a = fx() * PI2;
        p.alive = true;
        p.x = this.headX[k] + Math.cos(a) * r;
        p.y = this.headY[k] + Math.sin(a) * r * 0.7;
        p.vy = 4;
        p.rot = a;
        p.vrot = (fx() - 0.5) * 2.4;
        p.ph = fx() * PI2;
        p.life = 0;
        p.max = TUNING.petalLife * (0.8 + fx() * 0.3);
        p.variety = D.variety;
        p.size = D.flowerSize * (0.6 + fx() * 0.2);
        this.livePetals++;
      }
    }

    const bottom = L.gridTop + 7 * L.pitch;
    for (const p of this.petals) {
      if (!p.alive) continue;
      p.life += dt;
      p.vy += (TUNING.petalFallSpeed - p.vy) * Math.min(1, dt * 1.4);
      p.y += p.vy * dt;
      p.x += (Math.sin(p.life * 1.9 + p.ph) * 16 + 5) * dt;
      p.rot += p.vrot * dt;
      const a =
        Math.min(1, p.life / 0.25) *
        clamp((p.max - p.life) / 0.8, 0, 1) *
        clamp((bottom + L.pitch * 0.5 - p.y) / (L.pitch * 1.5), 0, 1);
      if (p.life >= p.max || a <= 0) {
        p.alive = false;
        this.livePetals--;
        continue;
      }
      const flip = Math.cos(p.life * 2.6 + p.ph); // fake 3D tumble
      const vs = sp.varieties[p.variety].petals[Math.floor(p.ph) % 3];
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const sx = p.size * (0.15 + 0.85 * Math.abs(flip)), sy = p.size;
      ctx.globalAlpha = a * 0.9;
      // rotate about the petal's middle, not its base
      const half = sp.R * 0.45;
      this.xf(c * sx, s * sx, -s * sy, c * sy, p.x - c * sx * half, p.y - s * sx * half);
      this.blit(vs);
    }
    ctx.globalAlpha = 1;
  }

  // ── Bees ──────────────────────────────────────────────────────────────────

  private bloomedCount() {
    let n = 0;
    for (let k = 0; k < this.bloom.length; k++) if (this.bloom[k] >= 0.95) n++;
    return n;
  }

  private pickFlower(exclude: number): number {
    // Weighted toward the cursor; avoid flowers another bee is already on.
    let total = 0;
    const taken = new Set(this.bees.filter((b) => b.mode !== BeeMode.Leave).map((b) => b.cell));
    const w = (k: number) =>
      this.bloom[k] >= 0.95 && k !== exclude ? (taken.has(k) ? 0.15 : 1) / (0.6 + this.cellDist[k]) ** 1.5 : 0;
    for (let k = 0; k < this.bloom.length; k++) total += w(k);
    if (total <= 0) return -1;
    let r = this.fx() * total;
    for (let k = 0; k < this.bloom.length; k++) {
      r -= w(k);
      if (r <= 0 && this.bloom[k] >= 0.95) return k;
    }
    return -1;
  }

  private flyTo(b: Bee, cell: number) {
    const fx = this.fx;
    b.mode = BeeMode.Fly;
    b.cell = cell;
    b.p0x = b.x;
    b.p0y = b.y;
    const tx = this.headX[cell], ty = this.headY[cell];
    b.c1x = b.x + (fx() - 0.5) * 100;
    b.c1y = b.y - 20 - fx() * 50;
    b.c2x = tx + (fx() - 0.5) * 80;
    b.c2y = ty - 30 - fx() * 50;
    b.u = 0;
    b.dur = clamp(Math.hypot(tx - b.x, ty - b.y) / TUNING.beeSpeed, 0.9, 2.8);
  }

  private offscreenPoint(nearX: number) {
    const L = this.layout, fx = this.fx;
    const roll = fx();
    if (roll < 0.4) return { x: nearX < L.width / 2 ? -30 : L.width + 30, y: L.height * (0.05 + fx() * 0.5) };
    if (roll < 0.7) return { x: -30, y: L.height * (0.05 + fx() * 0.5) };
    if (roll < 0.85) return { x: L.width + 30, y: L.height * (0.05 + fx() * 0.5) };
    return { x: L.width * (0.1 + fx() * 0.8), y: -30 };
  }

  private sendBeeHome(b: Bee) {
    const p = this.offscreenPoint(b.x);
    b.mode = BeeMode.Leave;
    b.cell = -1;
    b.p0x = b.x;
    b.p0y = b.y;
    b.tx = p.x;
    b.ty = p.y;
    b.c1x = b.x + (this.fx() - 0.5) * 60;
    b.c1y = b.y - 40;
    b.c2x = (b.x + p.x) / 2;
    b.c2y = Math.min(b.y, p.y) - 30;
    b.u = 0;
    b.dur = clamp(Math.hypot(p.x - b.x, p.y - b.y) / (TUNING.beeSpeed * 1.4), 0.8, 2.2);
  }

  private updateBees(dt: number) {
    const fx = this.fx;
    this.dipT.fill(0);

    // How many bees should be here?
    let want = 0;
    if (this.engaged && this.calm > TUNING.beeStartDwell && this.opts.maxBees > 0) {
      // maxBees is a hard cap; small radii get proportionally fewer.
      const cap = Math.max(1, Math.round(this.opts.maxBees * clamp(this.opts.radius / 4.5, 0.4, 1)));
      want = Math.min(cap, 1 + Math.floor((this.calm - TUNING.beeStartDwell) / TUNING.beeEverySeconds));
    }
    const active = this.bees.filter((b) => b.mode !== BeeMode.Leave);
    this.beeCooldown -= dt;
    if (active.length < want && this.beeCooldown <= 0 && this.bloomedCount() > 0) {
      const cell = this.pickFlower(-1);
      if (cell >= 0) {
        const p = this.offscreenPoint(this.headX[cell]);
        const b: Bee = {
          mode: BeeMode.Fly, x: p.x, y: p.y, px: p.x, py: p.y,
          p0x: 0, p0y: 0, c1x: 0, c1y: 0, c2x: 0, c2y: 0, tx: 0, ty: 0,
          cell: -1, u: 0, dur: 1, hoverLeft: 0, seed: fx() * 100, alpha: 0, face: 1,
        };
        this.flyTo(b, cell);
        this.bees.push(b);
        this.beeCooldown = 0.35;
      }
    } else if (active.length > want) {
      this.sendBeeHome(active[active.length - 1]);
    }

    const t = this.time;
    for (let i = this.bees.length - 1; i >= 0; i--) {
      const b = this.bees[i];
      b.px = b.x;
      b.py = b.y;
      if (b.mode === BeeMode.Fly && this.bloom[b.cell] < 0.85) {
        const next = this.pickFlower(b.cell);
        if (next >= 0) this.flyTo(b, next);
        else this.sendBeeHome(b);
      }
      if (b.mode === BeeMode.Hover) {
        if (this.bloom[b.cell] < 0.85) this.sendBeeHome(b);
        else {
          b.hoverLeft -= dt;
          this.dipT[b.cell] = 1;
          b.x = this.headX[b.cell] + Math.sin(t * 2.1 + b.seed) * 1.6;
          b.y = this.headY[b.cell] - this.sprites!.R * 0.25 + Math.sin(t * 3.3 + b.seed) * 1.2;
          if (b.hoverLeft <= 0) {
            const next = this.pickFlower(b.cell);
            if (next >= 0) this.flyTo(b, next);
            else this.sendBeeHome(b);
          }
        }
      }
      if (b.mode === BeeMode.Fly || b.mode === BeeMode.Leave) {
        b.u = Math.min(1, b.u + dt / b.dur);
        const e = easeInOut(b.u);
        const ex = b.mode === BeeMode.Fly ? this.headX[b.cell] : b.tx;
        const ey = b.mode === BeeMode.Fly ? this.headY[b.cell] - this.sprites!.R * 0.25 : b.ty;
        const it = 1 - e;
        let x = it * it * it * b.p0x + 3 * it * it * e * b.c1x + 3 * it * e * e * b.c2x + e * e * e * ex;
        let y = it * it * it * b.p0y + 3 * it * it * e * b.c1y + 3 * it * e * e * b.c2y + e * e * e * ey;
        const wob = Math.sin(Math.PI * b.u) * 6;
        x += Math.sin(t * 2.7 + b.seed) * wob;
        y += Math.cos(t * 3.1 + b.seed * 1.3) * wob;
        b.x = x;
        b.y = y;
        if (b.u >= 1) {
          if (b.mode === BeeMode.Leave) {
            this.bees.splice(i, 1);
            continue;
          }
          b.mode = BeeMode.Hover;
          const [a, z] = TUNING.beeHover;
          b.hoverLeft = a + fx() * (z - a);
        }
      }
      // alpha: fade in on arrival, fade out as it leaves
      const target = b.mode === BeeMode.Leave ? 1 - smooth(0.55, 1, b.u) : 1;
      b.alpha += (target - b.alpha) * Math.min(1, dt * 6);
      if (b.mode === BeeMode.Leave) b.alpha = Math.min(b.alpha, target);
      const vx = b.x - b.px;
      if (Math.abs(vx) > 0.15) b.face += ((vx > 0 ? 1 : -1) - b.face) * Math.min(1, dt * 8);
      this.drawBee(b, (b.y - b.py) / Math.max(dt, 1e-3));
    }
  }

  private drawBee(b: Bee, vy: number) {
    const ctx = this.ctx, sp = this.sprites!, t = this.time;
    const B = sp.beeL;
    const bx = b.x + Math.sin(t * 11 + b.seed) * 0.7; // buzz wobble
    const by = b.y + Math.cos(t * 13 + b.seed) * 0.7;
    const tilt = clamp(vy / 300, -0.35, 0.35) * Math.sign(b.face || 1);
    const f = b.face === 0 ? 0.01 : b.face;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    ctx.globalAlpha = b.alpha;
    // wings (behind body): translucent, fast flap
    const flap = 0.3 + 0.7 * Math.abs(Math.sin(t * 48 + b.seed));
    this.xf(c * f, s * f, -s, c, bx, by);
    ctx.fillStyle = 'rgba(235,245,255,0.55)';
    ctx.strokeStyle = 'rgba(110,125,150,0.5)';
    ctx.lineWidth = 0.5;
    for (const [ox, rot] of [[-B * 0.05, -0.5], [B * 0.12, -0.2]] as const) {
      ctx.beginPath();
      ctx.ellipse(ox, -B * 0.28 * flap - B * 0.12, B * 0.22, B * 0.32 * flap, rot, 0, PI2);
      ctx.fill();
      ctx.stroke();
    }
    this.blit(sp.bee);
    ctx.globalAlpha = 1;
  }
}
