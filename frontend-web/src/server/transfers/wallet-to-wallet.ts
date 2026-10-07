/**
 * Block 10 — Wallet-to-Wallet Transfer Service
 *
 * Provides:
 *   resolvePaymaxUser()      — look up a recipient by phone/email; returns safe preview
 *   calculateTransferFee()   — PRD fee schedule (§18.2)
 *   initiateWalletToWallet() — atomic debit+credit via transfer_wallet_atomic RPC
 *
 * Money rules enforced here:
 *   - amounts are BIGINT kobo throughout
 *   - idempotency key is required and checked before any DB write
 *   - transfer is atomic (RPC) — no partial state possible
 *   - tier daily limit is passed into the RPC for enforcement
 */

import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { getOrCreateAccount } from '@/src/server/wallet/service';
import { enforceWalletLimit } from '@/src/server/tiers/service';
import { requireTransactionPin } from '@/src/server/transfers/pin-guard';

// Fee schedule (PRD §18.2)

/** Returns the transfer fee in kobo for a given transfer amount in kobo. */
export function calculateTransferFee(amountKobo: number): number {
  if (amountKobo <= 500_000)   return 0;        // ₦0–5,000: free
  if (amountKobo <= 5_000_000) return 1_000;    // ₦5,001–50,000: ₦10
  return 2_500;                                  // >₦50,000: ₦25
}

// Recipient types

export interface TransferRecipient {
  userId: string;
  displayName: string;
  maskedPhone: string;
  avatarUrl: string | null;
}

// resolvePaymaxUser

/**
 * Look up a Paymax user by phone number or email address.
 * Returns a safe preview — no full phone or sensitive PII exposed.
 *
 * Phone matching is by 10-digit NSN, because user_profiles was never normalised:
 * the same subscriber is stored as "8159491618", "08159491618",
 * "+2348159491618" or "+234 815 949 1618" depending on which signup path wrote
 * the row. The DB filter is generated from the NSN we computed, never from the
 * caller's raw string — that string used to be spliced into a PostgREST `.or()`
 * filter, where a comma let a caller append their own condition.
 *
 * Throws 409 when two accounts carry the same number. Picking one would move
 * money to a stranger, and a wallet credit cannot be clawed back.
 */
export async function resolvePaymaxUser(
  identifier: string,
  requestingUserId: string,
): Promise<TransferRecipient> {
  if (!identifier || identifier.trim().length < 3) {
    throw new ApiError('Invalid identifier', 400);
  }

  const raw = identifier.trim();
  const isEmail = raw.includes('@');
  const nsn = isEmail ? '' : normalizeNsn(raw);

  // Not an email and not a usable Nigerian mobile — no match. Never fall back to
  // a looser comparison: that is what let a crafted identifier match everyone.
  if (!isEmail && !nsn) {
    throw new ApiError('No Paymax user found for this identifier', 404);
  }

  const supabase = createAdminClient();
  const base = supabase.from('user_profiles').select('id, full_name, phone, avatar_url');

  // The phone filter must surface EVERY row Go would count. The Go rail filters
  // in SQL as right(regexp_replace(phone,'\D','','g'),10) = nsn — the last ten
  // digits of the stored value, however it was spelled. PostgREST cannot express
  // that, and a fixed IN list of spellings misses rows stored with separators
  // (e.g. "+234 906 884 9124"): the lookup then returned only the
  // canonically-stored twin, the ambiguity check below never fired, and the BFF
  // resolved — and could pay — the wrong account while Go refused the same
  // number with 409.
  //
  // So the DB filter asks for a strict SUPERSET of Go's match set — the NSN's
  // digits in order with anything allowed between them — and the
  // normalizeNsn() re-check below decides the real match, exactly like
  // ChooseRecipient() re-normalising every row in Go.
  const scoped = isEmail
    ? base.eq('email', raw.toLowerCase())
    : base.ilike('phone', nsnDigitPattern(nsn));

  // The ilike filter is deliberately looser than Go's SQL expression, so the
  // bound is generous: a truncated result could hide a second account on the
  // same number and the resolver would silently pick one — the failure this
  // guard exists to stop.
  const { data: profiles, error } = await scoped.limit(50);

  if (error) throw new ApiError('Failed to resolve recipient', 500);

  type ProfileRow = {
    id: string;
    full_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  };

  // Can't send to yourself — drop the requester before judging ambiguity.
  let candidates = ((profiles ?? []) as ProfileRow[]).filter(p => p.id !== requestingUserId);

  // Re-confirm in code that each row really carries this NSN. The ilike filter
  // is a loose superset — it can return rows whose digits merely contain the
  // NSN in order — so a row that does not normalise back to the requested NSN
  // was never a real candidate and is discarded, mirroring Go's
  // ChooseRecipient().
  if (!isEmail) {
    candidates = candidates.filter(p => normalizeNsn(p.phone ?? '') === nsn);
  }

  if (candidates.length === 0) {
    throw new ApiError('No Paymax user found for this identifier', 404);
  }

  const distinct = new Set(candidates.map(p => p.id));
  if (distinct.size > 1) {
    throw new ApiError('More than one account uses this phone number', 409);
  }

  const profile = candidates[0];

  return {
    userId: profile.id,
    displayName: profile.full_name ?? 'Paymax User',
    maskedPhone: maskPhone(profile.phone ?? ''),
    avatarUrl: profile.avatar_url ?? null,
  };
}

// Helpers

/**
 * Reduce a phone number to its 10-digit national significant number, so every
 * spelling of one number resolves to one account. Returns '' when the input
 * cannot be a Nigerian mobile; callers MUST treat that as "no match".
 *
 * Mirrors NormalizePhone in backend/internal/services/phone_identifier.go. The
 * two must agree: if they disagree about which account owns a number, the app
 * and the API resolve the same transfer to different people.
 */
export function normalizeNsn(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('234')) return d.slice(3);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  if (d.length === 10) return d;
  return '';
}

/**
 * PostgREST ilike pattern matching ANY stored spelling of an NSN: the ten
 * digits in order with arbitrary characters allowed between them. Any string
 * whose last ten digits are the NSN matches this pattern, so it is a strict
 * superset of the Go rail's
 *   right(regexp_replace(phone,'\D','','g'),10) = nsn
 * filter — no account Go counts as sharing a number can hide from this lookup.
 * Built only from digits we generated; caller input never reaches the filter.
 */
export function nsnDigitPattern(nsn: string): string {
  return `%${nsn.split('').join('%')}%`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

// Transfer input / output types

export interface WalletToWalletInput {
  senderId: string;
  recipientIdentifier: string;
  amountKobo: number;
  idempotencyKey: string;
  narration?: string;
  /** Raw transaction PIN, verified via requireTransactionPin() before any debit. */
  pin: string;
  /** Original request's Authorization header, forwarded to the Go PIN-verify endpoint. */
  authHeader: string | null;
}

export interface WalletTransferResult {
  alreadyProcessed: boolean;
  transferId: string;
  reference: string;
  amountKobo: number;
  feeKobo: number;
  senderEntryId: string;
  receiverEntryId: string;
  receiverDisplayName: string;
  createdAt: string;
}

// initiateWalletToWallet

export async function initiateWalletToWallet(
  input: WalletToWalletInput,
): Promise<WalletTransferResult> {
  if (!Number.isInteger(input.amountKobo) || input.amountKobo < 100) {
    throw new ApiError('Minimum transfer amount is 100 kobo (₦1)', 400);
  }

  const feeKobo = calculateTransferFee(input.amountKobo);
  const totalKobo = input.amountKobo + feeKobo;

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('wallet_transfers')
    .select('id, reference, amount_kobo, fee_kobo, sender_entry_id, receiver_entry_id, created_at, receiver_id, sender_id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    const row = existing as {
      id: string; reference: string; amount_kobo: number; fee_kobo: number;
      sender_entry_id: string; receiver_entry_id: string;
      created_at: string; receiver_id: string; sender_id: string;
    };
    // The key exists but belongs to a DIFFERENT sender — returning that row
    // would leak another user's transfer (recipient, amount, refs). Mirror the
    // Go rail: foreign key collisions are a 409, not a replay.
    if (row.sender_id !== input.senderId) {
      throw new ApiError('Idempotency-Key conflicts with an existing transaction.', 409);
    }
    const { data: receiverProfile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', row.receiver_id)
      .maybeSingle();

    return {
      alreadyProcessed: true,
      transferId: row.id,
      reference: row.reference,
      amountKobo: row.amount_kobo,
      feeKobo: row.fee_kobo,
      senderEntryId: row.sender_entry_id,
      receiverEntryId: row.receiver_entry_id,
      receiverDisplayName: (receiverProfile as { full_name?: string } | null)?.full_name ?? 'Paymax User',
      createdAt: row.created_at,
    };
  }

  // Transaction PIN — fail-closed, before any money movement (WAL-001 fix).
  // Not checked above the idempotency-replay branch: a replay returns the
  // already-completed transfer rather than executing a new debit, so it does
  // not need a fresh PIN, matching the Go-native transfer paths' behavior.
  await requireTransactionPin(input.authHeader, input.pin);

  // Resolve recipient
  const recipient = await resolvePaymaxUser(input.recipientIdentifier, input.senderId);

  // Narration safety: cap at 100 chars
  const narration = (input.narration ?? '').slice(0, 100) || null;

  // Get ledger account IDs for both parties (creates if missing)
  const [senderAccountId, receiverAccountId] = await Promise.all([
    getOrCreateAccount(input.senderId),
    getOrCreateAccount(recipient.userId),
  ]);

  // Get tier daily limit (throws 403 for tier 0 or projected overage)
  const { dailyLimitKobo } = await enforceWalletLimit(input.senderId, totalKobo);

  // Generate reference
  const reference = `TRF_${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

  // Atomic transfer — single DB transaction
  const { data: rpcRows, error: rpcError } = await supabase.rpc('transfer_wallet_atomic', {
    p_sender_account_id:   senderAccountId,
    p_receiver_account_id: receiverAccountId,
    p_sender_id:           input.senderId,
    p_receiver_id:         recipient.userId,
    p_amount_kobo:         input.amountKobo,
    p_fee_kobo:            feeKobo,
    p_reference:           reference,
    p_idempotency_key:     input.idempotencyKey,
    p_daily_limit_kobo:    dailyLimitKobo ?? 0,
    p_narration:           narration,
    p_metadata: {
      sender_id: input.senderId,
      receiver_id: recipient.userId,
      transfer_type: 'wallet_to_wallet',
    },
  });

  if (rpcError) {
    if (rpcError.code === '23505') {
      // Idempotency race — treat as already processed
      return initiateWalletToWallet(input);
    }
    if (rpcError.message?.includes('INSUFFICIENT_BALANCE')) {
      throw new ApiError('Insufficient wallet balance', 402);
    }
    if (rpcError.message?.includes('TIER_LIMIT_EXCEEDED')) {
      throw new ApiError('Daily wallet limit for your KYC tier has been reached', 403);
    }
    if (rpcError.message?.includes('SELF_TRANSFER')) {
      throw new ApiError('You cannot transfer to yourself', 422);
    }
    console.error('[transfers] wallet-to-wallet RPC failed unexpectedly:', rpcError.message);
    throw new ApiError("We couldn't complete this transfer. Please try again.", 500);
  }

  const row = (rpcRows as Array<{
    sender_entry_id: string;
    receiver_entry_id: string;
    transfer_id: string;
  }>)[0];

  return {
    alreadyProcessed: false,
    transferId: row.transfer_id,
    reference,
    amountKobo: input.amountKobo,
    feeKobo,
    senderEntryId: row.sender_entry_id,
    receiverEntryId: row.receiver_entry_id,
    receiverDisplayName: recipient.displayName,
    createdAt: new Date().toISOString(),
  };
}
