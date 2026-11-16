# Commit Garden 🌸

A GitHub-style contribution heatmap that turns into a hand-painted wildflower garden under your cursor.

Hover over a square and the grid around it slowly turns green: stems rise, leaves unfurl, buds open into watercolour flowers. Leave the cursor still and the garden comes alive: plants sway in the wind, petals drift down and bees fly in to visit the flowers. Drag across the grid to plant a whole patch at once.

Built with React + TypeScript and a single `<canvas>`. No animation libraries.

> _Add your demo video or GIF here (drag `commit-garden.mp4` into a GitHub issue or PR to get an embeddable link)._

---

## Features

- **Hover to grow.** Every square within a radius of the cursor grows a plant. The closer a square is to the cursor, the further its plant grows: full blooms near the cursor, bare sprouts at the edge.
- **Drag to plant.** Press on a square and drag. Every day in the rectangle you cover blooms, rippling out from where you started. The patch stays until you click.
- **Rest and watch.** Leave the cursor still and the garden gets livelier: it sways after a moment, bees arrive after 1.5 s and petals start falling after 2 s.
- **Smooth reversal.** Move away and the old garden folds back into grey squares, faster than it grew. Squares shared between the old and new areas just change direction, without restarting.
- **Hand-painted look.** Eight watercolour varieties: cosmos, buttercup, aster, daisy, calendula, coneflower, tulip and a nodding fritillary bell.
- **Same plant every time.** Each square's plant is generated from its date, so a given day always grows the same flower.
- **Commit-aware.** Busier days can grow taller plants with bigger flowers (optional).
- **Fast.** One `requestAnimationFrame` loop that stops completely when nothing is moving, pre-drawn flower images, and no React re-renders while animating. Runs at 60 fps with a radius of 7.
- **Accessible.** Keyboard navigation, screen-reader announcements and `prefers-reduced-motion` support.

## Quick start

```bash
npm install
npm run dev      # demo at http://localhost:5173
npm run build    # type-check, then bundle into a single self-contained dist/index.html
```

## Usage

The component lives in `src/garden/`. Copy that folder into your project (it only needs React 18+).

```tsx
import { CommitGarden } from './garden/CommitGarden';
import { generateFakeData } from './garden/data';

const data = generateFakeData(); // or your real contributions

export default function Profile() {
  return <CommitGarden data={data} />;
}
```

### Data format

```ts
type ContributionDay = {
  date: string;  // 'YYYY-MM-DD' (UTC)
  count: number;
};
```

Pass about one year of days. The component lays them out like GitHub: one column per week, Sunday to Saturday. It also works out each square's green shade from its count (levels 1–4, by quartile). `generateFakeData(seed?, endDate?)` produces a believable year of fake activity, with weekday bias, streaks and the odd big day.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `ContributionDay[]` | required | Days to display. |
| `radius` | `number` | `7` | How far around the cursor plants grow, in cells. |
| `growSeconds` | `number` | `1.5` | Time to full bloom. |
| `retractSeconds` | `number` | `1` | Time to fold back into a square. |
| `maxBees` | `number` | `4` | Maximum bees at once (`0` turns bees off). |
| `cellSize` | `number` | `14` | Square size in px. |
| `gap` | `number` | `3` | Space between squares in px. |
| `theme` | `'light' \| 'cream'` | `'light'` | White or warm cream background palette. |
| `palette` | `Partial<GardenPalette>` | — | Override square, stem, leaf or flower colours. |
| `commitBias` | `boolean` | `true` | Busier days grow taller plants with bigger flowers. |
| `showLabels` | `boolean` | `false` | Show month and weekday labels. |
| `showTooltip` | `boolean` | `false` | Show a "N contributions on <date>" tooltip. |
| `className`, `style` | | — | Passed to the root element. |

## Interactions

| Input | What it does |
| --- | --- |
| Hover | Grows a garden around the cursor. |
| Rest the cursor | The garden sways, then bees arrive and petals fall. |
| Click and drag | Plants the rectangle you drag over. |
| Click / click outside / `Esc` | Clears a planted patch. |
| Arrow keys (when focused) | Move the hover from day to day. |
| Touch: tap | Same as hover; tap elsewhere to move it. |
| Touch: drag sideways | Plants an area (vertical swipes still scroll the page). |

## How it works

```
src/garden/
├── CommitGarden.tsx  React wrapper: SVG squares, canvas overlay, pointer and keyboard input
├── engine.ts         animation loop, per-square growth, plant drawing, petals, bees
├── sprites.ts        draws the watercolour flowers, leaves, buds and bees ahead of time
├── data.ts           seeded random numbers, fake data generator, GitHub-style layout
└── tuning.ts         every feel-related constant in one place
```

- **Two layers.** The squares are SVG `<rect>`s. Their grey-to-green fade is a CSS transition, updated only when the hovered square changes. The plants, petals and bees are drawn on a transparent `<canvas>` on top, which ignores the pointer, so plants can grow up over the squares above them. The canvas is sharp on high-density screens and adjusts when the pixel density changes.
- **One number per square.** Each square has a growth value `g` from 0 to 1, stored in a typed array. Its target is `clamp(1 − d/R, 0, 1)^0.8`, where `d` is the distance to the cursor; squares within `bloomCore` cells are always 1. `g` moves toward its target on a critically damped spring, so it never overshoots and changes direction smoothly when the target changes. Every stage of the plant is read from `g`:

  | `g` range | What happens |
  | --- | --- |
  | 0.00–0.15 | the square turns green |
  | 0.12–0.55 | the stem grows |
  | 0.45–0.75 | leaves unfurl |
  | 0.70–0.85 | a bud forms |
  | 0.85–1.00 | the flower opens |

- **Plant DNA.** Each square's variety, height, lean, leaf count, flower size and sway timing come from a random-number generator seeded by its date. `Math.random()` is never used for plants.
- **Watercolour images.** Every petal, leaf, bud, flower centre and bee is painted once into an offscreen canvas. Each shape is a polygon with slightly roughened edges, filled in several soft layers. Then come darker pigment near the centre, a faint darker line along the edges, small specks of pigment and a few lighter patches. Each frame just places these images, rotated and scaled.
- **Wind.** Stems are curves that bend more toward the tip. Sway is a few overlapping sine waves plus a gust that travels across the grid. Flower heads trail slightly behind their stems and nod up to ±6°.
- **Bees** pick bloomed flowers, preferring ones near the cursor, and fly to them along curved paths. They hover for 1–2.5 s while the flower dips under their weight, then move on. They fly in from beyond the garden's edge and leave the same way.

## Tuning

Everything that affects the feel is in `src/garden/tuning.ts`. Start with these:

| Constant | Default | Effect |
| --- | --- | --- |
| `bloomCore` | `2.1` | Squares within this distance bloom fully. `0` uses the strict formula, where only the hovered square blooms. |
| `falloff` | `0.8` | How quickly growth drops off toward the edge. Lower gives a fuller garden. |
| `flowerScale` | `0.74` | Flower size compared with a square. |
| `leafScale` | `0.75` | Leaf size. |
| `swayTipBend` / `nodMax` | `0.16` / `0.105` | How windy it feels. |
| `rippleDelay` | `0.4` | Maximum start delay per square, which makes growth ripple outward. |
| `beeStartDwell` / `beeEverySeconds` | `1.5` / `1.1` | When the first bee arrives, and how often another follows. |
| `petalStartDwell` / `petalRate` | `2` / `0.05` | When petals start falling, and how many. |

The painted look is controlled in `src/garden/sprites.ts`. `OPACITY` sets paint density (1 is very see-through, 2 is solid colour). The arguments to `wash()` set the number of layers, their strength and how loose the edges are. `VARIETY_DEFS` sets each flower's shape and how often it appears. Colours are in `PALETTES`.

## Accessibility

- The grid is a focusable group with a descriptive `aria-label`. Arrow keys move the hover, and `Esc` clears everything.
- The current day ("N contributions on <date>") is announced in a polite live region, whether or not the visible tooltip is on.
- With `prefers-reduced-motion`, sway, bees and petals are turned off. Plants appear with a short fade-in instead of growing.

## Browser support

Current versions of Chrome, Edge, Firefox and Safari. The component needs the Pointer Events API, `ResizeObserver` and Canvas 2D; no special canvas filters are used.

## License

Add your license of choice (for example MIT) before publishing.
