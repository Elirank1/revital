# Revital V3 — Final Status (rule 28)

**Date:** 2026-08-01 · **Branch:** `v3-jump` (tags `v3-wave0..3`) · **HEAD baseline:** typecheck clean · **889/889 unit** (69 files) · **15/15 e2e, 0 fixme** · send-path gate clean · Drive bundle backup current.

**Rule-27 audit: 37 MET / 2 remaining — both deliberately blocked on Eliran-gated ceremonies** (⑤.4 deployed-tick validation, ⑦.1 real-data backfill rehearsal; see BOARD-STATUS audit table). Hygiene backlog: eslint setup (D-061).

## What exists

- **Wave 0** — types contract, /api/data v2 (additive, v3 section behind `X-Revital-V3: 1`), guards (preview write-guard, CRON_SECRET fail-closed), spend caps, audit log (append-only, rotated), tombstoned deletes + server-assigned versions.
- **Wave 1** — deal-Kanban board (9 stages + Bench + Rejected), single-writer store contract, drag+undo, backfill dry-run importer, dedupe, aging rings.
- **Wave 2** — money layer (fees, priors-as-ranges, EV, qualified pipeline, calibration mode), Pit Boss + SLA (deterministic), tick protocol + Redis bridge (suggestions/agentRuns only), Money Board, Today view, mandate reports + boolean strings.
- **Wave 3** — Bench Sourcer (LLM, spend-capped, precision throttle), Approvals Inbox + morning digest, card-back trail, paste-a-thread parser, deletion cascade + retention, guarantee timers, invoice reminders, **progressive seeding wizard (D-042)**, mobile fix, full Playwright e2e.
- **Incident work (D-041/D-053)** — production Upstash died (pre-existing): one-click backup tool delivered, merge-rehearsal harness ready, new KV provisioned + wired (all envs), `sync-restore` branch pinned byte-identical to production.

## Demo script

**URL:** https://revital-k6qm0x2nj-elirank512-1022s-projects.vercel.app (Preview, behind Vercel Authentication — open while logged in to Vercel; deployed from `v3-jump` HEAD). Local alternative: `npm run dev` → localhost.

**Flag flip:** DevTools console → `localStorage.setItem('revital_v3_flag','on')` → reload. (Default off — flag-off is byte-identical V2.) Turn off: `localStorage.removeItem('revital_v3_flag')`.

**3-minute walkthrough (Hebrew UI):**
1. *(flag off)* Dashboard → Analyze — הזרימה הישנה נקייה ולא נגועה. *(30s)*
2. Flip flag → טאב **לוח**: 9 עמודות + Bench. גרירת כרטיס בין שלבים → טוסט ביטול (6 שניות) → ביטול עובד. *(30s)*
3. מנדט לא-seeded: צ'יפ **"השלימי הגדרה"** → ה-wizard: שדה עמלה אחד + אישור שלבים לכרטיסים שיובאו → סיום → ₪ נדלק לאותו מנדט בלבד (לפני כן: אפס ₪ — האינווריאנט). *(45s)*
4. טאב **היום**: דירוג Pit Boss (fee×aging), פריט עם טיוטה → אישור → נפתח `wa.me` — רק בקליק אנושי (G4). *(30s)*
5. טאב **אישורים**: "מה מחכה לך הבוקר" — הצעות מקובצות לפי סוכן, אישור/דחייה בבאצ', עריכה לפני אישור (edit-rate נמדד). *(30s)*
6. כרטיס → **פרטים**: טרייל מלא + הדבקת שיחת WhatsApp → תצוגת פרסור → החלה. כלי לוח → ניהול נתונים: ייצוא-הכל, retention, מחיקה עם ייצוא-לפני-מחיקה. *(15s)*

## Gate map — exact clicks

- **G3 (KV) — DONE 2026-08-01:** Upstash provisioned (prefix STORAGE) + `KV_REST_API_URL`/`KV_REST_API_TOKEN` rewired in all envs. Supabase swap stays future-optional (schema + mock client ready).
- **Sync-restore ceremony (D-053, separate from G1), runs the moment the backup lands in Drive `60-personal/revital/backups/`:** rehearse-restore on the file → deploy `sync-restore` (content-identical, prompt pinned) `--prod` → `/api/data` 200 + two-browser round-trip. Only remaining human step: **provide the backup file**.
- **G1 (ship V3):** one package — fast-forward `main` (decide D-040 prompt), Vercel Git connect, `vercel.json` crons entry (GET `/api/agents/cron` + `CRON_SECRET`/`TICK_CODES` envs), deployed tick-check (⑤.4), then merge `v3-jump` + flag-on rollout. Backlog rider: eslint (D-061).
- **G2 (live data):** backfill dry-run on the real backup (⑦.1) → reviewed report → click apply.
- **G4 (outreach):** structurally impossible — e2e block-all fixture pins that no external send path exists; `wa.me`/`mailto` are inert hrefs.

## Seeding replacement (D-042)

The human seeding session is gone. Per-mandate wizard (fee + drag-to-true-stage) lifts calibration per mandate; baselines auto-derive from history (nulls over fiction); leftover questions ship as a copy-paste async form. Absolute invariant, pinned at unit AND e2e level in both directions: **no ₪ ever renders for an unseeded mandate.**

## 3 riskiest decisions

1. **D-053 backup-first restore** — Revital's data exists in exactly one browser until the ceremony completes; everything sequences behind one JSON file. Mitigations: one-click tool, rehearsal harness with loss-detection (id-less/dup/cap/size), byte-identical redeploy branch.
2. **D-046/D-047 seeded-gated calibration** — one predicate change gates every ₪ surface; a regression would either leak money-fiction or blank real numbers. Mitigations: fail-closed registry default, both-directions leak sweeps at unit + e2e, wizard as the only lift path.
3. **D-030/D-034 pre-G3 Redis bridge for agents** — tick writes suggestions/agentRuns into the live blob's v3 section (single-writer held by contract, not by infra). Mitigations: server-versioned merge, rotation ≤200, handler tests, cron GET-wrapper kept inert until G1.
