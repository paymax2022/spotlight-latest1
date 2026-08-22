// ── Admin — MapService v2 cost/coverage dashboard + OSM contribution review ─────
// JSON field names mirror the Go backend (…/api/maps/admin) exactly. MapService v2
// is a Nigeria-tuned geocoding layer that deflects paid Google/HERE calls using a
// private gazetteer + cache + prediction, escalates by coverage tier + confidence,
// and feeds confirmed pins back (non-PII improvements to OSM under human review).

export type CoverageTier = 'GOOD' | 'FAIR' | 'LOW';

export type CircuitState = 'closed' | 'open' | 'half_open';

/** A resolution source. Paid providers are `google` / `here`; everything else is deflected. */
export type ResolutionSource =
  | 'gazetteer'
  | 'cache'
  | 'prediction'
  | 'osm'
  | 'google'
  | 'here'
  | 'needs_pin';

export interface ProviderHealth {
  name: string;
  up: boolean;
  p95_latency_ms: number;
  error_rate: number; // 0..1
  budget_used: number;
  budget_cap: number;
  budget_day: string; // YYYY-MM-DD
  circuit_state: CircuitState;
  opened_at?: string;
  updated_at: string;
}

export interface ResolutionEvent {
  id: string;
  request_type: string;
  surface: string;
  h3_cell: string;
  tier: CoverageTier;
  chosen_source: string; // ResolutionSource, but kept open for forward-compat
  provider: string;
  confidence: number; // 0..1
  escalated: boolean;
  cost_unit: number;
  outcome_pin: boolean;
  user_id: string;
  ts: string;
}

export interface DeflectionTierStat {
  paid: number;
  deflected: number;
}

export interface DeflectionStats {
  paid: number;
  deflected: number;
  by_coverage_tier: Record<CoverageTier, DeflectionTierStat>;
  by_source: Record<string, number>;
}

export interface MapDashboard {
  deflection: DeflectionStats;
  deflection_rate: number; // 0..1
  providers: ProviderHealth[];
}

export type ContributionStatus = 'pending' | 'approved' | 'rejected' | 'uploaded';

export interface ContributionCandidate {
  id: string;
  h3_cell: string;
  geometry: string; // GeoJSON string
  type: string;
  pii_stripped: boolean;
  status: ContributionStatus;
  reviewer_id: string;
  created_at: string;
}

export type ContributionReviewAction = 'approve' | 'reject';

export interface ContributionReviewInput {
  action: ContributionReviewAction;
  notes?: string;
}
