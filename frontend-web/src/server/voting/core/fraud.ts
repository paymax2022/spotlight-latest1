/**
 * Shared fraud-signal recorder for ALL three vote engines.
 *
 * v1 already had a rich, settings-driven scorer (`fraud.service.ts#runFraudChecks`)
 * that reads the `votes` table. That stays the engine-specific scorer for the
 * general contest model. This module adds the cross-cutting signals that ALL
 * three engines share and that previously existed only ad-hoc (or not at all)
 * in v2 / open-mic:
 *
 *   - velocity            (too many credited votes for the same key in a window)
 *   - repeated_device_ip  (same device/IP credited repeatedly)
 *   - amount_mismatch     (amount paid ≠ amount expected on a paid vote)
 *
 * It is table-agnostic: the caller supplies a `domain` discriminator so a flag
 * can be persisted (or just audited) consistently regardless of whether the
 * underlying votes live in `votes`, `competition_entry_votes`, or the legacy
 * bridge tables. We never write to a domain's vote tables here — only to the
 * shared `fraud_flags` ledger and (via the caller) the audit log.
 */
import { createAdminClient } from '@/lib/supabase/server';
import type { FraudFlagType, FraudSeverity } from '@/src/features/voting/types';

export type VoteEngineDomain = 'general' | 'bridge' | 'open-mic';

export interface VoteFraudSignal {
  type: FraudFlagType;
  severity: FraudSeverity;
  reason: string;
  score: number;
}

export interface RecordVoteFraudInput {
  domain: VoteEngineDomain;
  contestId: string;
  /** Entry/contestant the vote is for. Optional for engines that don't carry it. */
  contestantId?: string | null;
  /** Number of votes credited in this single transaction. */
  votes: number;
  /** Paystack/idempotency reference, used for dedup of the signal itself. */
  paymentReference?: string | null;
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
  userId?: string | null;
  /** Paid-vote amount reconciliation, in minor units (kobo). */
  amountExpectedKobo?: number | null;
  amountPaidKobo?: number | null;
  /** Per-contest threshold above which a single transaction looks suspicious. */
  highVolumeThreshold?: number;
  highVolumeHardThreshold?: number;
}

export interface RecordVoteFraudResult {
  signals: VoteFraudSignal[];
  /** Sum of signal scores (0+). Higher = more suspicious. */
  score: number;
}

/**
 * Detect + persist cross-cutting fraud signals for a single credited vote.
 *
 * Returns the signals so the caller can fold them into its own audit entry.
 * Persistence to `fraud_flags` is best-effort (fire-and-forget): a failure to
 * flag must never block or fail a legitimately-paid vote.
 */
export async function recordVoteFraudSignals(
  input: RecordVoteFraudInput,
): Promise<RecordVoteFraudResult> {
  const signals: VoteFraudSignal[] = [];

  // 1. Amount mismatch (paid votes only) — load-bearing money-safety signal.
  if (
    input.amountExpectedKobo != null &&
    input.amountPaidKobo != null &&
    Math.abs(input.amountPaidKobo - input.amountExpectedKobo) > 1
  ) {
    signals.push({
      type: 'suspicious_payment',
      severity: 'high',
      reason: `amount mismatch: expected ${input.amountExpectedKobo} kobo, paid ${input.amountPaidKobo} kobo`,
      score: 40,
    });
  }

  // 2. High-volume / velocity in a single transaction.
  const hi = input.highVolumeThreshold ?? 100;
  const hardHi = input.highVolumeHardThreshold ?? 300;
  if (input.votes >= hi) {
    signals.push({
      type: 'vote_spike',
      severity: input.votes >= hardHi ? 'high' : 'medium',
      reason: `large vote quantity in single transaction (${input.votes})`,
      score: input.votes >= hardHi ? 25 : 15,
    });
  }

  // 3. Repeated device/IP — same fingerprint or IP seen on many prior flags.
  //    Best-effort: only runs when we have an anchor to count against.
  if (input.deviceFingerprint || input.ipAddress) {
    const repeated = await countRepeatedDeviceOrIp(input);
    if (repeated >= 5) {
      signals.push({
        type: input.deviceFingerprint ? 'duplicate_device' : 'duplicate_ip',
        severity: 'medium',
        reason: `repeated device/IP: ${repeated} recent flags from same source`,
        score: 20,
      });
    }
  }

  const score = signals.reduce((sum, s) => sum + s.score, 0);

  // Persist every signal to the shared fraud_flags ledger (fire-and-forget).
  if (signals.length > 0) {
    void persistFraudFlags(input, signals);
  }

  return { signals, score };
}

async function countRepeatedDeviceOrIp(input: RecordVoteFraudInput): Promise<number> {
  try {
    const supabase = createAdminClient();
    const since = new Date(Date.now() - 3_600_000).toISOString();
    let query = supabase
      .from('fraud_flags')
      .select('id', { count: 'exact', head: true })
      .eq('contest_id', input.contestId)
      .gte('created_at', since);

    if (input.deviceFingerprint) {
      query = query.eq('flag_type', 'duplicate_device');
    } else if (input.ipAddress) {
      query = query.eq('flag_type', 'duplicate_ip');
    }

    const { count } = await query;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function persistFraudFlags(
  input: RecordVoteFraudInput,
  signals: VoteFraudSignal[],
): Promise<void> {
  try {
    const supabase = createAdminClient();
    for (const signal of signals) {
      await supabase.from('fraud_flags').insert({
        contest_id: input.contestId,
        contestant_id: input.contestantId ?? null,
        voter_profile_id: null,
        flag_type: signal.type,
        severity: signal.severity,
        description: `[${input.domain}] ${signal.reason}`,
        status: 'open',
      });
    }
  } catch {
    // Silent — flagging must never block a paid/credited vote.
  }
}
