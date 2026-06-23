// ── Admin — Paymax Connect types ─────────────────────────────────────────────
// Field names mirror the Go JSON (snake_case) from /api/connect/admin/*.

export type ConnectCaseStatus = 'open' | 'investigating' | 'resolved' | 'closed';

export interface ConnectCase {
  id: string;
  reporter_id?: string | null;
  subject_id?: string | null;
  type: string;
  source_ref?: string | null;
  status: ConnectCaseStatus;
  resolution?: string | null;
  severity: string;
  assigned_admin?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectAuditEntry {
  id: string;
  actor_id?: string | null;
  actor_role?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  reason?: string | null;
  created_at: string;
}
