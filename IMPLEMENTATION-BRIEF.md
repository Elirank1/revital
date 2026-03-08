# Revital — V2 Implementation Brief
## For Claude Code execution

**Date:** 2026-03-08
**Status:** Approved plan, ready for implementation
**Owner:** Eliran

---

## CRITICAL CONSTRAINT: ADDITIVE ONLY

**DO NOT MODIFY these existing files:**
- `src/engine/analyzer.ts`
- `src/engine/prompts.ts`
- `src/engine/parser.ts`
- `src/components/AnalysisView/AnalysisView.tsx`
- `src/components/CandidateUpload/CandidateUpload.tsx`
- `src/components/JobInput/JobInput.tsx`
- `src/components/ComparisonView/ComparisonView.tsx`
- `src/components/HistoryPanel/HistoryPanel.tsx`
- `src/components/JobsPanel/JobsPanel.tsx`
- `src/components/Layout/Header.tsx`
- `src/components/Settings/SettingsPage.tsx`
- `src/App.tsx`

**Minimal additions ONLY allowed in:**
- `src/types/index.ts` — add new interfaces/types at the bottom, DO NOT change existing interfaces
- `src/store/appStore.ts` — add new state fields and actions, DO NOT change existing ones

**Everything else is NEW files in NEW folders.**

---

## What Already Exists (context for Claude Code)

### Infrastructure
- React 18 + TypeScript + Vite + Tailwind CSS + Zustand
- Vercel serverless functions in `api/` folder
- `api/analyze.ts` — proxy to Anthropic API (Claude) with ACCESS_CODE auth
- `api/linkedin.ts` — proxy to Enrich Layer API, returns structured profile text
- `api/data.ts` — cloud sync endpoint
- Dual mode: proxy (Vercel) vs direct (API key)

### Existing Enrichment API (`api/linkedin.ts`)
- Input: `{ linkedinUrl: string }` via POST
- Auth: `X-Access-Code` header
- Calls: `https://enrichlayer.com/api/v2/profile?profile_url=...&use_cache=if-recent`
- API key: `process.env.ENRICH_LAYER_API_KEY`
- Returns: `{ name, profileText, headline, location }`
- `profileText` is already formatted as readable structured text (NAME, HEADLINE, SUMMARY, EXPERIENCE, EDUCATION, CERTIFICATIONS, SKILLS, RECOMMENDATIONS)

### Existing CandidateUpload already uses LinkedIn enrichment
- User pastes LinkedIn URL → "Fetch Profile" button → calls `/api/linkedin` → adds candidate with `rawText: data.profileText`
- This flow feeds into the EXISTING analysis engine (prompts.ts → analyzer.ts)

### Existing Analysis Flow
- JD → pillar extraction (Claude AI) → pillars saved on JobDescription
- CV/profile text + pillars → candidate analysis (Claude AI) → CandidateAnalysis object
- Results shown in AnalysisView with score ring, pillar bars, flags, questions, recruiter notes

### Existing Store (appStore.ts)
Key state: `currentView`, `settings`, `currentJob`, `savedJobs`, `candidates`, `analyses`, `currentAnalysis`, `analysisLog`, `syncStatus` + cloud sync functions

### Existing AppView routes
`'dashboard' | 'analyze' | 'results' | 'jobs' | 'history' | 'comparison' | 'settings'`

---

## What to Build — 3 New Modules

---

### MODULE D: Outreach Composer

**Purpose:** Generate personalized outreach messages for candidates that have been analyzed.

**New Files:**

```
src/modules/outreach/
├── outreachPrompts.ts    — prompt builders
├── outreachEngine.ts     — orchestration (calls Claude via existing proxy)
├── OutreachComposer.tsx  — main UI component
└── outreachTypes.ts      — types
```

**outreachTypes.ts:**
```typescript
export interface OutreachDraft {
  id: string;
  analysisId: string;        // links to CandidateAnalysis
  candidateName: string;
  jobTitle: string;
  firstMessage: string;       // generated first-contact message
  followUpMessage: string;    // generated follow-up
  tone: OutreachTone;
  companyContext: string;      // hiring company positioning
  timestamp: string;
}

export type OutreachTone = 'professional' | 'warm' | 'direct' | 'consultative';
```

**outreachPrompts.ts:**
Build a prompt that takes:
- `CandidateAnalysis` (profileSummary, matchScore, greenFlags, verdict)
- `tone: OutreachTone`
- `companyContext: string` (free text about the hiring company / value prop)
- `jobTitle: string`

And generates:
```json
{
  "firstMessage": "LinkedIn InMail / message, 3-5 sentences, personalized to the candidate's profile and the role",
  "followUpMessage": "Follow-up if no response, 2-3 sentences, different angle"
}
```

Prompt guidelines:
- Sound like a real recruiter, not a bot
- Reference specific things from the candidate's profile (from profileSummary/greenFlags)
- Match the selected tone
- Never be generic — every message should feel written for THIS person
- Keep first message under 150 words
- Keep follow-up under 80 words

**outreachEngine.ts:**
- Function: `generateOutreach(analysis: CandidateAnalysis, tone: OutreachTone, companyContext: string, apiKey: string, model: string): Promise<OutreachDraft>`
- Reuse the same proxy pattern as `analyzer.ts` (detect mode, call proxy or direct)
- IMPORTANT: copy the `callClaude` logic into this file — do NOT import from analyzer.ts. Keep modules independent.

**OutreachComposer.tsx:**
- Accessible from within a result view (the user clicks a button on an analysis result)
- Shows:
  - Tone selector (4 options as pills/buttons)
  - Company context textarea (with placeholder: "What makes this role/company attractive?")
  - "Generate Outreach" button
  - Generated first message (editable textarea)
  - Generated follow-up (editable textarea)
  - "Regenerate" button
  - "Copy" buttons for each message
- Saving: outreach drafts persist in localStorage under `revital_outreach`

**Store additions (in appStore.ts):**
Add at the bottom of the store, after existing fields:
```typescript
// Outreach drafts
outreachDrafts: OutreachDraft[];
addOutreachDraft: (draft: OutreachDraft) => void;
```
Load from localStorage `revital_outreach`, save on add, cap at 200 items.

---

### MODULE E: Interview Summary Engine

**Purpose:** Transform interview transcript text into structured, recruiter-ready summaries with a manager-forwarding version.

**New Files:**

```
src/modules/interview/
├── interviewPrompts.ts     — prompt builders
├── interviewEngine.ts      — orchestration
├── InterviewSummary.tsx    — main UI component
└── interviewTypes.ts       — types
```

**interviewTypes.ts:**
```typescript
export interface InterviewSummaryData {
  id: string;
  analysisId: string;         // links to CandidateAnalysis
  candidateName: string;
  jobTitle: string;
  timestamp: string;

  // Structured output
  overview: string;            // 2-3 sentence overview
  strengths: string[];         // bullet points
  concerns: string[];          // bullet points
  openQuestions: string[];     // things that remain unclear
  recommendation: string;      // 1-2 sentences: hire/pass/next steps
  cultureFit: string;         // 1-2 sentences

  // Manager forwarding version
  managerSummary: string;     // polished, concise, ready to forward via email/WhatsApp

  // Raw transcript (stored for reference)
  rawTranscript: string;
}
```

**interviewPrompts.ts:**
Build a prompt that takes:
- `transcript: string` (raw interview transcript text)
- `candidateName: string`
- `jobTitle: string`
- `pillars: EvaluationPillar[]` (from the job — for context on what matters)
- `analysisContext: string` (profileSummary + verdict from prior analysis, if available)

And generates:
```json
{
  "overview": "...",
  "strengths": ["..."],
  "concerns": ["..."],
  "openQuestions": ["..."],
  "recommendation": "...",
  "cultureFit": "...",
  "managerSummary": "..."
}
```

Prompt guidelines:
- `overview`: Factual, concise. Who is this person and what was the overall impression.
- `strengths`: Max 5. Specific evidence from the conversation, not generic.
- `concerns`: Max 4. Real concerns only — don't manufacture issues.
- `openQuestions`: Things that weren't covered or remain ambiguous. Max 3.
- `recommendation`: Clear, actionable. "Advance to next round because..." or "Pass because..."
- `cultureFit`: Based on communication style, motivations, values expressed in the conversation.
- `managerSummary`: 5-8 sentences MAX. Written as if the recruiter is forwarding to the hiring manager. Professional, concise, no jargon. Should work copy-pasted into WhatsApp or email. Format: "I spoke with [name] about the [role] position. [key findings]. [recommendation]."

**interviewEngine.ts:**
- Function: `generateInterviewSummary(transcript, candidateName, jobTitle, pillars, analysisContext, apiKey, model): Promise<InterviewSummaryData>`
- Same proxy pattern (copy callClaude logic, keep independent)

**InterviewSummary.tsx:**
- Accessible from within a result view (button: "Summarize Interview")
- Shows:
  - Transcript input textarea (paste here, min-height 200px)
  - "Generate Summary" button
  - Output sections:
    - Overview (always visible)
    - Strengths (always visible)
    - Concerns (always visible)
    - Open Questions (collapsible)
    - Recommendation (always visible, highlighted)
    - Culture Fit (collapsible)
    - Manager Version (always visible, in a distinct card with "Copy for WhatsApp" and "Copy for Email" buttons)
  - "Copy Full Summary" button
- Saving: interview summaries persist in localStorage under `revital_interviews`

**Store additions (in appStore.ts):**
```typescript
// Interview summaries
interviewSummaries: InterviewSummaryData[];
addInterviewSummary: (summary: InterviewSummaryData) => void;
```
Load from localStorage `revital_interviews`, save on add, cap at 100 items.

---

### MODULE C-EXT: LinkedIn Profile Intelligence (Enhanced Analysis)

**Purpose:** When a candidate is added via LinkedIn URL (enrichment API), provide enhanced analysis that leverages the structured nature of LinkedIn data — career trajectory analysis, intent signals, company pattern matching.

NOTE: The existing flow already works — LinkedIn URL → enrichment API → profileText → standard analysis via prompts.ts. This module ADDS a secondary "profile intelligence" layer on top, it does NOT replace the existing analysis.

**New Files:**

```
src/modules/profile-intel/
├── profilePrompts.ts        — prompt builders for enhanced LinkedIn analysis
├── profileEngine.ts         — orchestration
├── ProfileIntelCard.tsx     — UI component (displayed alongside existing analysis)
└── profileTypes.ts          — types
```

**profileTypes.ts:**
```typescript
export interface ProfileIntelligence {
  id: string;
  analysisId: string;         // links to CandidateAnalysis
  candidateName: string;
  timestamp: string;

  // Career trajectory
  careerArc: string;           // "Rising through IC track at enterprise companies"
  seniorityProgression: string; // "IC → Senior → Staff in 8 years"
  companyPattern: string;       // "Tier-1 enterprise, long tenure"
  domainExpertise: string[];    // ["payments", "ML infrastructure", "distributed systems"]

  // Intent signals
  likelyMotivations: string[];  // ["seeking technical leadership", "wants smaller company impact"]
  openToChange: 'likely' | 'possible' | 'unlikely' | 'unknown';
  openToChangeReasoning: string;

  // Practical insights
  locationConfidence: string;   // "High — consistent Bay Area for 10+ years"
  salaryBand: string;           // "Senior Staff at Tier-1: $350-450K TC"
  noticeRisk: string;           // "Long tenure suggests strong retention — may need compelling pitch"

  // Recruiter action items
  bestApproachAngle: string;    // "Lead with technical challenge, not comp"
  thingsToVerify: string[];     // ["hands-on coding frequency", "team size preference"]
}
```

**profilePrompts.ts:**
Build a prompt that takes:
- Full `profileText` from enrichment API (the formatted LinkedIn data)
- `jobTitle: string` (the role we're recruiting for)
- `jobPillars: EvaluationPillar[]` (what matters for this role)

And generates the `ProfileIntelligence` JSON.

Prompt guidelines:
- This is NOT a match score — that's already done by the existing analysis engine
- This is CAREER INTELLIGENCE — understand WHO this person is professionally
- `careerArc`: Synthesize the full trajectory, not just current role
- `openToChange`: Be conservative. Mark as 'unknown' unless there are real signals
- `likelyMotivations`: Infer from career moves, not from generic assumptions
- ALL inferences must be marked as probabilistic. Use language like "likely", "suggests", "pattern indicates"
- `bestApproachAngle`: Specific to THIS person. Not generic recruiter advice.
- `thingsToVerify`: What a recruiter should ask in the first call to validate assumptions

**profileEngine.ts:**
- Function: `generateProfileIntel(profileText, jobTitle, pillars, apiKey, model): Promise<ProfileIntelligence>`
- Same proxy pattern

**ProfileIntelCard.tsx:**
- Displayed within the results view, BELOW the existing AnalysisView content
- Only shown when the candidate was added via LinkedIn (check: candidate.fileName === 'LinkedIn Profile' or candidate.linkedinUrl exists)
- Compact card layout:
  - Header: "Profile Intelligence" with a brain/lightbulb icon
  - Career arc + seniority progression (always visible)
  - Company pattern + domain expertise tags (always visible)
  - Intent signals section (collapsible) — motivations, openToChange with colored badge
  - Practical section (collapsible) — location, salary band, notice risk
  - Action items (always visible) — best approach angle, things to verify
- "Generate Intel" button (this analysis runs separately from the main analysis, on-demand)
- Saving: profile intelligence data persists in localStorage under `revital_profileIntel`

**Store additions (in appStore.ts):**
```typescript
// Profile intelligence
profileIntelligence: ProfileIntelligence[];
addProfileIntel: (intel: ProfileIntelligence) => void;
```
Load from localStorage `revital_profileIntel`, save on add, cap at 100 items.

---

## Integration Points (ADDITIVE ONLY)

### How modules connect to existing UI:

The 3 new modules need entry points in the existing UI. There are two clean ways to do this WITHOUT modifying existing components:

**Option A (RECOMMENDED): Module Wrapper Component**

Create a new file: `src/modules/ModuleActions.tsx`

This is a standalone component that reads `currentAnalysis` from the store and renders action buttons + module UIs. It gets mounted in `App.tsx` ONCE, inside the `ResultsPage` function, BELOW the existing `<AnalysisView />`.

Changes to `App.tsx` (minimal, additive):
```typescript
// Add import at top:
import ModuleActions from './modules/ModuleActions';

// In ResultsPage, after <AnalysisView />:
<AnalysisView />
<ModuleActions />  // NEW — renders outreach, interview, profile intel below analysis
```

This is the ONLY change to an existing file (besides types and store).

**ModuleActions.tsx:**
```typescript
// Shows action buttons and module UIs based on current analysis
// - "Generate Outreach" → opens OutreachComposer inline
// - "Summarize Interview" → opens InterviewSummary inline
// - ProfileIntelCard → auto-shown if LinkedIn candidate
```

### Types additions (in src/types/index.ts):

Add at the very bottom of the file, after the existing `AppView` type:
```typescript
// Re-export module types for convenience
export type { OutreachDraft, OutreachTone } from '../modules/outreach/outreachTypes';
export type { InterviewSummaryData } from '../modules/interview/interviewTypes';
export type { ProfileIntelligence } from '../modules/profile-intel/profileTypes';
```

### Store additions (in src/store/appStore.ts):

Add new state fields and actions AFTER the existing cloud sync section. Import the new types. Add localStorage load/save for each. DO NOT modify any existing state, actions, or logic.

---

## Implementation Order

1. **Module D (Outreach)** — simplest, builds directly on existing analysis data
2. **Module E (Interview Summary)** — independent, no dependencies on other new modules
3. **Module C-EXT (Profile Intelligence)** — most complex, depends on understanding enrichment API data structure

---

## UI/UX Guidelines

- Match existing Tailwind classes and design patterns (see existing components for reference)
- Use lucide-react for icons (already installed)
- Cards use `className="card"` (existing utility class)
- Buttons: `btn-primary`, `btn-secondary`, `btn-ghost` (existing utility classes)
- Text sizes: headers `text-sm font-semibold`, body `text-xs`, micro `text-[10px]`
- Brand color: `brand-*` classes (blue)
- Collapsible sections: follow the pattern in AnalysisView (ChevronUp/Down toggle)

---

## Testing

After implementing each module:
1. `npx tsc --noEmit` — must pass with zero errors
2. Verify existing flows still work (JD → CV upload → analysis → results)
3. Test new module from the results view

---

## Files Summary

**New files to create:**
```
src/modules/
├── ModuleActions.tsx
├── outreach/
│   ├── outreachTypes.ts
│   ├── outreachPrompts.ts
│   ├── outreachEngine.ts
│   └── OutreachComposer.tsx
├── interview/
│   ├── interviewTypes.ts
│   ├── interviewPrompts.ts
│   ├── interviewEngine.ts
│   └── InterviewSummary.tsx
└── profile-intel/
    ├── profileTypes.ts
    ├── profilePrompts.ts
    ├── profileEngine.ts
    └── ProfileIntelCard.tsx
```

**Existing files to modify (MINIMAL):**
- `src/App.tsx` — add 1 import + 1 component render line in ResultsPage
- `src/types/index.ts` — add re-exports at bottom
- `src/store/appStore.ts` — add new state fields at bottom

**DO NOT TOUCH anything else.**
