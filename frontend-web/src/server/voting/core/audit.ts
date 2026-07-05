/**
 * Shared vote-audit recorder for ALL three vote engines.
 *
 * Wraps the canonical `appendAuditLog` (vote_audit_logs) so every engine writes
 * a consistently-shaped audit entry for the cross-cutting money events:
 * verify, credit, amount-mismatch, duplicate. Engines may ALSO keep their own
 * domain audit (e.g. open-mic's admin_audit_logs payment events) — this core
 * entry is the unified, queryable record that proves the money-safety contract
 * was satisfied across all three.
 *
 * Audit must never throw into the money path: a failed audit write is swallowed
 * (the same fire-and-forget posture the rest of the voting code already uses).
 */
import { appendAuditLog } from '../audit.service';
import type { VoteEngineDomain } from './fraud';

export type VoteAuditAction =
  | 'vote_credited'
  | 'vote_already_processed'
  | 'vote_amount_mismatch'
  | 'vote_payment_failed';

export interface RecordVoteAuditInput {
  domain: VoteEngineDomain;
  action: VoteAuditAction;
  actorId: string;
  /** The entity carrying the money event (transaction id, vote id, entry id). */
  entityId: string;
  entityType?: string;
  contestId?: string;
  contestantId?: string;
  paymentReference?: string | null;
  votes?: number;
  amountPaidKobo?: number | null;
  amountExpectedKobo?: number | null;
  fraudScore?: number;
  ipAddress?: string;
  userAgent?: string;
  extra?: Record<string, unknown>;
}

/**
 * Emit a unified vote-audit entry. Same action vocabulary for all engines so
 * the audit trail reads consistently regardless of which product fired it.
 */
export async function recordVoteAudit(input: RecordVoteAuditInput): Promise<void> {
  try {
    await appendAuditLog({
      actorId: input.actorId,
      actorRole: 'system',
      action: `${input.domain}:${input.action}`,
      entityType: input.entityType ?? 'vote_transaction',
      entityId: input.entityId,
      contestId: input.contestId,
      contestantId: input.contestantId,
      newValue: {
        domain: input.domain,
        action: input.action,
        paymentReference: input.paymentReference ?? null,
        votes: input.votes ?? null,
        amountPaidKobo: input.amountPaidKobo ?? null,
        amountExpectedKobo: input.amountExpectedKobo ?? null,
        fraudScore: input.fraudScore ?? null,
        ...(input.extra ?? {}),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  } catch {
    // Audit failures must not break the money path.
  }
}
