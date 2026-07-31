// Append-only audit-log module (plan §7 rails: audit log {actor, action, before, after, ts},
// rotated per §5 — client keeps last N events per entity).
//
// Pure functions only: nothing here mutates its inputs, touches storage, or talks to the
// network. The Zustand store owns persistence; agents and UI code build events with the
// helpers below and append via `appendAuditEvent`.

import type { AuditEvent as PipelineAuditEvent } from '../types/pipeline';

export type { AuditActor } from '../types/pipeline';
import type { AuditActor } from '../types/pipeline';

// Unified with types/pipeline.ts (Wave-0 lead handoff): the canonical AuditEvent now
// carries required entityType/entityId and optional agent.
export type AuditEvent = PipelineAuditEvent;

export interface AuditEventInput {
  actor: AuditActor;
  agent?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Rotation default: keep the last N events per entity (plan §5: N≈500). */
export const DEFAULT_MAX_EVENTS_PER_ENTITY = 500;

function generateId(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for very old environments — still unique enough for a client-side log.
  return `ae-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable rotation key: one bucket per (entityType, entityId). */
export function entityKey(event: Pick<AuditEvent, 'entityType' | 'entityId'>): string {
  return `${event.entityType}:${event.entityId}`;
}

/** Build a complete AuditEvent from partial input. Pure aside from id/clock (injectable via `now`). */
export function createAuditEvent(input: AuditEventInput, now: Date = new Date()): AuditEvent {
  return {
    id: generateId(),
    actor: input.actor,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    ts: now.toISOString(),
  };
}

/** Convenience: an event performed by Revital. */
export function createHumanEvent(
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  now?: Date,
): AuditEvent {
  return createAuditEvent({ actor: 'human', action, entityType, entityId, before, after }, now);
}

/** Convenience: an event performed by a named agent. */
export function createAgentEvent(
  agent: string,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  now?: Date,
): AuditEvent {
  return createAuditEvent({ actor: 'ai', agent, action, entityType, entityId, before, after }, now);
}

/**
 * Rotate an append-only log: keep only the LAST `maxPerEntity` events for each
 * (entityType, entityId) bucket, dropping the oldest first.
 *
 * Assumes `log` is in append (chronological) order, which the append-only rule
 * guarantees. Preserves relative order of retained events. Never mutates `log`;
 * returns the same array instance when nothing needs to be dropped.
 */
export function rotateAuditLog(
  log: readonly AuditEvent[],
  maxPerEntity: number = DEFAULT_MAX_EVENTS_PER_ENTITY,
): AuditEvent[] {
  if (maxPerEntity <= 0) return [];

  const counts = new Map<string, number>();
  for (const event of log) {
    const key = entityKey(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const dropRemaining = new Map<string, number>();
  for (const [key, count] of counts) {
    if (count > maxPerEntity) dropRemaining.set(key, count - maxPerEntity);
  }
  if (dropRemaining.size === 0) return log as AuditEvent[];

  const rotated: AuditEvent[] = [];
  for (const event of log) {
    const key = entityKey(event);
    const remaining = dropRemaining.get(key);
    if (remaining !== undefined && remaining > 0) {
      dropRemaining.set(key, remaining - 1); // oldest events drop first
      continue;
    }
    rotated.push(event);
  }
  return rotated;
}

/**
 * Append an event to the log and rotate the affected entity's bucket.
 * Pure: returns a new array; `log` is never mutated (append-only discipline).
 */
export function appendAuditEvent(
  log: readonly AuditEvent[],
  event: AuditEvent,
  maxPerEntity: number = DEFAULT_MAX_EVENTS_PER_ENTITY,
): AuditEvent[] {
  return rotateAuditLog([...log, event], maxPerEntity);
}

/** All events for one entity, in chronological order (for the card-back trail). */
export function eventsForEntity(
  log: readonly AuditEvent[],
  entityType: string,
  entityId: string,
): AuditEvent[] {
  return log.filter((e) => e.entityType === entityType && e.entityId === entityId);
}
