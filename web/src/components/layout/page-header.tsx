import { useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * Tiêu đề trang gọn một hàng: tên trang + mô tả 1 dòng bên trái, nút chức năng bên phải.
 * Nút dùng <Button> mặc định (h-9) để hàng nút luôn thẳng.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 animate__animated animate__fadeIn">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 animate__animated animate__fadeIn">{actions}</div>
      )}
    </div>
  );
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Motif = 'heart' | 'star' | 'sparkle' | 'leaf' | 'flower' | 'bubble';
const MOTIFS: Motif[] = ['heart', 'star', 'sparkle', 'leaf', 'flower', 'bubble'];

const MOTIF_PATHS: Partial<Record<Motif, string>> = {
  heart: 'M0 0.35C-0.9-0.2-0.5-0.95 0-0.45C0.5-0.95 0.9-0.2 0 0.35Z',
  star: 'M0-1L0.265-0.364L0.951-0.309L0.428 0.139L0.588 0.809L0 0.45L-0.588 0.809L-0.428 0.139L-0.951-0.309L-0.265-0.364Z',
  sparkle: 'M0-1Q0.12-0.12 1 0Q0.12 0.12 0 1Q-0.12 0.12-1 0Q-0.12-0.12 0-1Z',
  leaf: 'M0-1C0.8-0.5 0.8 0.5 0 1C-0.8 0.5-0.8-0.5 0-1Z',
};

function MotifShape({ kind }: { kind: Motif }) {
  if (kind === 'flower')
    return (
      <>
        {[0, 72, 144, 216, 288].map((a) => (
          <circle key={a} cx={0} cy={-0.5} r={0.42} transform={`rotate(${a})`} />
        ))}
      </>
    );
  if (kind === 'bubble')
    return <circle r={0.75} fill="none" stroke="currentColor" strokeWidth={0.14} />;
  return <path d={MOTIF_PATHS[kind]} />;
}

const VB_W = 300;
const VB_H = 180;

/** Họa tiết nhỏ dễ thương (tim, sao, lấp lánh, lá, hoa, bong bóng) rải đều theo lưới, cố định theo seed. */
export function CardPattern({ seed, compact = false }: { seed: string; compact?: boolean }) {
  const cols = compact ? 18 : 7;
  const rows = compact ? 10 : 4;
  const motifs = useMemo(() => {
    const rand = seededRandom(seed);
    const cellW = VB_W / cols;
    const cellH = VB_H / rows;
    return Array.from({ length: cols * rows }, (_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        kind: MOTIFS[Math.floor(rand() * MOTIFS.length)],
        x: (col + 0.2 + rand() * 0.6) * cellW,
        y: (row + 0.2 + rand() * 0.6) * cellH,
        s: compact ? 1.2 + rand() * 1.2 : 7 + rand() * 6,
        rot: (rand() - 0.5) * 60,
      };
    });
  }, [seed, cols, rows, compact]);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-primary"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {motifs.map((m, i) => (
        <g
          key={i}
          transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)}) rotate(${m.rot.toFixed(1)}) scale(${m.s.toFixed(1)})`}
          fill="currentColor"
          opacity="0.14"
        >
          <MotifShape kind={m.kind} />
        </g>
      ))}
    </svg>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <div
      className="animate__animated animate__fadeIn relative flex flex-col overflow-hidden rounded-xl p-[1.5px] shadow-sm"
      style={{ animationDelay: `${delay}ms` }}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[300%] w-[300%]"
        style={{
          x: '-50%',
          y: '-50%',
          background:
            'conic-gradient(from 0deg, transparent 0deg, hsl(var(--primary)) 70deg, hsl(var(--primary) / 0.25) 140deg, transparent 220deg, hsl(var(--primary) / 0.6) 300deg, transparent 360deg)',
        }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
      />
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-[10.5px] bg-card p-5 text-card-foreground">
        <CardPattern seed={label} />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <div className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? 'text-primary' : ''}`}>
              {value}
            </div>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              {icon}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
