// ── Referral Invite & Share types ────────────────────────────────────────────
// Self-contained types for the M-INV-* surfaces (share sheet, share-by-name,
// contact picker, QR, vanity link, contextual share, tracking, nudge, vertical
// picker). Earnings tie to friends' real verified activity (§7), never signups.

// ── Share payload (M-INV-01) ─────────────────────────────────────────────────
export interface SharePayload {
  code: string;
  link: string;
  shortLink: string | null;
  /** Referrer display name (for share-by-name M-INV-02). */
  referrerName: string;
  /** Pre-composed compliant invite message (no income promises). */
  message: string;
}

export type ShareChannel = 'whatsapp' | 'sms' | 'social' | 'copy' | 'more';

// ── Contact picker (M-INV-03) ────────────────────────────────────────────────
export interface InviteContact {
  id: string;
  name: string;
  /** Masked phone for display. */
  phoneMasked: string;
  /** True when this contact already has a Paymax account (cannot re-invite). */
  alreadyJoined: boolean;
}

// ── Vanity link & UTM (M-INV-05) ─────────────────────────────────────────────
export interface VanityLink {
  id: string;
  alias: string;
  url: string;
  source: string | null;
  campaign: string | null;
  clicks: number;
  signups: number;
  createdAt: string;
}

export interface VanityLinkInput {
  alias: string;
  source?: string;
  campaign?: string;
}

// ── Contextual share (M-INV-06) ──────────────────────────────────────────────
export type ShareContext =
  | 'paid_bill'
  | 'won_contest'
  | 'listed_property'
  | 'sent_money'
  | 'first_savings';

export interface ContextualPrompt {
  context: ShareContext;
  title: string;
  body: string;
  /** Pre-composed compliant message for this moment. */
  message: string;
}

// ── Invite tracking (M-INV-07) ───────────────────────────────────────────────
export type FunnelStage =
  | 'invited'
  | 'clicked'
  | 'signed_up'
  | 'kyc'
  | 'activated';

export interface TrackedInvitee {
  id: string;
  name: string;
  channel: ShareChannel;
  stage: FunnelStage;
  invitedAt: string;
  lastActivityAt: string;
  /** Reward in kobo earned from this invitee so far (verified activity only). */
  earnedKobo: number;
  /** True when a nudge can be sent (consented + not yet activated). */
  nudgeable: boolean;
}

// ── Nudge (M-INV-08) ─────────────────────────────────────────────────────────
export interface NudgeResult {
  ok: boolean;
  /** Set when rate-limited or the invitee opted out. */
  error?: 'rate_limited' | 'opted_out' | 'already_activated';
}

// ── Vertical referral picker (M-INV-09) ──────────────────────────────────────
export interface ReferralVertical {
  id: string;
  label: string;
  /** lucide icon name. */
  icon: string;
  blurb: string;
  /** Pre-composed compliant message scoped to this vertical. */
  message: string;
}
