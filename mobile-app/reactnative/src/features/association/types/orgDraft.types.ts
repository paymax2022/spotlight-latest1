// ── Association — Organisation creation wizard contract (U) ───────────────────
// IRON RULE: monetary amounts are integers in minor units (kobo).

import type { GroupType } from './association.types';
import type { DuesCadence } from './association.types';

export type ApprovalRule =
  | 'AUTO'              // open — join instantly
  | 'ADMIN'            // single admin approval
  | 'CHAPTER_THEN_NATIONAL' // multi-level
  | 'PAYMENT_FIRST';   // pay before activation

export interface DraftChapter {
  id:    string;
  name:  string;
  level: 'REGION' | 'STATE' | 'LOCAL';
}

export interface DraftCategory {
  id:        string;
  label:     string;
  duesKobo:  number;
  cadence:   DuesCadence;
}

export interface DraftCommittee {
  id:   string;
  name: string;
}

export interface RestrictionConfig {
  graceDays:        number;
  disableVoting:    boolean;
  disableEvents:    boolean;
  disableChat:      boolean;
  disableCard:      boolean;
}

export interface OrgDraft {
  name:        string;
  acronym:     string;
  category:    string;
  description: string;
  logoUri:     string | null;
  groupType:   GroupType | null;
  approvalRule: ApprovalRule | null;
  registrationFeeKobo: number;
  chapters:    DraftChapter[];
  committees:  DraftCommittee[];
  categories:  DraftCategory[];
  restrictions: RestrictionConfig;
  acceptedTerms: boolean;
}

export interface PublishResult {
  organisationId: string;
  name: string;
}
