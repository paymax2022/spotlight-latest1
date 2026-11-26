// Rising Star edition configuration types surfaced to the public mobile app:
// winning positions, prizes, the published rules document, declared winners and
// the contestant's rules-acceptance record (ADDITIONAL MASTER REQUIREMENTS
// §3, §5). These mirror the Go structs in
// backend/internal/connect/voting/edition.go and are read off the member group
// at /api/v1/connect/contests/:id/...

export type PrizeType = 'cash' | 'non_cash' | 'package';

export interface WinningPosition {
  id: string;
  edition_id: string;
  title: string;
  rank: number;
  display_order: number;
  recipients_allowed: number;
  is_active: boolean;
}

export interface EditionPrize {
  id: string;
  edition_id: string;
  position_id?: string | null;
  prize_type: PrizeType;
  title: string;
  amount_kobo?: number | null;
  currency: string;
  description: string;
  fulfilment_conditions: string;
  presentation_timing: string;
  display_order: number;
  is_active: boolean;
}

export interface EditionRules {
  id: string;
  edition_id: string;
  version: number;
  // The structured A–I rule set; keys are admin-defined, so it is read loosely.
  content: Record<string, unknown>;
  status: 'draft' | 'published' | 'archived';
  effective_date?: string | null;
  published_at?: string | null;
}

export interface EditionWinner {
  id: string;
  edition_id: string;
  contestant_id: string;
  position_id?: string | null;
  is_finalist: boolean;
  declaration_status: 'not_declared' | 'finalist' | 'declared' | 'published' | 'revoked';
  announcement_date?: string | null;
  prize_fulfilment_status: 'pending' | 'in_progress' | 'fulfilled' | 'not_applicable';
  contestant_name?: string;
  contestant_photo?: string;
  position_title?: string;
  position_rank?: number;
}

export interface RulesAcceptance {
  id: string;
  /** The authenticated registrant who accepted (from the bearer token). */
  user_id: string;
  /** The registration application the gate was captured against, if any. */
  application_id?: string | null;
  /** Backfilled when the applicant is promoted to the roster; null at submit. */
  contestant_id?: string | null;
  edition_id: string;
  rules_id: string;
  rules_version: number;
  accepted_at: string;
}
