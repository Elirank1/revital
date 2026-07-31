# V3 Decisions Log

Append-only. Every autonomous call + one paragraph of rationale (mission rule 5). An unlogged decision is a bug.

---

## D-001 · 2026-07-31 · Execution environment: local clone, adapted swarm
The mission prompt targets Claude Code Agent Teams launched from a tmux terminal session. This build runs instead inside a Claude desktop session acting as the lead, with background subagents playing the five teammate roles (same charters, same disjoint file ownership, same rules 2/3/6/13/24/25). Work happens on a fresh local clone at `~/dev/revital` because the canonical checkout lives on Google Drive CloudStorage where `git status` alone times out (>2 min) — a build loop there is not viable. Remote is unchanged (`Elirank1/revital`); only `v3-jump` gets pushed (G1 untouched). The Drive checkout is left untouched as-is.

## D-002 · 2026-07-31 · Repo identity: Elirank1/revital, not the monorepo
Memory said code lives in `Elirank1/monorepo packages/revital`, but the deployed app (Vercel project `revital`, revital-three.vercel.app) is wired to the standalone repo `Elirank1/revital` via the nested `.git` inside the Drive tree. The monorepo copy (`Elirank1/eliran-s-blog` remote) is a stale snapshot. V3 builds on `Elirank1/revital`.

## D-003 · 2026-07-31 · Uncommitted Drive work preserved on `wip-fingerprint-drive`
The Drive working tree carried unpushed work: `src/modules/fingerprint/**` (search-criteria fingerprint module), `api/fetch-url.ts`, and edits to JobInput/ModuleActions/appStore/types. Committed verbatim to local branch `wip-fingerprint-drive` (645eefa) so nothing is lost. It is NOT merged into `v3-jump` — it's an unfinished V2.x feature, unrelated to the V3 contract, and `v3-jump` branches from the deployed `main` per plan §5. Eliran decides its fate later.

## D-004 · 2026-07-31 · gh CLI token invalid; push uses repo-embedded token
`gh auth status` reports an invalid keyring token. Git push for `v3-jump` uses the working token already embedded in the monorepo remote URL (same GitHub account). PR creation via `gh` is unavailable until Eliran re-runs `gh auth login` — not a blocker for any pre-G1 work.
