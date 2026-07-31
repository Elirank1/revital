import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_EVENTS_PER_ENTITY,
  appendAuditEvent,
  createAgentEvent,
  createAuditEvent,
  createHumanEvent,
  entityKey,
  eventsForEntity,
  rotateAuditLog,
  type AuditEvent,
} from './audit';

function makeEvent(entityId: string, n: number, entityType = 'deal'): AuditEvent {
  return createAuditEvent(
    {
      actor: 'ai',
      agent: 'screener',
      action: `event-${n}`,
      entityType,
      entityId,
      before: { n: n - 1 },
      after: { n },
    },
    new Date(Date.UTC(2026, 6, 31, 0, 0, n)),
  );
}

describe('createAuditEvent', () => {
  it('fills id, ts, and defaults before/after to null', () => {
    const now = new Date('2026-07-31T07:14:00.000Z');
    const e = createAuditEvent(
      { actor: 'human', action: 'card.moved', entityType: 'deal', entityId: 'd1' },
      now,
    );
    expect(e.id).toBeTruthy();
    expect(e.ts).toBe('2026-07-31T07:14:00.000Z');
    expect(e.before).toBeNull();
    expect(e.after).toBeNull();
    expect(e.actor).toBe('human');
    expect('agent' in e).toBe(false);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeEvent('d1', 0).id));
    expect(ids.size).toBe(200);
  });

  it('convenience helpers set actor and agent correctly', () => {
    const h = createHumanEvent('suggestion.accepted', 'suggestion', 's1');
    expect(h.actor).toBe('human');
    expect(h.agent).toBeUndefined();

    const a = createAgentEvent('pitboss', 'suggestion.created', 'suggestion', 's2', null, { rank: 1 });
    expect(a.actor).toBe('ai');
    expect(a.agent).toBe('pitboss');
    expect(a.after).toEqual({ rank: 1 });
  });
});

describe('rotateAuditLog', () => {
  it('keeps the log untouched when all buckets are under the cap', () => {
    const log = [makeEvent('d1', 1), makeEvent('d2', 2)];
    const out = rotateAuditLog(log, 5);
    expect(out).toBe(log); // same instance — no churn when nothing drops
  });

  it('drops the OLDEST events per entity, keeping the last N', () => {
    const log = Array.from({ length: 10 }, (_, i) => makeEvent('d1', i));
    const out = rotateAuditLog(log, 3);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.action)).toEqual(['event-7', 'event-8', 'event-9']);
  });

  it('rotates per entity independently and preserves interleaved order', () => {
    const log: AuditEvent[] = [];
    for (let i = 0; i < 6; i++) {
      log.push(makeEvent('d1', i));
      log.push(makeEvent('d2', i));
    }
    const out = rotateAuditLog(log, 4);
    expect(eventsForEntity(out, 'deal', 'd1')).toHaveLength(4);
    expect(eventsForEntity(out, 'deal', 'd2')).toHaveLength(4);
    // Order preserved: retained events remain chronologically interleaved
    const actions = out.map((e) => `${e.entityId}:${e.action}`);
    expect(actions).toEqual([
      'd1:event-2', 'd2:event-2',
      'd1:event-3', 'd2:event-3',
      'd1:event-4', 'd2:event-4',
      'd1:event-5', 'd2:event-5',
    ]);
  });

  it('distinguishes same id across different entity types', () => {
    const log = [
      ...Array.from({ length: 3 }, (_, i) => makeEvent('x', i, 'deal')),
      ...Array.from({ length: 3 }, (_, i) => makeEvent('x', i, 'person')),
    ];
    const out = rotateAuditLog(log, 2);
    expect(eventsForEntity(out, 'deal', 'x')).toHaveLength(2);
    expect(eventsForEntity(out, 'person', 'x')).toHaveLength(2);
  });

  it('returns empty for non-positive caps', () => {
    expect(rotateAuditLog([makeEvent('d1', 1)], 0)).toEqual([]);
  });

  it('defaults to 500 per entity', () => {
    expect(DEFAULT_MAX_EVENTS_PER_ENTITY).toBe(500);
    const log = Array.from({ length: 505 }, (_, i) => makeEvent('d1', i));
    const out = rotateAuditLog(log);
    expect(out).toHaveLength(500);
    expect(out[0].action).toBe('event-5');
  });
});

describe('appendAuditEvent', () => {
  it('appends without mutating the original log', () => {
    const log = [makeEvent('d1', 0)];
    const snapshot = [...log];
    const out = appendAuditEvent(log, makeEvent('d1', 1));
    expect(log).toEqual(snapshot);
    expect(out).toHaveLength(2);
    expect(out).not.toBe(log);
  });

  it('rotates the affected entity on append', () => {
    let log: AuditEvent[] = [];
    for (let i = 0; i < 7; i++) log = appendAuditEvent(log, makeEvent('d1', i), 5);
    expect(log).toHaveLength(5);
    expect(log[0].action).toBe('event-2');
    expect(log[4].action).toBe('event-6');
  });
});

describe('entityKey / eventsForEntity', () => {
  it('builds a stable bucket key', () => {
    expect(entityKey({ entityType: 'deal', entityId: 'd1' })).toBe('deal:d1');
  });

  it('filters chronologically for the card-back trail', () => {
    const log = [makeEvent('d1', 0), makeEvent('d2', 1), makeEvent('d1', 2)];
    const trail = eventsForEntity(log, 'deal', 'd1');
    expect(trail.map((e) => e.action)).toEqual(['event-0', 'event-2']);
  });
});
