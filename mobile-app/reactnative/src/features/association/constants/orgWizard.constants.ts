// ── Association — Org creation wizard constants (U) ───────────────────────────

import type { GroupType } from '../types/association.types';
import type { ApprovalRule } from '../types/orgDraft.types';

export const WIZARD_STEPS = ['Basics', 'Branding', 'Structure', 'Membership', 'Access', 'Review'] as const;

export const GROUP_TYPE_OPTIONS: { value: GroupType; label: string; help: string }[] = [
  { value: 'OPEN', label: 'Open', help: 'Anyone can join instantly.' },
  { value: 'CLOSED', label: 'Closed', help: 'Admin approval required.' },
  { value: 'INVITE_ONLY', label: 'Invite-only', help: 'Members join via invitation.' },
  { value: 'CODE_BASED', label: 'Access code', help: 'Members join with a code.' },
  { value: 'PAID', label: 'Paid', help: 'Payment required to activate.' },
];

export const APPROVAL_RULE_OPTIONS: { value: ApprovalRule; label: string; help: string }[] = [
  { value: 'AUTO', label: 'Auto-approve', help: 'No review — members are active immediately.' },
  { value: 'ADMIN', label: 'Admin approval', help: 'A single admin reviews each application.' },
  { value: 'CHAPTER_THEN_NATIONAL', label: 'Multi-level', help: 'Chapter admin approves, then national validates.' },
  { value: 'PAYMENT_FIRST', label: 'Payment first', help: 'Registration fee confirmed before activation.' },
];

export const CHAPTER_LEVEL_OPTIONS = ['REGION', 'STATE', 'LOCAL'] as const;
export const CADENCE_OPTIONS = ['ONE_OFF', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'LIFETIME'] as const;
