# Revital V3 — Runbook

Owner: quality-gate. Page 1 — local dev, env, branch model.

## Run it locally

All commands from the repo root (`~/dev/revital`, branch `v3-jump`):

| What | Command | Notes |
|---|---|---|
| Dev server | `npm run dev` | Vite on `http://localhost:5173`. `localhost` counts as proxy mode, so the app will try `/api/*` — without `vercel dev` those calls fail gracefully (sync shows `error`, analysis needs a key). |
| Build | `npm run build` | `tsc && vite build` → `dist/`. Build fails on type errors by design. |
| Typecheck only | `npm run typecheck` | `tsc --noEmit`. Scope is `"include": ["src"]` — `api/` and `e2e/` are not typechecked by this command. |
| Unit tests | `npm run test:unit` | `vitest run`, node environment, no config file — picks up every `*.test.ts(x)` outside `node_modules`. Tests mock `fetch`/`localStorage`/Upstash: they must never hit real endpoints (gate G2). |
| Watch mode | `npm run test:watch` | Same suite, interactive. |
| Lint | `npm run lint` | ESLint, zero-warning budget. |
| Send-path gate | `./scripts/gate/check-no-send-paths.sh` | Exits 2 if `src/` grows a programmatic wa.me/mailto/WhatsApp-API send path (gate G4). |

## Environment variables (names only — values live in Vercel, never in the repo)

Required by the serverless APIs (`api/*.ts`):

- `ANTHROPIC_API_KEY` — Claude proxy (`api/analyze.ts`)
- `ACCESS_CODE` — shared auth code checked via `X-Access-Code` header (`api/analyze.ts`, `api/data.ts`)
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Upstash Redis blob for cross-device sync (`api/data.ts`)
- Enrich Layer key — LinkedIn enrichment (`api/linkedin.ts`)
- Gemini key — transcription (`api/transcribe.ts`)

None of these are needed to run the client or the unit tests: the client works in direct mode with a user-supplied key, and every test mocks its dependencies. Do not put values in `.env` files inside the repo.

## Branch model: what `v3-jump` + preview means

- **`main` = production.** Vercel auto-promotes `main` to the production deployment used daily. Merging to `main` is gate **G1** — lead + Eliran only.
- **`v3-jump` = the V3 build branch.** All Wave work lands here in small commits (lead commits; teammates never `git commit`/`push`). Pushing `v3-jump` produces a **Vercel preview deployment** — a separate URL, same env vars, safe to demo.
- **Preview write guard:** on preview deployments (`VERCEL_ENV === 'preview'`) new data paths are read-only/503 unless `PREVIEW_DATA_OK` is set — a preview must never mutate the live Upstash blob (gate G2).
- Live-data operations of any kind (migrations, imports, deletes against the real blob or Revital's localStorage) are gate G2: dry-run and flag-gated only, rehearsed on a copy.
