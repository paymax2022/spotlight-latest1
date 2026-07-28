import { createAdminClient } from '@/lib/supabase/server';

export type OutboxEventType =
  | 'votes.free.cast'
  | 'votes.paid.credited'
  | 'votes.wallet.cast'
  | 'referral.triggered';

/**
 * Enqueue a side-effect event in the transactional outbox.
 * Non-blocking — failures are silently swallowed so a bad outbox INSERT
 * never causes a vote to fail. The event will be retried by the background worker.
 */
export async function enqueueOutboxEvent(
  eventType: OutboxEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('bridge_outbox').insert({
      event_type: eventType,
      payload,
      status: 'pending',
    });
  } catch {
    // Silent — outbox failure must never block the vote response
  }
}
