import { describe, it, expect } from 'vitest';
import {
  serverMergeCollection,
  clientPullMerge,
  tombstone,
  liveOnly,
} from './merge';
import type { Versioned } from '../../types/pipeline';

interface Rec extends Versioned {
  name: string;
}

const rec = (id: string, v: number, name: string, deleted?: true): Rec => ({
  id,
  v,
  updatedAt: '2026-07-31T00:00:00.000Z',
  name,
  ...(deleted ? { deleted } : {}),
});

describe('serverMergeCollection (LWW on server-assigned versions)', () => {
  it('inserts unknown records and stamps server versions from vCounter', () => {
    const out = serverMergeCollection<Rec>([], [rec('a', 0, 'A'), rec('b', 0, 'B')], 0);
    expect(out.records).toHaveLength(2);
    expect(out.records.map((r) => r.v).sort()).toEqual([1, 2]);
    expect(out.vCounter).toBe(2);
    expect(out.accepted).toEqual(['a', 'b']);
    expect(out.staleDropped).toEqual([]);
  });

  it('accepts an edit whose base version matches the stored version', () => {
    const stored = [rec('a', 5, 'old')];
    const out = serverMergeCollection<Rec>(stored, [rec('a', 5, 'new')], 5);
    const a = out.records.find((r) => r.id === 'a')!;
    expect(a.name).toBe('new');
    expect(a.v).toBe(6); // freshly stamped
    expect(out.vCounter).toBe(6);
  });

  it('drops a stale write — server copy wins (LWW)', () => {
    const stored = [rec('a', 9, 'server')];
    const out = serverMergeCollection<Rec>(stored, [rec('a', 3, 'stale-client')], 9);
    const a = out.records.find((r) => r.id === 'a')!;
    expect(a.name).toBe('server');
    expect(a.v).toBe(9); // untouched
    expect(out.staleDropped).toEqual(['a']);
    expect(out.accepted).toEqual([]);
    expect(out.vCounter).toBe(9); // no stamp for rejected writes
  });

  it('never resurrects a tombstone from a stale live copy', () => {
    const dead = { ...rec('a', 10, 'gone'), deleted: true as const };
    const staleLive = rec('a', 4, 'zombie');
    const out = serverMergeCollection<Rec>([dead], [staleLive], 10);
    const a = out.records.find((r) => r.id === 'a')!;
    expect(a.deleted).toBe(true);
    expect(out.staleDropped).toEqual(['a']);
  });

  it('allows intentional undelete by a client that has seen the tombstone', () => {
    const dead = { ...rec('a', 10, 'gone'), deleted: true as const };
    const undelete = rec('a', 10, 'restored'); // carries tombstone version, no deleted flag
    const out = serverMergeCollection<Rec>([dead], [undelete], 10);
    const a = out.records.find((r) => r.id === 'a')!;
    expect(a.deleted).toBeUndefined();
    expect(a.name).toBe('restored');
    expect(a.v).toBe(11);
  });

  it('keeps tombstones in the collection (delete is never physical)', () => {
    const stored = [rec('a', 1, 'A'), { ...rec('b', 2, 'B'), deleted: true as const }];
    const out = serverMergeCollection<Rec>(stored, [rec('c', 0, 'C')], 2);
    expect(out.records.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('treats missing/invalid incoming v as 0 (new-client safety)', () => {
    const stored = [rec('a', 2, 'server')];
    const noV = { id: 'a', updatedAt: 'x', name: 'client' } as unknown as Rec;
    const out = serverMergeCollection<Rec>(stored, [noV], 2);
    expect(out.records.find((r) => r.id === 'a')!.name).toBe('server');
    expect(out.staleDropped).toEqual(['a']);
  });

  it('vCounter is monotonic across sequential merges', () => {
    let vCounter = 0;
    let stored: Rec[] = [];
    for (let i = 0; i < 5; i++) {
      const out = serverMergeCollection<Rec>(stored, [rec(`r${i}`, 0, `N${i}`)], vCounter);
      stored = out.records;
      expect(out.vCounter).toBe(vCounter + 1);
      vCounter = out.vCounter;
    }
    expect(stored.map((r) => r.v).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores malformed records without an id', () => {
    const junk = [{ v: 0, name: 'no-id' } as unknown as Rec, null as unknown as Rec];
    const out = serverMergeCollection<Rec>([], junk, 0);
    expect(out.records).toHaveLength(0);
    expect(out.vCounter).toBe(0);
  });
});

describe('clientPullMerge', () => {
  it('takes remote when remote.v is higher', () => {
    const merged = clientPullMerge([rec('a', 1, 'local')], [rec('a', 3, 'remote')]);
    expect(merged.find((r) => r.id === 'a')!.name).toBe('remote');
  });

  it('keeps local at equal or higher v (dirty local edits win the next POST)', () => {
    const merged = clientPullMerge(
      [rec('a', 3, 'local-edit'), rec('b', 5, 'local')],
      [rec('a', 3, 'remote'), rec('b', 2, 'remote-stale')],
    );
    expect(merged.find((r) => r.id === 'a')!.name).toBe('local-edit');
    expect(merged.find((r) => r.id === 'b')!.name).toBe('local');
  });

  it('keeps records present on only one side', () => {
    const merged = clientPullMerge([rec('a', 1, 'A')], [rec('b', 2, 'B')]);
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('propagates remote tombstones over older local live copies', () => {
    const deadRemote = { ...rec('a', 7, 'gone'), deleted: true as const };
    const merged = clientPullMerge([rec('a', 2, 'live')], [deadRemote]);
    expect(merged.find((r) => r.id === 'a')!.deleted).toBe(true);
  });
});

describe('tombstone / liveOnly', () => {
  it('tombstone marks deleted with timestamp, preserving id and v', () => {
    const t = tombstone(rec('a', 4, 'A'), '2026-07-31T12:00:00.000Z');
    expect(t.deleted).toBe(true);
    expect(t.deletedAt).toBe('2026-07-31T12:00:00.000Z');
    expect(t.id).toBe('a');
    expect(t.v).toBe(4);
  });

  it('liveOnly filters tombstones', () => {
    const list = [rec('a', 1, 'A'), { ...rec('b', 2, 'B'), deleted: true as const }];
    expect(liveOnly(list).map((r) => r.id)).toEqual(['a']);
  });
});
