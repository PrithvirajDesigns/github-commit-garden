/**
 * Every "feel" knob in one place. The ones marked ★ are the first to reach for.
 * Times are seconds, distances are in cells unless noted.
 */
export const TUNING = {
  // ── Radius / growth shape ────────────────────────────────────────────────
  /** ★ Cells within this distance of the cursor bloom fully (g = 1).
   *  0 = the strict spec formula, where only the hovered square blooms and
   *  its neighbours stop at the bud stage. 1.5 = the 3×3 block blooms. */
  bloomCore: 2.1,
  /** ★ Exponent in g = clamp(1 - d/R, 0, 1)^falloff. Lower = fuller garden. */
  falloff: 0.8,

  /** Growth stages, as [start, end] ranges of g. */
  stages: {
    square: [0.0, 0.15],
    stem: [0.12, 0.55],
    leaves: [0.45, 0.75],
    bud: [0.7, 0.85],
    open: [0.85, 1.0],
  },

  // ── Timing ───────────────────────────────────────────────────────────────
  /** ★ Max per-cell start delay; makes the garden ripple outward. */
  rippleDelay: 0.4,
  /** How much of that delay comes from distance (vs. per-cell random). */
  rippleDistanceShare: 0.55,
  /** Grey → green square fade (growth). Retract uses retractSeconds. */
  squareFadeSeconds: 1.5,
  /** Spring "settle" constant: ωt at which a critically damped spring is ~99% there. */
  springSettle: 6.6,

  // ── Plant shape ──────────────────────────────────────────────────────────
  stemHeight: [1.5, 3.6] as [number, number], // in cell heights
  /** ★ Flower radius as a fraction of one cell pitch. */
  flowerScale: 0.74,
  leafScale: 0.75,
  /** Fraction of final stem height reached by the end of the stem stage; the rest comes with bud/bloom. */
  stemShareAtStage: 0.8,
  /** Max lean of a stem, radians either side. */
  maxLean: 0.2,

  // ── Sway / nodding ───────────────────────────────────────────────────────
  /** ★ How far the tip moves sideways at full sway, as a fraction of stem height. */
  swayTipBend: 0.16,
  swayMinAmp: 0.3,
  swayRampSeconds: 3,
  /** Max head nod (≈ ±6°). */
  nodMax: 0.105,
  /** Flower head lags the stem by this much time. */
  headLag: 0.22,
  leafFlutter: 0.22,

  // ── Petals ───────────────────────────────────────────────────────────────
  petalStartDwell: 2,
  /** ★ Petals per bloomed flower per second once fully ramped. */
  petalRate: 0.05,
  petalRampSeconds: 5,
  maxPetals: 40,
  petalLife: 4,
  petalFallSpeed: 22, // px/s terminal velocity

  // ── Bees ─────────────────────────────────────────────────────────────────
  beeStartDwell: 1.5,
  /** ★ A new bee is invited every N seconds of dwell, until maxBees. */
  beeEverySeconds: 1.1,
  beeSpeed: 95, // px/s
  beeHover: [1, 2.5] as [number, number],
  /** How much a flower dips under a bee, as a fraction of stem height. */
  beeDip: 0.05,

  /** Clamp for frame delta so a backgrounded tab doesn't explode the springs. */
  maxDt: 1 / 30,
};
