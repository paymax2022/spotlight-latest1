// Events commerce admin — refund desk + organiser payouts. Shapes mirror the Go
// JSON tags exactly (backend/internal/top5events/refund_service.go `Refund`,
// `RefundQueueStats`; payouts.go `OrganiserPayout`, `AdminPayoutQueueLine`,
// `PayoutStatement`). Money is integer kobo.

/** event_refunds.status CHECK — the backend emits these upper-case. */
export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'REFUNDED' | 'FAILED';

export interface EventRefund {
  id: string;
  event_id: string;
  order_id: string;
  ticket_id: string;
  buyer_id: string;
  amount_kobo: number;
  fee_kobo: number;
  refund_kobo: number;
  reason?: string;
  status: RefundStatus;
  created_at: string;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  failure_reason?: string;
  idempotency_key?: string;
  event_title?: string;
  event_state?: string;
  tier_name?: string;
  attendee_name?: string;
  buyer_name?: string;
  booking_ref?: string;
}

export interface RefundQueueStats {
  requested: number;
  processing: number;
  failed: number;
  refunded: number;
  rejected: number;
}

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface OrganiserPayout {
  id: string;
  event_id: string;
  organiser_id: string;
  status: PayoutStatus;
  gross_kobo: number;
  fee_kobo: number;
  net_kobo: number;
  reserve_held_kobo: number;
  fee_bps: number;
  reserve_bps: number;
  refunds_kobo: number;
  disputed_kobo: number;
  destination: string;
  idempotency_key: string;
  requested_by: string;
  approved_by?: string | null;
  failure_reason?: string;
  ledger_reference?: string | null;
  created_at: string;
  processing_at?: string | null;
  paid_at?: string | null;
  failed_at?: string | null;
}

export interface PayoutQueueLine {
  event_id: string;
  event_title: string;
  organiser_id: string;
  ends_at: string;
  eligible: boolean;
  reason?: string;
  eligible_at: string;
  available_kobo: number;
  pending_kobo: number;
  paid_kobo: number;
  reserve_kobo: number;
  in_flight_payout_id?: string | null;
  last_payout_at?: string | null;
}

export interface PayoutStatement {
  eligible: boolean;
  reason?: string;
  eligible_at: string;
  reserve_active: boolean;
  reserve_release_at: string;
  event_id: string;
  event_title: string;
  event_state: string;
  ends_at: string;
  organiser_id: string;
  fee_bps: number;
  reserve_bps: number;
  gross_sales_kobo: number;
  refunds_kobo: number;
  disputed_held_kobo: number;
  eligible_gross_kobo: number;
  fees_kobo: number;
  reserve_kobo: number;
  net_earnings_kobo: number;
  paid_kobo: number;
  fees_collected_kobo: number;
  pending_kobo: number;
  balance_kobo: number;
  available_kobo: number;
  payouts: OrganiserPayout[];
}
