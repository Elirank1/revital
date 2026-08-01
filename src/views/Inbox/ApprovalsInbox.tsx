/**
 * ApprovalsInbox — the full Wave-3 approvals surface (kanban-ui).
 *
 * Two modes, one component:
 *
 * INBOX — every PENDING suggestion grouped by agent (lexicon display
 * names), with:
 *  - multi-select + batch approve/dismiss (each resolution still routes
 *    through the store one id at a time — acceptSuggestion/
 *    dismissSuggestion stay the ONLY writers, plan §3; a batch is a
 *    convenience loop, not a new mutation path);
 *  - inline edit on draft_message bodies routed through the store's
 *    `acceptSuggestion(id, { editedBody })` (Wave-3 absorption, D-036) —
 *    the wa.me glue then renders EXACTLY the approved text;
 *  - honesty metrics: overall accept-rate + edit-rate from
 *    `computeLeadingIndicators` (null ⇒ '—', never a fake 0) and
 *    per-agent accept-rate from `agentAcceptStats` (the same number the
 *    Bench Sourcer throttle reads).
 *
 * DIGEST — the Wave-3 morning digest contract: a deterministic
 * client-side view titled "מה מחכה לך הבוקר" — pending suggestions
 * grouped by agent + top-3 Pit Boss (via pitbossBridge; uncalibrated
 * items render their reasons MONEY-FREE, D-031) + overdue client
 * feedback (same thresholds as Pit Boss, via the bridge) — with one tap
 * into the inbox mode. Not an email (cut list): it renders in-app only.
 *
 * BiDi: user content dir="auto"; logical CSS. G4: accepting drafts here
 * never navigates — send links live on cards/queue as human-clicked
 * anchors.
 */

import { useMemo, useState } from 'react';
import { usePipelineStore, agentAcceptStats } from '../../store/pipelineStore';
import type { AgentName, Deal, Suggestion } from '../../types/pipeline';
import {
  computeLeadingIndicators,
  flattenContacts,
} from '../../lib/metrics/leadingIndicators';
import { useMoneyStore } from '../../lib/money';
import { calibratedJobIdSet, formatILS } from '../../components/pipeline/money';
import { stageLabel } from '../../components/pipeline/stages';
import { t, durationHe } from '../../i18n';
import { pendingSuggestions } from './SuggestionsQueue';
import {
  overdueFeedbackDeals,
  resolveRankMoveTheMoney,
  type RankedMoneyItem,
  type RankMoveTheMoneyFn,
} from '../Pipeline/pitbossBridge';
import { rankAtRiskDeals } from '../Pipeline/TodayView';

/** Canonical agent order (types/pipeline.ts) — deterministic grouping. */
const AGENT_ORDER: readonly AgentName[] = [
  'screener',
  'bench_sourcer',
  'outreach_runner',
  'client_reporter',
  'pit_boss',
];

const TOP_PIT_BOSS = 3;

// ------------------------------------------------------------
// Pure helpers (exported for tests)
// ------------------------------------------------------------

export interface AgentGroup {
  agent: AgentName;
  items: Suggestion[];
}

/** Pending suggestions grouped by agent, canonical order, newest first. */
export function groupPendingByAgent(suggestions: Suggestion[]): AgentGroup[] {
  const pending = pendingSuggestions(suggestions);
  return AGENT_ORDER.map((agent) => ({
    agent,
    items: pending.filter((s) => s.agent === agent),
  })).filter((g) => g.items.length > 0);
}

/** '75%' or '—' — a rate is shown only when it was actually measured. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

// ------------------------------------------------------------
// Inbox item
// ------------------------------------------------------------

function ApprovalItem({
  suggestion,
  selected,
  onToggleSelect,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  /** editedBody undefined = accepted as-is. */
  onAccept: (id: string, editedBody?: string) => void;
  onDismiss: (id: string) => void;
}) {
  const editable = suggestion.kind === 'draft_message';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suggestion.body);

  return (
    <li
      data-testid="approval-item"
      data-suggestion-id={suggestion.id}
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-3 pe-3 py-2.5 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          data-testid="approval-select"
          aria-label={`בחירה: ${suggestion.title}`}
          checked={selected}
          onChange={() => onToggleSelect(suggestion.id)}
          className="shrink-0 accent-brand-600"
        />
        <h4
          dir="auto"
          className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white text-start"
        >
          {suggestion.title}
        </h4>
      </div>
      {editing ? (
        <textarea
          dir="auto"
          data-testid="inline-edit"
          aria-label="עריכת טיוטה"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1.5 text-xs text-start"
        />
      ) : (
        suggestion.body !== '' && (
          <p
            dir="auto"
            className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap text-start"
          >
            {suggestion.body}
          </p>
        )
      )}
      {suggestion.evidence.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {suggestion.evidence.map((e, i) => (
            <li
              key={i}
              dir="auto"
              className="text-[11px] text-slate-500 dark:text-slate-400 text-start"
            >
              • {e.claim}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => onAccept(suggestion.id, editing ? draft : undefined)}
          className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-medium"
        >
          {t('chrome.action.approve')}
        </button>
        <button
          type="button"
          onClick={() => onDismiss(suggestion.id)}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
        >
          {t('chrome.action.dismiss')}
        </button>
        {editable && (
          <button
            type="button"
            data-testid="inline-edit-toggle"
            aria-pressed={editing}
            onClick={() => {
              if (!editing) setDraft(suggestion.body);
              setEditing((v) => !v);
            }}
            className="ms-auto rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
          >
            {editing ? t('chrome.action.cancelEdit') : 'עריכה'}
          </button>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------
// The view
// ------------------------------------------------------------

export interface ApprovalsInboxProps {
  initialMode?: 'inbox' | 'digest';
  /** Injectable clock for deterministic digest tests. */
  now?: () => number;
  /** Injectable ranker (tests); defaults to the live Pit Boss bridge. */
  rankMoveTheMoney?: RankMoveTheMoneyFn | null;
}

export function ApprovalsInbox({
  initialMode = 'inbox',
  now = Date.now,
  rankMoveTheMoney = resolveRankMoveTheMoney(),
}: ApprovalsInboxProps) {
  const suggestions = usePipelineStore((s) => s.suggestions);
  const persons = usePipelineStore((s) => s.persons);
  const deals = usePipelineStore((s) => s.deals);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const acceptSuggestion = usePipelineStore((s) => s.acceptSuggestion);
  const dismissSuggestion = usePipelineStore((s) => s.dismissSuggestion);
  const fees = useMoneyStore((s) => s.fees);
  const priors = useMoneyStore((s) => s.priors);

  const [mode, setMode] = useState<'inbox' | 'digest'>(initialMode);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const livePersons = useMemo(() => persons.filter((p) => !p.deleted), [persons]);
  const groups = useMemo(() => groupPendingByAgent(suggestions), [suggestions]);
  const pendingCount = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  // Overall honesty metrics — null renders as '—', never a fake 0.
  const indicators = useMemo(
    () =>
      computeLeadingIndicators(
        stageEvents,
        flattenContacts(livePersons),
        suggestions,
        { deals, now: new Date(now()) },
      ),
    [stageEvents, livePersons, suggestions, deals, now],
  );

  // Per-agent accept-rate — same source as the Bench Sourcer throttle.
  // `suggestions` is the reactive dependency; the selector reads state.
  const statsByAgent = useMemo(() => {
    const map = new Map<AgentName, ReturnType<typeof agentAcceptStats>>();
    for (const g of groups) map.set(g.agent, agentAcceptStats(g.agent));
    return map;
  }, [groups, suggestions]);

  // ---- selection + batch ops ----
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleGroup = (group: AgentGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = group.items.every((s) => next.has(s.id));
      for (const s of group.items) {
        if (allIn) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const batchApprove = () => {
    // Store actions refuse already-resolved ids on their own (no-ops).
    for (const id of selected) acceptSuggestion(id);
    clearSelection();
  };
  const batchDismiss = () => {
    for (const id of selected) dismissSuggestion(id);
    clearSelection();
  };

  const onAccept = (id: string, editedBody?: string) => {
    acceptSuggestion(id, { editedBody });
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };
  const onDismiss = (id: string) => {
    dismissSuggestion(id);
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // ---- digest derivations (deterministic, client-side) ----
  const calibrated = useMemo(() => calibratedJobIdSet(deals, fees), [deals, fees]);

  const top3 = useMemo(() => {
    const byId = new Map(deals.map((d) => [d.id, d]));
    if (rankMoveTheMoney) {
      try {
        const items = rankMoveTheMoney(deals, fees, priors, livePersons, now());
        const rows: { item: RankedMoneyItem; deal: Deal }[] = [];
        for (const item of items) {
          const deal = byId.get(item.dealId);
          if (!deal || deal.deleted) continue;
          rows.push({ item, deal });
          if (rows.length >= TOP_PIT_BOSS) break;
        }
        return rows;
      } catch {
        // fall through to the money-free aging fallback
      }
    }
    // Money-free fallback: longest-stuck first (Wave-1 ranking shape).
    return rankAtRiskDeals(deals, now())
      .slice(0, TOP_PIT_BOSS)
      .map(({ deal }) => ({
        item: {
          dealId: deal.id,
          evAtRisk: 0,
          reasons: [] as { claim: string }[],
          calibrated: false,
        },
        deal,
      }));
  }, [rankMoveTheMoney, deals, fees, priors, livePersons, now]);

  const overdue = useMemo(
    () => overdueFeedbackDeals(deals, now()),
    [deals, now],
  );

  const personName = (personId: string): string =>
    livePersons.find((p) => p.id === personId)?.name ?? '—';

  const digestEmpty =
    pendingCount === 0 && top3.length === 0 && overdue.length === 0;

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------

  return (
    <div data-testid="approvals-inbox" className="flex flex-col gap-3">
      {/* Mode header */}
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          <span dir="auto">
            {mode === 'digest' ? t('digest.title') : t('chrome.nav.approvals')}
          </span>{' '}
          {mode === 'inbox' && (
            <span className="text-xs font-normal tabular-nums text-slate-500 dark:text-slate-400">
              {pendingCount}
            </span>
          )}
        </h2>
        <button
          type="button"
          data-testid={mode === 'inbox' ? 'mode-digest' : 'digest-cta'}
          onClick={() => setMode(mode === 'inbox' ? 'digest' : 'inbox')}
          className="ms-auto rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-sm text-slate-700 dark:text-slate-200"
        >
          <span dir="auto">
            {mode === 'inbox' ? 'תקציר בוקר' : t('digest.cta')}
          </span>
        </button>
      </header>

      {mode === 'digest' ? (
        <div data-testid="morning-digest" className="flex flex-col gap-4">
          {digestEmpty ? (
            <p
              dir="auto"
              data-testid="digest-empty"
              className="text-sm text-slate-500 dark:text-slate-400 text-start"
            >
              {t('digest.empty')}
            </p>
          ) : (
            <>
              {/* Pending, grouped by agent */}
              {pendingCount > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h3
                    dir="auto"
                    className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start"
                  >
                    {t('digest.section.pending')}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {groups.map((g) => (
                      <li
                        key={g.agent}
                        data-testid="digest-agent-row"
                        className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 ps-3 pe-3 py-1.5"
                      >
                        <span
                          dir="auto"
                          className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-200 text-start"
                        >
                          {t(`agent.${g.agent}`)}
                        </span>
                        <span className="shrink-0 tabular-nums text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {g.items.length}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Top-3 Pit Boss */}
              {top3.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h3
                    dir="auto"
                    className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start"
                  >
                    {t('digest.section.top3')}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {top3.map(({ item, deal }) => {
                      const label = stageLabel(deal.stage);
                      // ₪ belt + braces: ranker's flag AND the UI's own set.
                      const showMoney =
                        item.calibrated === true &&
                        calibrated.has(deal.jobId) &&
                        Number.isFinite(item.evAtRisk) &&
                        item.evAtRisk > 0;
                      return (
                        <li
                          key={deal.id}
                          data-testid="digest-top3-row"
                          data-deal-id={deal.id}
                          className="flex items-center gap-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 ps-3 pe-3 py-1.5"
                        >
                          {showMoney && (
                            <span
                              dir="ltr"
                              data-testid="digest-top3-ev"
                              title="שווי צפוי בסיכון"
                              className="shrink-0 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                            >
                              {formatILS(item.evAtRisk)}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p
                              dir="auto"
                              className="truncate text-sm text-slate-900 dark:text-white text-start"
                            >
                              {personName(deal.personId)}{' '}
                              <span className="text-slate-500 dark:text-slate-400">
                                {deal.jobTitle}
                              </span>
                            </p>
                            <p
                              dir="auto"
                              className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start"
                            >
                              {label.he}
                              {item.reasons.length > 0
                                ? ` · ${item.reasons[0].claim}`
                                : ''}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Overdue client feedback */}
              {overdue.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h3
                    dir="auto"
                    className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start"
                  >
                    {t('digest.section.overdueFeedback')}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {overdue.map(({ deal, days }) => {
                      const label = stageLabel(deal.stage);
                      return (
                        <li
                          key={deal.id}
                          data-testid="digest-overdue-row"
                          data-deal-id={deal.id}
                          className="flex items-center gap-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 ps-3 pe-3 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              dir="auto"
                              className="truncate text-sm text-slate-900 dark:text-white text-start"
                            >
                              {personName(deal.personId)}{' '}
                              <span className="text-slate-500 dark:text-slate-400">
                                {deal.jobTitle}
                              </span>
                            </p>
                            <p
                              dir="auto"
                              className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start"
                            >
                              {label.he} · {durationHe(days)} ללא משוב לקוח
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Overall metrics — measured or '—' */}
          <p
            data-testid="inbox-metrics"
            dir="auto"
            className="text-xs text-slate-500 dark:text-slate-400 text-start"
          >
            שיעור קבלה:{' '}
            <span data-testid="metric-accept-rate" className="tabular-nums font-medium">
              {formatRate(indicators.suggestionAcceptRate)}
            </span>
            {' · '}
            שיעור עריכה לפני אישור:{' '}
            <span data-testid="metric-edit-rate" className="tabular-nums font-medium">
              {formatRate(indicators.suggestionEditRate)}
            </span>
          </p>

          {/* Batch bar */}
          {selected.size > 0 && (
            <div
              data-testid="batch-bar"
              className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-900 ps-3 pe-3 py-2"
            >
              <span
                dir="auto"
                className="text-xs text-slate-700 dark:text-slate-200"
              >
                נבחרו{' '}
                <span className="tabular-nums font-semibold">{selected.size}</span>
              </span>
              <button
                type="button"
                data-testid="batch-approve"
                onClick={batchApprove}
                className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-medium"
              >
                <span dir="auto">אישור הנבחרות</span>
              </button>
              <button
                type="button"
                data-testid="batch-dismiss"
                onClick={batchDismiss}
                className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
              >
                <span dir="auto">דחיית הנבחרות</span>
              </button>
              <button
                type="button"
                data-testid="batch-clear"
                onClick={clearSelection}
                className="ms-auto text-xs text-slate-500 dark:text-slate-400 hover:underline"
              >
                <span dir="auto">ניקוי בחירה</span>
              </button>
            </div>
          )}

          {groups.length === 0 ? (
            <p
              dir="auto"
              className="text-sm text-slate-400 dark:text-slate-500 text-start"
            >
              {t('chrome.empty.suggestions')}
            </p>
          ) : (
            groups.map((group) => {
              const stats = statsByAgent.get(group.agent);
              const allSelected = group.items.every((s) => selected.has(s.id));
              return (
                <section
                  key={group.agent}
                  data-testid={`agent-group-${group.agent}`}
                  className="flex flex-col gap-1.5"
                >
                  <header className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      data-testid={`group-select-${group.agent}`}
                      aria-label={`בחירת כל ההצעות של ${t(`agent.${group.agent}`)}`}
                      checked={allSelected}
                      onChange={() => toggleGroup(group)}
                      className="shrink-0 accent-brand-600"
                    />
                    <h3
                      dir="auto"
                      className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start"
                    >
                      {t(`agent.${group.agent}`)}
                    </h3>
                    <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-px text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      {group.agent}
                    </span>
                    <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      {group.items.length}
                    </span>
                    <span
                      dir="auto"
                      data-testid={`accept-rate-${group.agent}`}
                      title="שיעור הקבלה ההיסטורי של הצעות הסוכן (מזין את ויסות איתור-מהספסל)"
                      className="ms-auto text-[11px] text-slate-500 dark:text-slate-400"
                    >
                      קבלה:{' '}
                      <span className="tabular-nums font-medium">
                        {formatRate(stats?.acceptRate ?? null)}
                      </span>
                    </span>
                  </header>
                  <ul className="flex flex-col gap-2">
                    {group.items.map((s) => (
                      <ApprovalItem
                        key={s.id}
                        suggestion={s}
                        selected={selected.has(s.id)}
                        onToggleSelect={toggleSelect}
                        onAccept={onAccept}
                        onDismiss={onDismiss}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default ApprovalsInbox;
