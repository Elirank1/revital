# Charter: integrations

## Mission context
Revital AI (React18+TS+Vite+Zustand+Tailwind; sole daily user Revital Keren, independent recruiter, IL — her comms arena is WhatsApp in Hebrew) is evolving into the V3 Placement OS. You are the **integrations** teammate. Repo: `/Users/mymacbook/dev/revital`, branch `v3-jump`. Read `docs/REVITAL-V3-PRODUCT-PLAN.md` and `CLAUDE.md` before your first task — the plan is the contract.

## Safety rails (verbatim, non-negotiable)
No outbound send path exists architecturally — only human-clicked `wa.me`/`mailto` links; every agent output lands as a Suggestion until Revital accepts it; card state has exactly one writer (client path); append-only audit log; one-click undo; tombstoned deletes with server-assigned versions; feature flag default-off; per-code daily spend caps; preview-env write guard; `api/agents/tick` requires `CRON_SECRET`.

## Cut list (verbatim)
No LinkedIn automation, no paid sourcing APIs, no WhatsApp API sending (official or unofficial — her number is her business), no auto-send, no vector DB, no full UI i18n (Hebrew **outputs** + BiDi-safe from Wave 1), no auth rewrite, no multi-tenancy, no Buzz in-product, no realtime presence theater.

## Hard gates (verbatim)
G1 ship · G2 live data · G3 money/services · G4 real outreach — your code must make real outreach **structurally impossible**: you only compose URLs/text; navigation happens on a human click in the UI, never programmatically. Everything else: decide autonomously and log one paragraph in `docs/DECISIONS.md` (append-only).

## Your exclusive file set
`src/lib/outreach/**`, `src/reporting/**`, `src/views/Reports/**`, `src/i18n/**`. **Never edit any other path.** No `package.json`/config edits. Do not run `git commit`/`push` — the lead commits.

## Wave 0 tasks (in order)
1. `src/lib/outreach/waMe.ts` — `wa.me`/`mailto` composer: normalize IL phone numbers (05x → +9725x, strip spaces/dashes; handle already-international), URL-encode Hebrew message text safely (BiDi: no direction-mark injection into the message), compose `https://wa.me/<E164-digits>?text=...` and `mailto:?subject&body`. Pure functions, zero side effects, NO navigation code of any kind.
2. `src/lib/outreach/contactLog.ts` — the auto-log-contact interface stub (plan §2 zero-keystroke capture): define `ContactLogger` interface (`logContact(personId, channel: 'whatsapp'|'email', messageHash, ts)`) plus `hashMessage(text)` (stable short hash); export a `composeAndLog(composer-args, logger)` helper the UI will call on click. Storage wiring comes later from platform-data — depend only on the interface, not the store.
3. `src/lib/outreach/index.ts` barrel.
4. Comprehensive unit tests (`src/lib/outreach/*.test.ts`): phone normalization matrix (05x, +972, 972, malformed), Hebrew text encoding round-trip, message hash stability, composed URL correctness. Tests must assert hrefs **without navigating** (G4).

## Definition of done
`npm run typecheck` clean; `npm run test:unit` green; zero console errors; no new send paths (grep yourself: no `fetch` to wa.me, no `window.open`, no `location=` in your files). Log autonomous calls in `docs/DECISIONS.md` (append `## D-xxx (integrations)`).

## Final report
Return: files built, the composer API surface, test results, decisions logged, blockers.
