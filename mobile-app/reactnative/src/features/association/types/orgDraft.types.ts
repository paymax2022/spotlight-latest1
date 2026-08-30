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

// Leadership structure: a single central body, or state chapters each with an
// appointed leader who may be mandated to approve members in their state.
export type StructureType = 'SINGLE' | 'STATEWIDE';

export interface DraftStateLeader {
  id:                string;
  state:             string;   // one of the 36 states + FCT
  leaderName:        string;
  leaderContact:     string;   // phone / email (optional)
  canApproveMembers: boolean;  // mandate to act & approve members in this state
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
  acronym:     string;          // optional
  category:    string;
  description: string;
  location:    string;          // optional — e.g. "Lagos, Nigeria"
  website:     string;          // optional — e.g. "https://nma.org.ng"
  /**
   * Founded year, held as the raw text the founder typed so the field can be
   * partially entered without the store fighting the keyboard. Converted to a
   * number at publish; the server rejects anything outside 1800→this year.
   */
  foundedYear: string;          // REQUIRED
  /**
   * Logo, REQUIRED. Set either from a pasted URL or from the image picker —
   * one value, two ways in. Note the picker yields a device-local file:// URI
   * and the association module has no upload endpoint behind it, so a logo
   * added that way will not resolve anywhere but the device that picked it.
   */
  logoUri:     string | null;
  groupType:   GroupType | null;
  approvalRule: ApprovalRule | null;
  registrationFeeKobo: number;
  structureType: StructureType;      // single central body vs state chapters
  stateLeaders: DraftStateLeader[];  // only relevant when structureType = STATEWIDE
  chapters:    DraftChapter[];
  committees:  DraftCommittee[];
  categories:  DraftCategory[];
  rules:       string[];             // group rules an applicant must accept
  restrictions: RestrictionConfig;
  acceptedTerms: boolean;
}

export interface PublishResult {
  organisationId: string;
  name: string;
}
