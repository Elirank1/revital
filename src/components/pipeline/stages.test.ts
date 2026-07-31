/**
 * Column model + flags helper tests (node env) — kanban-ui.
 *
 * Migrated from the Wave-0 PipelineView.test.tsx (which became a real
 * jsdom DOM test in Wave 1): these cover the pure logic that needs no DOM.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isV3Enabled, setV3Flag, V3_FLAG_KEY } from './flags';
import { STAGE_COLUMNS, BENCH_RAIL, REJECTED_LABEL, stageLabel } from './stages';
import { PIPELINE_STAGES } from '../../types/pipeline';

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
      expect(stage.he).toMatch(/[֐-׿]/);
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

  it('stageLabel covers every DealStage including Bench and Rejected', () => {
    for (const col of STAGE_COLUMNS) {
      expect(stageLabel(col.id)).toEqual({ he: col.he, en: col.en });
    }
    expect(stageLabel('Bench')).toEqual({ he: BENCH_RAIL.he, en: BENCH_RAIL.en });
    expect(stageLabel('Rejected')).toEqual({
      he: REJECTED_LABEL.he,
      en: REJECTED_LABEL.en,
    });
  });
});
