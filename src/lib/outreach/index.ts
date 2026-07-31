/**
 * Outreach barrel — the only import surface UI components should use.
 * Pure composition + logging contract; no navigation, no send path (G4).
 */

export {
  normalizePhone,
  sanitizeMessageText,
  composeWaMeUrl,
  composeMailto,
} from './waMe';
export type { MailtoParts } from './waMe';

export { hashMessage, composeAndLog } from './contactLog';
export type {
  ContactChannel,
  ContactLogger,
  ComposeContactArgs,
  ComposeWhatsAppArgs,
  ComposeEmailArgs,
  ComposedContact,
} from './contactLog';

export { openerDraft, followUpDraft } from './drafts';
export type { OutreachDraft, SuggestionInput } from './drafts';

export {
  draftToSuggestion,
  suggestionMessageHash,
  suggestionToWaHref,
  suggestionToComposeArgs,
} from './glue';

export {
  DEFAULT_HER,
  parseWhatsAppThread,
  buildThreadApplyPlan,
  parseThreadToPlan,
} from './threadParser';
export type {
  ThreadWho,
  HerIdentity,
  ThreadMessage,
  SkipReason,
  SkippedLine,
  ParsedThread,
  ContactLogCall,
  ReplyStateCall,
  ThreadApplyCall,
  ThreadApplyPlan,
} from './threadParser';
