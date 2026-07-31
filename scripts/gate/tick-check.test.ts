/**
 * Self-test for scripts/gate/tick-check.sh (quality-gate, Wave 2 batch C).
 *
 * The gate script itself must be trustworthy: this suite runs it against
 * a LOCAL in-process http stub (127.0.0.1, ephemeral port — never a real
 * deployment, gate G2) that mimics the tick protocol, and against a
 * deliberately broken stub, asserting the script's verdicts and exit
 * codes:
 *
 *   - missing env → exit 64 + usage (secret never required to be echoed);
 *   - conforming endpoint (405 GET / 401 wrong-or-missing auth /
 *     200 {"ok":true,"ran":[],"partial":false}) → exit 0;
 *   - endpoint that accepts a WRONG secret (auth hole) → exit 2;
 *   - endpoint that answers GET 200 (cron-mismatch silently "fixed"
 *     server-side without the contract changing) → exit 2.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'tick-check.sh',
);
const SECRET = 'local-stub-secret';

interface RunResult {
  status: number;
  output: string;
}

/** Async on purpose: the stub http server lives on THIS event loop —
 *  a sync exec would deadlock (curl waits for a server that can't run). */
function runScript(env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      [SCRIPT],
      {
        env: { ...process.env, TICK_URL: '', CRON_SECRET: '', ...env },
        encoding: 'utf8',
        timeout: 60_000,
      },
      (err, stdout, stderr) => {
        const status = err
          ? ((err as { code?: number }).code ?? -1)
          : 0;
        resolve({ status, output: `${stdout}${stderr}` });
      },
    );
  });
}

type StubMode = 'conforming' | 'accepts-wrong-secret' | 'get-200';

function startStub(mode: StubMode): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization;
    const direct = req.headers['x-cron-secret'];
    const authed = auth === `Bearer ${SECRET}` || direct === SECRET;
    const wrongButAccepted = mode === 'accepts-wrong-secret';

    if (req.method !== 'POST') {
      if (mode === 'get-200' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ran: [], partial: false }));
        return;
      }
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    if (!authed && !wrongButAccepted) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid cron secret' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, ran: [], partial: false, note: 'no access codes configured' }),
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/api/agents/tick` });
    });
  });
}

describe('tick-check.sh gate self-test', () => {
  it('exits 64 with usage when TICK_URL / CRON_SECRET are missing', async () => {
    const noneSet = await runScript({});
    expect(noneSet.status).toBe(64);
    expect(noneSet.output).toContain('TICK_URL and CRON_SECRET must both be set');
    expect(noneSet.output).toContain('Required environment');

    const urlOnly = await runScript({ TICK_URL: 'http://127.0.0.1:1/api/agents/tick' });
    expect(urlOnly.status).toBe(64);
  });

  it('passes (exit 0) against a protocol-conforming endpoint', async () => {
    const { server, url } = await startStub('conforming');
    try {
      const result = await runScript({ TICK_URL: url, CRON_SECRET: SECRET });
      expect(result.output).toContain('all checks passed');
      expect(result.status).toBe(0);
      // The 503-unset limitation is surfaced to the operator every run.
      expect(result.output).toContain('not');
      expect(result.output).toContain('remotely testable');
      // The secret value itself never appears in the output.
      expect(result.output).not.toContain(SECRET);
    } finally {
      server.close();
    }
  });

  it('fails (exit 2) when the endpoint accepts a wrong secret', async () => {
    const { server, url } = await startStub('accepts-wrong-secret');
    try {
      const result = await runScript({ TICK_URL: url, CRON_SECRET: SECRET });
      expect(result.status).toBe(2);
      expect(result.output).toContain('FAIL');
      expect(result.output).toContain('401');
    } finally {
      server.close();
    }
  });

  it('fails (exit 2) when GET is answered 200 (POST-only contract broken)', async () => {
    const { server, url } = await startStub('get-200');
    try {
      const result = await runScript({ TICK_URL: url, CRON_SECRET: SECRET });
      expect(result.status).toBe(2);
      expect(result.output).toContain('GET is rejected');
    } finally {
      server.close();
    }
  });
});
