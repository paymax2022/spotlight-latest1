/**
 * Transactional outbox for async side effects
 * Queues referral credits, analytics, notifications without blocking the vote
 */

import { createAdminClient } from '@/lib/supabase/admin';

export type OutboxEventType =
  | 'votes.free.cast'
  | 'votes.paid.credited'
  | 'votes.wallet.cast'
  | 'referral.triggered'
  | 'votes.analytics'
  | 'leaderboard.updated'
  // Written by trg_connect_tally_follows_credit when a credited purchase could
  // not be projected into connect_votes. Retried by handleTallySkipped below —
  // without a handler these rows were an unread audit trail of buyers who paid
  // and were shown nothing.
  | 'votes.paid.tally_skipped';

export interface OutboxEvent {
  id?: string;
  event_type: OutboxEventType;
  payload: Record<string, any>;
  status?: 'pending' | 'processing' | 'done' | 'failed';
  attempts?: number;
  last_error?: string;
  created_at?: string;
  processed_at?: string;
}

/**
 * Enqueue an async event for processing
 * Non-blocking — doesn't wait for the event to be processed
 */
export async function enqueueOutboxEvent(
  eventType: OutboxEventType,
  payload: Record<string, any>
): Promise<string | null> {
  const supabase = createAdminClient();

  try {
    const { data, error } = await supabase
      .from('bridge_outbox')
      .insert({
        event_type: eventType,
        payload,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Outbox] Failed to enqueue event:', error);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error('[Outbox] enqueueOutboxEvent error:', error);
    // Non-blocking — don't fail the vote if outbox is down
    return null;
  }
}

/**
 * Process pending outbox events (called by a background worker/cron)
 */
export async function processPendingOutboxEvents() {
  const supabase = createAdminClient();

  try {
    // Fetch pending events ordered by creation time
    const { data: events, error } = await supabase
      .from('bridge_outbox')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100);

    if (error || !events) {
      console.error('[Outbox] Failed to fetch pending events:', error);
      return 0;
    }

    let processed = 0;

    for (const event of events) {
      try {
        // Mark as processing
        await supabase
          .from('bridge_outbox')
          .update({ status: 'processing' })
          .eq('id', event.id);

        // Process the event
        const success = await handleOutboxEvent(event as OutboxEvent);

        if (success) {
          // Mark as done
          await supabase
            .from('bridge_outbox')
            .update({ status: 'done', processed_at: new Date().toISOString() })
            .eq('id', event.id);
          processed++;
        } else {
          // Increment attempts and mark as pending for retry
          const attempts = (event.attempts || 0) + 1;
          if (attempts >= 3) {
            // Max retries reached — mark as failed
            await supabase
              .from('bridge_outbox')
              .update({
                status: 'failed',
                attempts,
                last_error: 'Max retries exceeded',
              })
              .eq('id', event.id);
          } else {
            // Retry
            await supabase
              .from('bridge_outbox')
              .update({ status: 'pending', attempts })
              .eq('id', event.id);
          }
        }
      } catch (error) {
        console.error(`[Outbox] Failed to process event ${event.id}:`, error);
        // Mark as failed with error message
        await supabase
          .from('bridge_outbox')
          .update({
            status: 'failed',
            attempts: (event.attempts || 0) + 1,
            last_error: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', event.id);
      }
    }

    return processed;
  } catch (error) {
    console.error('[Outbox] processPendingOutboxEvents error:', error);
    return 0;
  }
}

/**
 * Handle a specific outbox event
 */
async function handleOutboxEvent(event: OutboxEvent): Promise<boolean> {
  try {
    switch (event.event_type) {
      case 'referral.triggered':
        return await handleReferralTriggered(event.payload);

      case 'votes.free.cast':
        return await handleVoteAnalytics(event.payload);

      case 'votes.paid.credited':
        return await handleVoteAnalytics(event.payload);

      case 'votes.analytics':
        return await handleVoteAnalytics(event.payload);

      case 'leaderboard.updated':
        return await handleLeaderboardUpdated(event.payload);

      case 'votes.paid.tally_skipped':
      return handleTallySkipped(event.payload);

    default:
        console.warn(`[Outbox] Unknown event type: ${event.event_type}`);
        return false;
    }
  } catch (error) {
    console.error(`[Outbox] Error handling event ${event.event_type}:`, error);
    return false;
  }
}

/**
 * Handle referral reward logic
 */
async function handleReferralTriggered(payload: Record<string, any>): Promise<boolean> {
  try {
    const { shareCode, voterId, contestantId } = payload;

    // TODO: Implement referral reward logic
    // This would typically:
    // 1. Validate the share code
    // 2. Credit the referrer's wallet
    // 3. Log the referral event

    console.log('[Outbox] Referral triggered:', { shareCode, voterId, contestantId });
    return true;
  } catch (error) {
    console.error('[Outbox] handleReferralTriggered error:', error);
    return false;
  }
}

/**
 * Handle vote analytics
 */
async function handleVoteAnalytics(payload: Record<string, any>): Promise<boolean> {
  try {
    // TODO: Implement analytics event logging
    // This would typically:
    // 1. Log the vote event to analytics service
    // 2. Update vote statistics
    // 3. Trigger leaderboard recalculation

    console.log('[Outbox] Vote analytics:', payload);
    return true;
  } catch (error) {
    console.error('[Outbox] handleVoteAnalytics error:', error);
    return false;
  }
}

/**
 * Handle leaderboard updates
 */
async function handleLeaderboardUpdated(payload: Record<string, any>): Promise<boolean> {
  try {
    // TODO: Implement leaderboard update logic
    // This would typically:
    // 1. Recalculate rankings
    // 2. Notify users of rank changes
    // 3. Cache the leaderboard

    console.log('[Outbox] Leaderboard updated:', payload);
    return true;
  } catch (error) {
    console.error('[Outbox] handleLeaderboardUpdated error:', error);
    return false;
  }
}

/**
 * Get pending event count
 */
export async function getPendingEventCount(): Promise<number> {
  const supabase = createAdminClient();

  try {
    const { count, error } = await supabase
      .from('bridge_outbox')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) {
      console.error('[Outbox] getPendingEventCount error:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('[Outbox] getPendingEventCount error:', error);
    return 0;
  }
}

/**
 * Re-attempt a projection the trigger could not make.
 *
 * Most reasons are permanent (a refunded purchase, a contestant on no roster) and
 * must NOT be retried into existence — returning true marks them done so they stop
 * cycling. Only a transient failure is worth another attempt, and the retry is the
 * cheapest possible one: touch vote_credit_status so the trigger re-evaluates with
 * the same idempotency key, which collapses if the row now exists.
 */
async function handleTallySkipped(payload: Record<string, any>): Promise<boolean> {
  const terminal = new Set([
    'recredit_after_refund',
    'contestant_not_in_contest',
    'contest_not_in_connect_plane',
    'missing_voter',
    'invalid_quantity',
    'invalid_amount',
  ]);
  if (terminal.has(String(payload?.reason ?? ''))) return true;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('connect_votes')
    .select('id')
    .eq('idempotency_key', `connect-tally:${payload?.paymentReference}`)
    .maybeSingle();
  if (data) return true;  // already projected — nothing to do

  const { error } = await supabase
    .from('vote_transactions')
    .update({ vote_credit_status: 'credited' })
    .eq('id', payload?.transactionId)
    .eq('vote_credit_status', 'credited');
  return !error;
}
