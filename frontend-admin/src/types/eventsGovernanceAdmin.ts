// Events governance admin — moderation, organiser sanctions, platform fee and
// support desk. Shapes mirror the Go JSON tags (backend/internal/top5events:
// admin_reads.go AdminEventSummary, moderation_service.go ModerationDecision /
// FeeSettings / OrganiserSanction, support_service.go SupportCase /
// SupportMessage / SupportQueueStats). Money is integer kobo.

/** One row of GET /moderation (same projection as the admin event catalogue). Status is lower-case. */
export interface ModerationQueueItem {
  id: string;
  title: string;
  organiser_masked: string;
  category: string;
  city: string;
  status: string;
  starts_at: string;
  capacity: number;
  tickets_sold: number;
  gmv_kobo: number;
  cashless_enabled: boolean;
  created_at: string;
  refund_policy?: string;
  moderation_status?: string;
  moderation_note?: string;
  submitted_at?: string;
}

export type ModerationAction = 'approve' | 'reject' | 'changes' | 'suspend' | 'reinstate';

export interface ModerationDecision {
  id: string;
  event_id?: string;
  actor_id?: string;
  actor_name?: string;
  action: string;
  from_state?: string;
  to_state?: string;
  reason?: string;
  created_at: string;
}

export interface FeeSettings {
  fee_bps: number;
  updated_by?: string;
  updated_at?: string | null;
}

export interface OrganiserSanction {
  organiser_id: string;
  name?: string;
  suspended: boolean;
  reason?: string;
  decided_by?: string;
  decided_at?: string | null;
  event_total: number;
  event_live: number;
  event_under_review: number;
  tickets_sold: number;
}

export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface SupportMessage {
  id: string;
  case_id: string;
  author_id: string;
  author_name?: string;
  body: string;
  created_at: string;
}

export interface SupportCase {
  id: string;
  event_id?: string;
  event_title?: string;
  order_id?: string;
  ticket_id?: string;
  opened_by: string;
  kind: string;
  subject: string;
  body: string;
  status: SupportStatus;
  priority: SupportPriority;
  assigned_to?: string;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
  reply_count: number;
  messages?: SupportMessage[];
  last_message?: SupportMessage | null;
}

export interface SupportQueueStats {
  open: number;
  in_progress: number;
  resolved_today: number;
  by_priority: Record<string, number>;
  oldest_open_at?: string | null;
}

/** PATCH /support/cases/:id body. assigned_to is written as-is (empty = unassign), so callers must resend the current value. */
export interface SupportCaseUpdate {
  status?: SupportStatus;
  priority?: SupportPriority;
  assigned_to: string;
  note?: string;
}
