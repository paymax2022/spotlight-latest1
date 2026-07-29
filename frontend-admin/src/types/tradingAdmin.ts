// Trading module admin — Module-KYC (Trading Access Verification) + bypass register.
// Decoupled from the super-app Tier 0-3 (§16B.1). Money in kobo.

export type TradingKycStatus =
  | 'NOT_STARTED' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'BYPASSED' | 'EXPIRED';

export interface TradingKycRecord {
  user_id: string;
  display_name: string;
  email_masked: string;
  status: TradingKycStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_id: string | null;
  reason_code: string | null;
  bypass_expires_at: string | null;
  exposure_cap_kobo: number | null;
  // Documents / screening summary shown in the case detail (masked).
  sanctions_hit?: boolean;
  pep_hit?: boolean;
  source_of_funds?: string | null;
  risk_flags?: string[];
}

export interface TradingKycEvent {
  event_type: string;
  old_status: string | null;
  new_status: string;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface TradingKycReject { reason_code: string; }
export interface TradingKycBypassRequest {
  checker_id: string;        // must differ from the initiating admin (maker)
  reason: string;
  ttl_days: number;          // ≤ 30
  exposure_cap_kobo?: number | null;
}

export interface TradingBypassEntry {
  id: string;
  user_id: string;
  display_name: string;
  maker_id: string;
  checker_id: string;
  reason: string;
  exposure_cap_kobo: number | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  active: boolean;
}
