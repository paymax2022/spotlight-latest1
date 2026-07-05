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

// Leadership structure: one central body, or state chapters with appointed leaders.
export const STRUCTURE_TYPE_OPTIONS: { value: 'SINGLE' | 'STATEWIDE'; label: string; help: string }[] = [
  { value: 'SINGLE', label: 'Single structure', help: 'One central body. No state chapters or state leaders.' },
  { value: 'STATEWIDE', label: 'State chapters', help: 'Operate across states, each with an appointed state leader.' },
];

// Common group rules offered as a multi-select; admins can also add custom rules.
export const GROUP_RULE_OPTIONS = [
  'Members must keep their dues up to date.',
  'Respect all members and observe the code of conduct.',
  'One membership per person — no duplicate accounts.',
  'Attend general meetings and vote where eligible.',
  'No use of the platform for unauthorised solicitation.',
  'Comply with decisions of the executive council.',
  'Provide accurate identity and contact information.',
  'Give notice before withdrawing from the association.',
] as const;

// Common membership categories offered as a dropdown when adding a tier. The
// list is searchable; "Other" lets the admin enter a custom category name.
export const MEMBERSHIP_CATEGORY_OPTIONS = [
  'Full member',
  'Associate member',
  'Ordinary member',
  'Student member',
  'Graduate member',
  'Corporate member',
  'Executive member',
  'Honorary member',
  'Life member',
  'Patron',
  'Other',
] as const;
