import { CSSProperties, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { ContributionDay, formatDate, layoutCells } from './data';
import { EngineOptions, GardenEngine, GardenLayout, GridRect } from './engine';
import { GardenPalette, PALETTES } from './sprites';
import { TUNING } from './tuning';

export interface CommitGardenProps {
  data: ContributionDay[];
  /** Activation radius in cells. */
  radius?: number;
  /** Seconds to full bloom. */
  growSeconds?: number;
  /** Seconds to fully retract. */
  retractSeconds?: number;
  maxBees?: number;
  palette?: Partial<GardenPalette>;
  cellSize?: number;
  gap?: number;
  theme?: 'light' | 'cream';
  /** Let a square's commit count bias its plant's height and flower size. */
  commitBias?: boolean;
  /** Month and weekday labels around the grid. */
  showLabels?: boolean;
  /** Visible "N contributions on <date>" tooltip. Screen readers are told either way. */
  showTooltip?: boolean;
  className?: string;
  style?: CSSProperties;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CommitGarden({
  data,
  radius = 7,
  growSeconds = 1.5,
  retractSeconds = 1,
  maxBees = 4,
  palette: paletteOverride,
  cellSize = 14,
  gap = 3,
  theme = 'light',
  commitBias = true,
  showLabels = false,
  showTooltip = false,
  className,
  style,
}: CommitGardenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GardenEngine | null>(null);
  const hoverRef = useRef(-1);
  const tipId = useId();

  const cells = useMemo(() => layoutCells(data), [data]);
  const palette = useMemo<GardenPalette>(
    () => ({ ...PALETTES[theme], ...paletteOverride }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, JSON.stringify(paletteOverride ?? null)],
  );

  const layout = useMemo<GardenLayout>(() => {
    const pitch = cellSize + gap;
    const cols = cells.length ? cells[cells.length - 1].col + 1 : 53;
    const bleedX = Math.round(pitch * 1.5); // room for leaning stems and bees entering
    const bleedTop = Math.round(pitch * (TUNING.stemHeight[1] + 1.4)); // plants grow up over the cells above
    const bleedBottom = Math.round(pitch * 0.8);
    const gridLeft = bleedX + (showLabels ? 30 : 0);
    const gridTop = bleedTop + (showLabels ? 18 : 0);
    return {
      cellSize, gap, pitch, cols, gridLeft, gridTop,
      width: gridLeft + cols * pitch - gap + bleedX,
      height: gridTop + 7 * pitch - gap + bleedBottom,
    };
  }, [cells, cellSize, gap, showLabels]);

  // Index lookup for O(1) hit-testing: (col,row) → cell index.
  const cellAt = useMemo(() => {
    const a = new Int32Array(layout.cols * 7).fill(-1);
    cells.forEach((c, i) => (a[c.col * 7 + c.row] = i));
    return a;
  }, [cells, layout.cols]);

  const total = useMemo(() => cells.reduce((s, c) => s + c.count, 0), [cells]);

  const monthLabels = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    let lastMonth = -1, lastCol = -99;
    for (const c of cells) {
      if (c.row !== 0) continue; // first day of each week column
      const m = Number(c.date.slice(5, 7)) - 1;
      if (m !== lastMonth) {
        if (c.col - lastCol >= 3) {
          out.push({ x: layout.gridLeft + c.col * layout.pitch, label: MONTHS[m] });
          lastCol = c.col;
        }
        lastMonth = m;
      }
    }
    return out;
  }, [cells, layout]);

  // ── Engine lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const engine = new GardenEngine(canvasRef.current!);
    engineRef.current = engine;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => engine.setReducedMotion(mq.matches);
    mq.addEventListener('change', onMq);
    engine.setReducedMotion(mq.matches);
    return () => {
      mq.removeEventListener('change', onMq);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const rects = Array.from(svgRef.current!.querySelectorAll<SVGRectElement>('rect[data-i]'));
    const byIndex: (SVGRectElement | null)[] = new Array(cells.length).fill(null);
    for (const r of rects) byIndex[Number(r.dataset.i)] = r;
    const opts: EngineOptions = { radius, growSeconds, retractSeconds, maxBees, palette, commitBias };
    engineRef.current?.configure(cells, byIndex, layout, opts);
  }, [cells, layout, radius, growSeconds, retractSeconds, maxBees, palette, commitBias]);

  // ── Hover / tooltip (imperative: no React state per move) ─────────────────
  // ── Pointing, selecting & tooltip (imperative: no React state per move) ──
  const selRef = useRef<GridRect | null>(null);
  const dragRef = useRef<{ anchor: { col: number; row: number }; moved: boolean; touch: boolean } | null>(null);
  const outlineRef = useRef<SVGRectElement>(null);

  const inSel = (i: number) => {
    const s = selRef.current;
    if (!s || i < 0) return false;
    const c = cells[i];
    return c.col >= s.c0 && c.col <= s.c1 && c.row >= s.r0 && c.row <= s.r1;
  };

  const placeTip = (text: string, col: number, row: number, rightEdgeCol = col) => {
    if (liveRef.current) liveRef.current.textContent = text;
    if (!showTooltip) return;
    const tip = tipRef.current!;
    tip.textContent = text;
    // Sit below-left of the square so neither the cursor nor the bloom hides it.
    const x = layout.gridLeft + col * layout.pitch;
    const y = layout.gridTop + (row + 1) * layout.pitch + 4;
    const flip = col < 14;
    const xr = layout.gridLeft + rightEdgeCol * layout.pitch;
    tip.style.transform = flip
      ? `translate(${xr + layout.cellSize + 10}px, ${y}px)`
      : `translate(${x - 6}px, ${y}px) translateX(-100%)`;
    tip.style.opacity = '1';
  };
  const hideTip = () => (tipRef.current!.style.opacity = '0');

  /** The cursor is over cell i (-1 = nowhere). Hover-grows unless it is inside the planted patch. */
  const point = useCallback(
    (i: number) => {
      hoverRef.current = i;
      engineRef.current?.setHover(i >= 0 && !inSel(i) ? i : -1);
      if (i < 0) return hideTip();
      const c = cells[i];
      placeTip(`${c.count === 0 ? 'No' : c.count} contribution${c.count === 1 ? '' : 's'} on ${formatDate(c.date)}`, c.col, c.row);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells, layout, showTooltip],
  );

  const setSelection = useCallback(
    (rect: GridRect | null, anchor?: { col: number; row: number }, showOutline = false) => {
      selRef.current = rect;
      engineRef.current?.setSelection(rect, anchor);
      const o = outlineRef.current;
      if (!o) return;
      if (rect && showOutline) {
        const pad = layout.gap / 2 + 1;
        o.setAttribute('x', String(layout.gridLeft + rect.c0 * layout.pitch - pad));
        o.setAttribute('y', String(layout.gridTop + rect.r0 * layout.pitch - pad));
        o.setAttribute('width', String((rect.c1 - rect.c0 + 1) * layout.pitch - layout.gap + pad * 2));
        o.setAttribute('height', String((rect.r1 - rect.r0 + 1) * layout.pitch - layout.gap + pad * 2));
        o.style.opacity = '1';
      } else {
        o.style.opacity = '0';
      }
    },
    [layout],
  );

  const clearAll = useCallback(() => {
    dragRef.current = null;
    setSelection(null);
    point(-1);
  }, [point, setSelection]);

  useEffect(() => {
    // Data/layout changed under the cursor: reset so state stays consistent.
    clearAll();
  }, [clearAll]);

  /** Pointer → grid position. With clamp, positions outside the grid snap to its edge (for dragging). */
  const gridPos = (clientX: number, clientY: number, clamp: boolean) => {
    const r = rootRef.current!.getBoundingClientRect();
    const x = clientX - r.left - layout.gridLeft + layout.gap / 2;
    const y = clientY - r.top - layout.gridTop + layout.gap / 2;
    let col = Math.floor(x / layout.pitch), row = Math.floor(y / layout.pitch);
    if (clamp) {
      col = Math.max(0, Math.min(layout.cols - 1, col));
      row = Math.max(0, Math.min(6, row));
    } else if (col < 0 || row < 0 || col >= layout.cols || row >= 7) return null;
    return { col, row };
  };
  const hit = (clientX: number, clientY: number) => {
    const p = gridPos(clientX, clientY, false);
    return p ? cellAt[p.col * 7 + p.row] : -1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pos = gridPos(e.clientX, e.clientY, false);
    if (!pos || cellAt[pos.col * 7 + pos.row] < 0) {
      clearAll();
      return;
    }
    if (e.pointerType === 'mouse') e.preventDefault(); // no text selection while dragging
    dragRef.current = { anchor: pos, moved: false, touch: e.pointerType !== 'mouse' };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const pos = gridPos(e.clientX, e.clientY, true)!;
      if (!drag.moved && (pos.col !== drag.anchor.col || pos.row !== drag.anchor.row)) drag.moved = true;
      if (!drag.moved) return;
      const rect: GridRect = {
        c0: Math.min(drag.anchor.col, pos.col),
        c1: Math.max(drag.anchor.col, pos.col),
        r0: Math.min(drag.anchor.row, pos.row),
        r1: Math.max(drag.anchor.row, pos.row),
      };
      engineRef.current?.setHover(-1);
      setSelection(rect, drag.anchor, true);
      let days = 0, sum = 0;
      for (let c = rect.c0; c <= rect.c1; c++)
        for (let r = rect.r0; r <= rect.r1; r++) {
          const i = cellAt[c * 7 + r];
          if (i >= 0) {
            days++;
            sum += cells[i].count;
          }
        }
      placeTip(`${days} day${days === 1 ? '' : 's'} · ${sum.toLocaleString()} contribution${sum === 1 ? '' : 's'}`, rect.c0, rect.r1, rect.c1);
      return;
    }
    if (e.pointerType === 'touch') return; // touch uses tap
    const i = hit(e.clientX, e.clientY);
    if (i !== hoverRef.current) point(i);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const i = hit(e.clientX, e.clientY);
    if (drag.moved) {
      // Plant it: the patch stays in bloom until a click clears it.
      setSelection(selRef.current, undefined, false);
      if (drag.touch) hideTip();
      else point(i);
    } else {
      // A plain click / tap clears any planted patch and hovers the square.
      setSelection(null);
      hoverRef.current = -2;
      point(i);
    }
  };

  const onPointerCancel = () => {
    if (dragRef.current?.moved) setSelection(selRef.current, undefined, false);
    dragRef.current = null;
  };

  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' && !dragRef.current) point(-1);
  };

  // Pressing anywhere outside the garden clears it.
  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) clearAll();
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [clearAll]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return clearAll();
    const cur = hoverRef.current >= 0 ? cells[hoverRef.current] : cells[cells.length - 1];
    if (!cur) return;
    let { col, row } = cur;
    if (e.key === 'ArrowLeft') col--;
    else if (e.key === 'ArrowRight') col++;
    else if (e.key === 'ArrowUp') row--;
    else if (e.key === 'ArrowDown') row++;
    else return;
    e.preventDefault();
    if (hoverRef.current < 0) return point(cells.length - 1);
    if (col < 0 || row < 0 || col >= layout.cols || row > 6) return;
    const i = cellAt[col * 7 + row];
    if (i >= 0) point(i);
  };

  const rootStyle: CSSProperties = {
    position: 'relative',
    width: layout.width,
    height: layout.height,
    touchAction: 'pan-y', // horizontal drags select; vertical swipes still scroll
    userSelect: 'none',
    WebkitUserSelect: 'none',
    outline: 'none',
    ...style,
  };

  return (
    <div
      ref={rootRef}
      className={className}
      style={rootStyle}
      tabIndex={0}
      role="group"
      aria-roledescription="contribution graph"
      aria-label={`Contribution garden: ${total.toLocaleString()} contributions in the last year. Use arrow keys to explore days; drag across squares to plant an area; Escape clears.`}
      aria-describedby={showTooltip ? tipId : undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        // keyboard focus only — a mouse press shouldn't conjure a garden at the last square
        if (hoverRef.current < 0 && e.currentTarget.matches(':focus-visible')) point(cells.length - 1);
      }}
      onBlur={() => !selRef.current && point(-1)}
    >
      <svg ref={svgRef} width={layout.width} height={layout.height} aria-hidden="true" style={{ display: 'block' }}>
        {showLabels && <g fill={palette.text} fontSize={11} fontFamily="inherit">
          {monthLabels.map((m) => (
            <text key={m.x} x={m.x} y={layout.gridTop - 6}>
              {m.label}
            </text>
          ))}
          {[1, 3, 5].map((r) => (
            <text key={r} x={layout.gridLeft - 6} y={layout.gridTop + r * layout.pitch + cellSize * 0.8} textAnchor="end">
              {['', 'Mon', '', 'Wed', '', 'Fri', ''][r]}
            </text>
          ))}
        </g>}
        {cells.map((c, i) => (
          <rect
            key={c.date}
            data-i={i}
            x={layout.gridLeft + c.col * layout.pitch}
            y={layout.gridTop + c.row * layout.pitch}
            width={cellSize}
            height={cellSize}
            rx={Math.max(2, cellSize * 0.2)}
            fill={palette.empty}
          />
        ))}
        <rect
          ref={outlineRef}
          fill="none"
          stroke={palette.greens[2]}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          rx={Math.max(3, cellSize * 0.25)}
          style={{ opacity: 0, transition: 'opacity 0.35s ease' }}
        />
      </svg>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height, pointerEvents: 'none' }}
      />
      <div
        ref={tipRef}
        id={tipId}
        role="tooltip"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          opacity: 0,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          font: '12px/1.2 system-ui, -apple-system, Segoe UI, sans-serif',
          color: '#fff',
          background: 'rgba(36, 41, 47, 0.92)',
          padding: '6px 9px',
          borderRadius: 6,
          transition: 'opacity 120ms ease',
          zIndex: 2,
        }}
      />
      <div
        ref={liveRef}
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      />
    </div>
  );
}

export default CommitGarden;
