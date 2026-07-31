/**
 * PipelineView Wave-0 tests (kanban-ui).
 *
 * No DOM test lib is installed (no jsdom / @testing-library) — per charter
 * task 5 these tests cover the pure logic instead: the flags helper, the
 * column model, and PipelineView invoked directly as a pure function (it is
 * hook-free in Wave 0), asserting on the returned React element tree.
 * CONFIG need for real DOM tests is logged in docs/BOARD-STATUS.md.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isV3Enabled, setV3Flag, V3_FLAG_KEY } from '../../components/pipeline/flags';
import { STAGE_COLUMNS, BENCH_RAIL } from '../../components/pipeline/stages';
import { PIPELINE_STAGES } from '../../types/pipeline';
import { PipelineView } from './PipelineView';

/** Minimal in-memory localStorage for the node test environment. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

beforeEach(() => {
  (globalThis as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

/** Collect all string content from a React element tree (no DOM needed). */
function collectText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    // Render nested function components (e.g. StageColumn) so their output counts.
    if (typeof el.type === 'function') {
      return collectText(
        (el.type as (props: unknown) => ReactNode)(el.props),
      );
    }
    return collectText(el.props.children);
  }
  return '';
}

describe('flags helper', () => {
  it('is OFF by default', () => {
    expect(isV3Enabled()).toBe(false);
  });

  it('turns on with setV3Flag(true) and reads back on', () => {
    setV3Flag(true);
    expect(localStorage.getItem(V3_FLAG_KEY)).toBe('on');
    expect(isV3Enabled()).toBe(true);
  });

  it('setV3Flag(false) removes the key (byte-identical to never-set)', () => {
    setV3Flag(true);
    setV3Flag(false);
    expect(localStorage.getItem(V3_FLAG_KEY)).toBeNull();
    expect(isV3Enabled()).toBe(false);
  });

  it('only the exact value "on" enables the flag', () => {
    localStorage.setItem(V3_FLAG_KEY, 'true');
    expect(isV3Enabled()).toBe(false);
    localStorage.setItem(V3_FLAG_KEY, 'ON');
    expect(isV3Enabled()).toBe(false);
  });

  it('reads OFF and no-ops writes when localStorage is unavailable', () => {
    // Simulate a non-browser context.
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(isV3Enabled()).toBe(false);
    expect(() => setV3Flag(true)).not.toThrow();
    expect(isV3Enabled()).toBe(false);
  });
});

describe('column model', () => {
  it('mirrors the canonical PipelineStage ids from types/pipeline.ts, in order', () => {
    expect(STAGE_COLUMNS.map((s) => s.id)).toEqual([...PIPELINE_STAGES]);
    expect(STAGE_COLUMNS).toHaveLength(9);
  });

  it('every stage carries both Hebrew and English labels', () => {
    for (const stage of STAGE_COLUMNS) {
      expect(stage.he.length).toBeGreaterThan(0);
      expect(stage.en.length).toBeGreaterThan(0);
      // Hebrew label actually contains Hebrew characters.
      expect(stage.he).toMatch(/[֐-׿]/);
      // English label contains no Hebrew.
      expect(stage.en).not.toMatch(/[֐-׿]/);
    }
  });

  it('matches the charter labels exactly', () => {
    expect(STAGE_COLUMNS.map((s) => `${s.he} ${s.en}`)).toEqual([
      'מקורות Sourced',
      'סוננו Screened',
      'פנייה Outreach',
      'בשיחה In Conversation',
      'הוגשו Submitted',
      'ראיון לקוח Client Interview',
      'הצעה Offer',
      'הושמו Placed',
      'שולם Paid',
    ]);
  });

  it('defines the Bench rail', () => {
    expect(BENCH_RAIL.en).toBe('Bench');
    expect(BENCH_RAIL.he).toMatch(/[֐-׿]/);
  });
});

describe('PipelineView (pure invocation — hook-free in Wave 0)', () => {
  it('renders nothing when the flag is off (default)', () => {
    expect(PipelineView()).toBeNull();
  });

  it('renders all 9 column headers (Hebrew + English) and the Bench rail when on', () => {
    setV3Flag(true);
    const tree = PipelineView();
    expect(tree).not.toBeNull();
    const text = collectText(tree);
    for (const stage of STAGE_COLUMNS) {
      expect(text).toContain(stage.he);
      expect(text).toContain(stage.en);
    }
    expect(text).toContain(BENCH_RAIL.he);
    expect(text).toContain(BENCH_RAIL.en);
  });
});
