import { useEffect, useMemo, useRef, useState } from 'react';
import { CommitGarden } from './garden/CommitGarden';
import { generateFakeData } from './garden/data';

export default function App() {
  const data = useMemo(() => generateFakeData(7, new Date()), []);

  // Fit the cell size to the available width.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(14);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const gap = 3;
      const pitch = Math.floor(e.contentRect.width / 56); // 53 columns + side bleed
      setCellSize(Math.max(8, Math.min(16, pitch - gap)));
    });
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);

  return (
    <main className="page">
      <section className="garden" ref={wrapRef}>
        <div className="garden-scroll">
          <CommitGarden data={data} cellSize={cellSize} gap={3} />
        </div>
      </section>
    </main>
  );
}
