# Wave 1 — Pipeline store contract (lead-defined, binding)

platform-data implements these exact signatures on `usePipelineStore`; kanban-ui, agents-engine, and integrations build against them. Deviations require a lead decision, not a silent rename.

```ts
// Entities (already in src/types/pipeline.ts)
addPerson(input: PersonInput): { person: Person; duplicateOf?: Person }  // runs findDuplicatePerson; on name-only collision creates person AND a 'merge_person' Suggestion
addDeal(input: DealInput): Deal                                          // requires personId; stage defaults 'Sourced'; entry at a later stage logs a StageEvent with skippedStages
moveDeal(dealId: string, toStage: DealStage, opts?: { reason?: string; actor?: AuditActor; agent?: string }): StageEvent | null
  // logs StageEvent (with skippedStages when jumping forward), audit entry, undo snapshot.
  // toStage 'Rejected' REQUIRES opts.reason and files the Person to Bench.
undoLast(): boolean                                                      // one-click undo of the last undoable mutation (move/accept); audit-logged as action 'undo'
setReplyState(personId: string, state: 'replied' | 'no_reply' | 'meeting_set', ts?: string): void  // the three chips השיב/אין מענה/נקבעה שיחה
logContact(personId: string, channel: 'whatsapp' | 'email', messageHash: string, ts?: string): void // implements ContactLogger from src/lib/outreach
acceptSuggestion(id: string): void   // ONLY path where agent output mutates card state (single-writer via client)
dismissSuggestion(id: string): void
addSuggestion(input: SuggestionInput): Suggestion

// Selectors (plain functions over getState() are fine)
dealsByStage(): Record<DealStage, Deal[]>
benchPersons(): Person[]
personById(id: string): Person | undefined
```

Rules: every mutation writes an audit entry (agent attribution when actor==='ai'); all persistence stays under `revital_v3_*`; flag-off = store never touched by UI. Aging: `Deal.stageEnteredAt` must update on every move (rings render from it).
