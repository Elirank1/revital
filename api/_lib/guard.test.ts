import { describe, it, expect } from 'vitest';
import { previewWriteBlocked, requireCronSecret, type HeaderCarrier } from './guard';

function req(headers: HeaderCarrier['headers'] = {}): HeaderCarrier {
  return { headers };
}

describe('previewWriteBlocked', () => {
  it('blocks on preview without PREVIEW_DATA_OK', () => {
    expect(previewWriteBlocked({ VERCEL_ENV: 'preview' })).toBe(true);
    expect(previewWriteBlocked({ VERCEL_ENV: 'preview', PREVIEW_DATA_OK: '' })).toBe(true);
  });

  it('allows preview when PREVIEW_DATA_OK is set', () => {
    expect(previewWriteBlocked({ VERCEL_ENV: 'preview', PREVIEW_DATA_OK: '1' })).toBe(false);
  });

  it('never blocks production, development, or local', () => {
    expect(previewWriteBlocked({ VERCEL_ENV: 'production' })).toBe(false);
    expect(previewWriteBlocked({ VERCEL_ENV: 'development' })).toBe(false);
    expect(previewWriteBlocked({})).toBe(false);
  });
});

describe('requireCronSecret', () => {
  const env = { CRON_SECRET: 's3cret' };

  it('fails CLOSED with 503 when CRON_SECRET is unconfigured', () => {
    const r = requireCronSecret(req({ authorization: 'Bearer s3cret' }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it('accepts the Vercel cron convention: Authorization: Bearer <secret>', () => {
    expect(requireCronSecret(req({ authorization: 'Bearer s3cret' }), env).ok).toBe(true);
  });

  it('accepts an explicit x-cron-secret header', () => {
    expect(requireCronSecret(req({ 'x-cron-secret': 's3cret' }), env).ok).toBe(true);
  });

  it('rejects wrong or missing secrets with 401', () => {
    for (const headers of [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: 's3cret' }, // missing Bearer prefix
      { 'x-cron-secret': 'wrong' },
    ]) {
      const r = requireCronSecret(req(headers), env);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
  });

  it('handles array-valued headers by taking the first value', () => {
    expect(requireCronSecret(req({ 'x-cron-secret': ['s3cret', 'other'] }), env).ok).toBe(true);
  });
});
