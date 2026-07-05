// ── Paymax Invest · Settings / Security / Support — Type Contract ────────────
// Source of truth the invest-settings screens code against (Backend role owns
// this file). Mirrors the crypto module's typing conventions: a small set of
// plain interfaces the API layer and hooks share, with no UI concerns leaking in.
//
// This module is read-mostly: profile/KYC/risk are server-owned; banks, devices,
// PIN and support tickets are the only mutable surfaces.

// ─── Profile · KYC · Risk ─────────────────────────────────────────────────────

/** KYC verification tiers (mirrors the crypto eligibility `kycTier`). */
export type KycTier = 0 | 1 | 2 | 3;

/** Suitability risk category assigned after the risk questionnaire. */
export type RiskCategory = 'conservative' | 'balanced' | 'aggressive';

/** The investor's identity + compliance snapshot (read-only in this module). */
export interface InvestProfile {
  name: string;
  email: string;
  phone: string;
  kycTier: KycTier;
  riskCategory: RiskCategory;
}

// ─── Linked banks ─────────────────────────────────────────────────────────────

/** A funding/withdrawal bank account. `accountMasked` only — full number never stored client-side. */
export interface LinkedBank {
  id: string;
  bankName: string;
  accountMasked: string;   // e.g. '•••• 4821'
  primary: boolean;
}

/** Draft submitted when linking a new bank. */
export interface NewBankDraft {
  bankName: string;
  accountNumber: string;
}

// ─── Fee schedule ─────────────────────────────────────────────────────────────

/** A single line in the transparency fee schedule. */
export interface FeeScheduleItem {
  label: string;
  value: string;           // pre-formatted display string (e.g. '0.90%', 'Free')
}

// ─── Statements ───────────────────────────────────────────────────────────────

export type StatementKind = 'monthly' | 'tax' | 'annual';

/** A downloadable account statement / tax document. */
export interface Statement {
  id: string;
  period: string;          // e.g. 'May 2026', 'FY 2025'
  createdAt: string;       // ISO
  kind: StatementKind;
}

/** Result of an export request — a (mock) signed download URL. */
export interface StatementExport {
  id: string;
  url: string;
  expiresAt: string;       // ISO
}

// ─── Security · devices · sessions ────────────────────────────────────────────

/** A device/session with an active sign-in. */
export interface Device {
  id: string;
  name: string;            // e.g. 'iPhone 15 Pro · Lagos'
  lastActive: string;      // ISO
  current: boolean;
}

// ─── Support ──────────────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

/** A single message within a support thread. */
export interface SupportMessage {
  from: 'user' | 'agent';
  body: string;
  at: string;              // ISO
}

/** A support ticket and its message thread. */
export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;       // ISO
  messages: SupportMessage[];
}

/** Draft submitted when opening a new ticket. */
export interface NewTicketDraft {
  subject: string;
  body: string;
}

// ─── Support content (help center FAQ) ────────────────────────────────────────

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}
