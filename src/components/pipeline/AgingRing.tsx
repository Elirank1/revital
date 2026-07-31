/**
 * AgingRing — days-in-stage ring, CSS only (no chart lib) — Wave 1 (kanban-ui).
 *
 * A conic-gradient ring that fills toward the red threshold (10d) with the
 * day count centered. Colors: fresh <5d (emerald), warn ≥5d (amber),
 * late ≥10d (red) — thresholds live in aging.ts. Exposes `data-aging`
 * for tests and an Arabic-numeral day count (tabular) with a Hebrew
 * aria-label for screen readers.
 */

import { agingFraction, agingLevel, type AgingLevel } from './aging';

const RING_COLOR: Record<AgingLevel, string> = {
  fresh: '#10b981', // emerald-500
  warn: '#f59e0b', // amber-500
  late: '#ef4444', // red-500
};

const TEXT_CLASS: Record<AgingLevel, string> = {
  fresh: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  late: 'text-red-600 dark:text-red-400',
};

export function AgingRing({ days }: { days: number }) {
  const level = agingLevel(days);
  const fillDeg = Math.round(agingFraction(days) * 360);

  return (
    <div
      role="img"
      aria-label={`${days} ימים בשלב הנוכחי`}
      data-aging={level}
      data-days={days}
      className="relative h-9 w-9 shrink-0"
      title={`${days} ימים בשלב`}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(${RING_COLOR[level]} ${fillDeg}deg, rgba(148,163,184,0.25) 0deg)`,
        }}
      />
      <div className="absolute inset-[3px] rounded-full bg-white dark:bg-slate-900 flex items-center justify-center">
        <span className={`text-[11px] font-semibold tabular-nums ${TEXT_CLASS[level]}`}>
          {days}
        </span>
      </div>
    </div>
  );
}

export default AgingRing;
