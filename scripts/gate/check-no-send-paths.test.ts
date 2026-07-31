/**
 * Pins scripts/gate/check-no-send-paths.sh (quality-gate, Wave 1).
 *
 * The G4 send-path gate is only useful if it (a) stays green on the real
 * repo and (b) actually trips on every forbidden pattern class. Fixture
 * trees are built in a temp dir with the script copied in (it resolves
 * src/ relative to its own location), so the repo is never touched and
 * nothing here depends on network or repo state beyond src/ itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_SCRIPT = resolve(__dirname, 'check-no-send-paths.sh');

interface RunResult {
  status: number;
  stdout: string;
}

function runScript(scriptPath: string): RunResult {
  try {
    const stdout = execFileSync('bash', [scriptPath], { encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer };
    return { status: e.status ?? -1, stdout: String(e.stdout ?? '') };
  }
}

/** Build <root>/{scripts/gate/check-no-send-paths.sh, src/...} and return the script path. */
function makeFixture(root: string, files: Record<string, string>): string {
  const gateDir = join(root, 'scripts', 'gate');
  mkdirSync(gateDir, { recursive: true });
  const script = join(gateDir, 'check-no-send-paths.sh');
  copyFileSync(REPO_SCRIPT, script);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return script;
}

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gate-fixture-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('check-no-send-paths.sh on the real repo', () => {
  it('exits 0 — src/ has no programmatic send paths', () => {
    const { status, stdout } = runScript(REPO_SCRIPT);
    expect(stdout).toContain('OK');
    expect(status).toBe(0);
  });
});

describe('check-no-send-paths.sh on violation fixtures', () => {
  const cases: { name: string; file: string; code: string; label: string }[] = [
    {
      name: 'window.open on wa.me (src-wide)',
      file: 'src/lib/bad.ts',
      code: `export function f(){ window.open('https://wa.me/972501234567'); }`,
      label: 'window.open(...wa.me...)',
    },
    {
      name: 'location.href to mailto (src-wide)',
      file: 'src/lib/bad.ts',
      code: `export function f(){ location.href = 'mailto:x@y.z'; }`,
      label: 'location.href = ...wa.me|mailto...',
    },
    {
      name: 'fetch to wa.me (src-wide, Wave-1 domain)',
      file: 'src/lib/bad.ts',
      code: `export function f(){ return fetch('https://wa.me/9725', {method:'POST'}); }`,
      label: 'fetch(...wa.me|graph.facebook|whatsapp API...)',
    },
    {
      name: 'fetch to graph.facebook (src-wide)',
      file: 'src/lib/bad.ts',
      code: `export function f(){ return fetch('https://graph.facebook.com/v19.0/msgs'); }`,
      label: 'fetch(...wa.me|graph.facebook|whatsapp API...)',
    },
    {
      name: 'ANY window.open under src/views (strict)',
      file: 'src/views/Bad/BadView.tsx',
      code: `export function f(){ window.open('https://example.com'); }`,
      label: 'STRICT src/views|src/agents: window.open(',
    },
    {
      name: 'ANY location.href assignment under src/views (strict)',
      file: 'src/views/Bad/BadView.tsx',
      code: `export function f(){ window.location.href = '/somewhere'; }`,
      label: 'STRICT src/views|src/agents: location.href =',
    },
    {
      name: 'location.assign under src/agents (strict)',
      file: 'src/agents/bad.ts',
      code: `export function f(){ location.assign('/x'); }`,
      label: 'STRICT src/views|src/agents: location.assign(/replace(',
    },
    {
      name: 'sendBeacon under src/agents (strict)',
      file: 'src/agents/bad.ts',
      code: `export function f(){ navigator.sendBeacon('/collect', 'data'); }`,
      label: 'STRICT src/views|src/agents: sendBeacon(',
    },
  ];

  for (const c of cases) {
    it(`exits 2 and names the pattern: ${c.name}`, () => {
      const root = join(tmp, c.name.replace(/[^a-z0-9]+/gi, '-'));
      const script = makeFixture(root, { [c.file]: c.code });
      const { status, stdout } = runScript(script);
      expect(status).toBe(2);
      expect(stdout).toContain('FORBIDDEN SEND PATHS');
      expect(stdout).toContain(c.label);
      expect(stdout).toContain(c.file.split('/').pop()!);
    });
  }

  it('stays clean when forbidden patterns appear only in *.test.* files (fixture quoting)', () => {
    const root = join(tmp, 'clean-test-quoting');
    const script = makeFixture(root, {
      'src/views/Bad/BadView.test.tsx': `const s = "window.open('https://wa.me/1')"; export {};`,
      'src/agents/ok.ts': `export const href = 'https://wa.me/972501234567'; // string only — legal`,
    });
    const { status, stdout } = runScript(script);
    expect(stdout).toContain('OK');
    expect(status).toBe(0);
  });

  it('a plain <a href> composer (string building, no calls) stays legal', () => {
    const root = join(tmp, 'clean-composer');
    const script = makeFixture(root, {
      'src/views/Ok/OkView.tsx': `export const wa = (d: string) => 'https://wa.me/' + d;`,
    });
    const { status } = runScript(script);
    expect(status).toBe(0);
  });
});
