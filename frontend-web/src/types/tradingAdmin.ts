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

// ── §12 Promotion ladder ──────────────────────────────────────────────────────
// Wire-shape note: the Go promotion handlers serialize their structs WITHOUT json
// tags, so the API returns PascalCase field names (StrategyID, Stage, …). These
// types match that wire shape so the live fetch path needs no mapping.

export type TradingStage =
  | 'not_promoted' | 'paper' | 'shadow' | 'canary' | 'live' | 'halted';

export interface StrategyPromotion {
  StrategyID: string;
  Stage: TradingStage;
  ValidationPassed: boolean;
  TrackRecordDays: number;
  CircuitTripped: boolean;
  Version: number;
  UpdatedAt: string;
}

export interface PromotionEvent {
  StrategyID: string;
  EventType: string;         // register | promote | demote | halt | readiness
  OldStage: string;
  NewStage: string;
  MakerID: string | null;
  CheckerID: string | null;
  RiskSignedOff: boolean | null;
  LegalSignedOff: boolean | null;
  Reason: string;
  CreatedAt: string;
}

export interface PromoteRequest {
  to_stage: TradingStage;
  maker_id: string;          // must differ from the acting checker (two-person)
  risk_signed_off: boolean;  // required for canary → live
  legal_signed_off: boolean; // required for canary → live
}
export interface ReadinessRequest {
  validation_passed: boolean;
  track_record_days: number;
  circuit_tripped: boolean;
}
export interface DemoteRequest { to_stage: TradingStage; reason: string; }

// The next legal forward rung from a stage (null if off-ladder / already Live).
export function nextStage(s: TradingStage): TradingStage | null {
  switch (s) {
    case 'not_promoted':
    case 'halted':
      return 'paper';
    case 'paper':
      return 'shadow';
    case 'shadow':
      return 'canary';
    case 'canary':
      return 'live';
    default:
      return null;
  }
}
// Canary/Live are real-capital ELIGIBILITY states — even so, this build executes
// nothing (no venue adapter). Used only to render an "eligibility" hint.
export function allowsRealCapital(s: TradingStage): boolean {
  return s === 'canary' || s === 'live';
}
