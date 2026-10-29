import { useEffect, useRef, useState } from 'react';
import type { DrawShape, DrawTool } from '@shared/contracts';

interface Props {
  shapes: DrawShape[];
  /** Video frame aspect (width / height) so the layer covers exactly the picture, not the letterbox. */
  aspect: number;
  editable: boolean;
  tool: DrawTool;
  color: string;
  onAdd: (shape: DrawShape) => void;
}

type Pt = [number, number];

/**
 * Telestrator overlay. Shapes are stored in frame-normalized coordinates (0..1) and drawn in
 * pixels, so they stay put across window sizes and fullscreen.
 */
export function DrawLayer({ shapes, aspect, editable, tool, color, onAdd }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<DrawShape | null>(null);

  useEffect(() => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    const fit = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      setSize(W / H > aspect ? { w: H * aspect, h: H } : { w: W, h: W / aspect });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const norm = (e: React.PointerEvent): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const onDown = (e: React.PointerEvent) => {
    if (!editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = norm(e);
    setLive({ tool, color, points: [p, p] });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!live) return;
    const p = norm(e);
    if (live.tool === 'pen') {
      const last = live.points[live.points.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.003) return;
      setLive({ ...live, points: [...live.points, p] });
    } else {
      setLive({ ...live, points: [live.points[0]!, p] });
    }
  };
  const onUp = () => {
    if (!live) return;
    const [a, b] = [live.points[0]!, live.points[live.points.length - 1]!];
    if (live.tool === 'pen' ? live.points.length > 2 : Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.01) onAdd(live);
    setLive(null);
  };

  const all = live ? [...shapes, live] : shapes;
  return (
    <div
      ref={boxRef}
      className={`draw-layer ${editable ? 'editing' : ''}`}
      style={{ width: size.w, height: size.h }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setLive(null)}
    >
      <svg width={size.w} height={size.h}>
        {all.map((s, i) => (
          <Shape key={i} s={s} w={size.w} h={size.h} />
        ))}
      </svg>
    </div>
  );
}

function Shape({ s, w, h }: { s: DrawShape; w: number; h: number }) {
  const px = s.points.map(([x, y]) => [x * w, y * h] as Pt);
  const stroke = { stroke: s.color, strokeWidth: Math.max(3, w / 300), fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (s.tool === 'pen') return <polyline points={px.map((p) => p.join(',')).join(' ')} {...stroke} />;
  const [a, b] = [px[0]!, px[px.length - 1]!];
  if (s.tool === 'circle') {
    return <ellipse cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} rx={Math.abs(b[0] - a[0]) / 2} ry={Math.abs(b[1] - a[1]) / 2} {...stroke} />;
  }
  // arrow: shaft + filled head
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const head = Math.max(14, w / 60);
  const p1: Pt = [b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45)];
  const p2: Pt = [b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45)];
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} {...stroke} />
      <polygon points={`${b.join(',')} ${p1.join(',')} ${p2.join(',')}`} fill={s.color} />
    </g>
  );
}
