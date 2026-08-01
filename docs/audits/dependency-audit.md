# Dependency audit — Wave 3 Batch C (quality-gate)

Run: 2026-08-01, `npm audit` on `v3-jump` (npm cache per mission convention), 486 packages (82 prod / 393 dev).
**Result: 10 advisories — 0 critical, 7 high, 3 moderate, 0 low.** No upgrades performed (per dispatch: document only; any upgrade needs a lead CONFIG line).

## The one-sentence picture

**Every single advisory chains through one direct devDependency: `@vercel/node@^5.1.8`.** Nothing the browser client ships (`react`, `zustand`, `@dnd-kit/*`, `@upstash/redis`, `@anthropic-ai/sdk`, `pdfjs-dist`, `mammoth`, `lucide-react`) carries an advisory, and nothing in the test toolchain (`vitest`, `@playwright/test`, `jsdom`, `vite`) does either.

## Advisory table

| Package (transitive via) | Severity | Advisory | Affected path in this repo | Exploitable here? |
|---|---|---|---|---|
| `@vercel/node` (direct, dev) | high (rollup) | umbrella — flagged via its dependency tree below | `node_modules/@vercel/node` | See per-dep rows; the package itself is types + local build glue |
| `path-to-regexp` 4.0.0–6.2.2 | high | ReDoS via backtracking regexes ([GHSA-9wv6-86v2-598j](https://github.com/advisories/GHSA-9wv6-86v2-598j)) | `@vercel/node → path-to-regexp` | **No.** Only exploitable when routing attacker-supplied paths through `path-to-regexp` at runtime. Local dev uses vite (`npm run dev`); `vercel dev` is not part of any script. Production routing runs on Vercel's own platform-pinned builder, not this lockfile. |
| `undici` ≤6.26.0 | high (11 advisories) | WebSocket DoS, response smuggling, CRLF injection, header injection, etc. | `@vercel/node → undici` | **No.** undici here is the fetch bundled for the local `vercel dev` emulator, which this repo never runs. The client uses browser `fetch`; unit tests mock `fetch`; e2e blocks external networking entirely. |
| `minimatch` 10.0.0–10.2.2 | high (3 advisories) | ReDoS via crafted glob patterns ([GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) et al.) | `@vercel/node → @vercel/python-analysis → minimatch` | **No.** Python-project analysis inside the Vercel build tooling; this repo has no Python and never invokes that analyzer locally. Globs would have to be attacker-controlled. |
| `js-yaml` 4.0.0–4.2.0 | high | Quadratic-CPU DoS via YAML merge-key chains ([GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m)) | `@vercel/node → @vercel/python-analysis → js-yaml` | **No.** Requires parsing attacker-supplied YAML; no YAML is parsed anywhere in dev/test/runtime flows of this repo. |
| `smol-toml` <1.6.1 | moderate | DoS via crafted TOML ([GHSA-v3rj-xjv7-4jmq](https://github.com/advisories/GHSA-v3rj-xjv7-4jmq)) | `@vercel/node → @vercel/python-analysis → smol-toml` | **No.** Same reasoning: no TOML parsing in any exercised path. |
| `ajv` 7.0.0–8.17.1 | moderate | ReDoS when using the `$data` option ([GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6)) | `@vercel/node → @vercel/static-config → ajv` | **No.** `$data` option not used; schema validation only runs inside Vercel build tooling on repo-authored config. |
| `@vercel/build-utils`, `@vercel/python-analysis`, `@vercel/static-config` | high/moderate | No advisories of their own — flagged as carriers of the rows above | `@vercel/node` tree | Same as their children. |

## Context that bounds the blast radius

- `@vercel/node` is a **devDependency** consumed for the `VercelRequest`/`VercelResponse` types in `api/*.ts` and their vitest suites. It is **not** bundled into the client (`vite build` enters through `index.html → src/main.tsx`; no shipping module under `src/` imports `@vercel/*` — the single reference is a type-only import in a test file, erased at compile time and unreachable from the bundle), and it is **not** the runtime that executes the serverless functions in production: Vercel's build pipeline compiles `api/*.ts` with its own platform-side, platform-patched toolchain.
- Every advisory class here (ReDoS / parser DoS / client-side smuggling in a dev-server fetch stack) requires feeding attacker-controlled input into a code path this repo never runs locally. The dev loop is `vite` + `vitest` + `playwright` — none of which import the `@vercel/node` tree.
- npm's suggested "fix" is `@vercel/node@3.0.1`, i.e. a **semver-major downgrade** two majors back — an audit-resolver artifact, not a sane remediation. The forward fix is a future `@vercel/node` release that bumps its own tree.

## Recommendation (no action taken)

1. **Accept for now.** Dev-only exposure, no exercised attack surface, no critical advisories. Nothing blocks Wave-3 closure or G-gates.
2. **Revisit at the G1 ceremony**: check for a newer `@vercel/node` major/minor whose tree clears `path-to-regexp`/`undici`/`minimatch`, and bump `js-yaml`/`smol-toml` via lockfile refresh at the same time (both have in-range fixes: `fixAvailable: true`).
3. Any upgrade is a **lead CONFIG decision** — `package.json` is outside quality-gate ownership (single narrow grant used this batch: the `test:e2e` script line).
