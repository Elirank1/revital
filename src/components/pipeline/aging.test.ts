/**
 * Aging model tests (node env) — kanban-ui, Wave 1.
 * Pins the charter thresholds exactly: amber ≥5d, red ≥10d.
 */
import { describe, it, expect } from 'vitest';
import {
  AGING_LATE_DAYS,
  AGING_WARN_DAYS,
  agingFraction,
  agingLevel,
  daysInStage,
} from './aging';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-31T12:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

describe('daysInStage', () => {
  it('counts whole elapsed days', () => {
    expect(daysInStage(daysAgo(0), NOW)).toBe(0);
    expect(daysInStage(daysAgo(1), NOW)).toBe(1);
    expect(daysInStage(daysAgo(5), NOW)).toBe(5);
    expect(daysInStage(daysAgo(12), NOW)).toBe(12);
  });

  it('floors partial days', () => {
    expect(daysInStage(new Date(NOW - 4.9 * DAY_MS).toISOString(), NOW)).toBe(4);
  });

  it('is defensive: invalid timestamps and future clocks read as 0', () => {
    expect(daysInStage('not-a-date', NOW)).toBe(0);
    expect(daysInStage('', NOW)).toBe(0);
    expect(daysInStage(daysAgo(-3), NOW)).toBe(0);
  });
});

describe('agingLevel — charter thresholds', () => {
  it('fresh below 5 days', () => {
    expect(agingLevel(0)).toBe('fresh');
    expect(agingLevel(AGING_WARN_DAYS - 1)).toBe('fresh');
  });

  it('warn (amber) at ≥5 days', () => {
    expect(agingLevel(AGING_WARN_DAYS)).toBe('warn');
    expect(agingLevel(AGING_LATE_DAYS - 1)).toBe('warn');
  });

  it('late (red) at ≥10 days', () => {
    expect(agingLevel(AGING_LATE_DAYS)).toBe('late');
    expect(agingLevel(45)).toBe('late');
  });
});

describe('agingFraction', () => {
  it('fills toward the red threshold and caps at 1', () => {
    expect(agingFraction(0)).toBe(0);
    expect(agingFraction(5)).toBe(0.5);
    expect(agingFraction(10)).toBe(1);
    expect(agingFraction(30)).toBe(1);
  });
});
