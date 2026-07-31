// Wave-1 export-everything: legacy + v3 localStorage → one JSON blob, no network
import { describe, it, expect, beforeEach } from 'vitest';

class MemStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemStorage();

const { buildExportBlob, exportAllJson, exportFilename } = await import('./exportAll');

beforeEach(() => localStorage.clear());

describe('buildExportBlob', () => {
  it('collects legacy AND v3 revital_* keys, ignores foreign keys', () => {
    localStorage.setItem('revital_analyses', JSON.stringify([{ id: 'a1' }]));
    localStorage.setItem('revital_savedJobs', JSON.stringify([{ id: 'j1' }]));
    localStorage.setItem('revital_v3_deals', JSON.stringify([{ id: 'd1', v: 3 }]));
    localStorage.setItem('revital_v3_flag', 'on'); // bare string value
    localStorage.setItem('other_app_key', '"nope"');

    const blob = buildExportBlob(() => new Date('2026-07-31T12:00:00.000Z'));
    expect(blob.app).toBe('revital');
    expect(blob.exportedAt).toBe('2026-07-31T12:00:00.000Z');
    expect(Object.keys(blob.keys).sort()).toEqual([
      'revital_analyses',
      'revital_savedJobs',
      'revital_v3_deals',
      'revital_v3_flag',
    ]);
    expect(blob.keys['revital_analyses']).toEqual([{ id: 'a1' }]);
    expect(blob.keys['revital_v3_deals']).toEqual([{ id: 'd1', v: 3 }]);
    expect(blob.keys['revital_v3_flag']).toBe('on'); // unparsable JSON kept raw
    expect(blob.keys['other_app_key']).toBeUndefined();
  });

  it('is a pure read — localStorage is untouched', () => {
    localStorage.setItem('revital_analyses', '[]');
    buildExportBlob();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('revital_analyses')).toBe('[]');
  });
});

describe('exportAllJson / exportFilename', () => {
  it('round-trips through JSON.parse', () => {
    localStorage.setItem('revital_v3_persons', JSON.stringify([{ id: 'p1', name: 'רון כהן' }]));
    const parsed = JSON.parse(exportAllJson(() => new Date('2026-07-31T12:00:00.000Z')));
    expect(parsed.keys.revital_v3_persons[0].name).toBe('רון כהן');
    expect(parsed.schemaVersion).toBe(1);
  });

  it('names the download deterministically', () => {
    expect(exportFilename(() => new Date(2026, 6, 31, 14, 5))).toBe(
      'revital-export-2026-07-31-1405.json',
    );
  });
});
