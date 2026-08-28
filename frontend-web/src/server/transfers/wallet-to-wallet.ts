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

// ---------------------------------------------------------------------------
// Fee schedule (PRD §18.2)
// ---------------------------------------------------------------------------

/** Returns the transfer fee in kobo for a given transfer amount in kobo. */
export function calculateTransferFee(amountKobo: number): number {
  if (amountKobo <= 500_000)   return 0;        // ₦0–5,000: free
  if (amountKobo <= 5_000_000) return 1_000;    // ₦5,001–50,000: ₦10
  return 2_500;                                  // >₦50,000: ₦25
}

// ---------------------------------------------------------------------------
// Recipient types
// ---------------------------------------------------------------------------

export interface TransferRecipient {
  userId: string;
  displayName: string;
  maskedPhone: string;
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// resolvePaymaxUser
// ---------------------------------------------------------------------------

/**
 * Look up a Paymax user by phone number or email address.
 * Returns a safe preview — no full phone or sensitive PII exposed.
 *
 * Phone matching is by 10-digit NSN, because user_profiles was never normalised:
 * the same subscriber is stored as "8159491618", "08159491618" or
 * "+2348159491618" depending on which signup path wrote the row. The candidate
 * list is generated from the NSN we computed, never from the caller's raw
 * string — that string used to be spliced into a PostgREST `.or()` filter, where
 * a comma let a caller append their own condition.
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

  // Both filters are built from values WE produced (an NSN of exactly 10 digits,
  // or a lower-cased email passed as a bound value), so nothing the caller typed
  // is ever interpolated into a filter expression.
  const scoped = isEmail
    ? base.eq('email', raw.toLowerCase())
    : base.in('phone', phoneVariantsForNsn(nsn));

  // 5, not 2: we must be able to SEE a second account on the same number rather
  // than truncate it away and resolve to whichever row came back first.
  const { data: profiles, error } = await scoped.limit(5);

  if (error) throw new ApiError('Failed to resolve recipient', 500);

  type ProfileRow = {
    id: string;
    full_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  };

  // Can't send to yourself — drop the requester before judging ambiguity.
  let candidates = ((profiles ?? []) as ProfileRow[]).filter(p => p.id !== requestingUserId);

  // Re-confirm in code that each row really carries this NSN. The IN list is an
  // exact-string match against known spellings; anything else the database
  // returned was never a real candidate.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Every spelling of one NSN that user_profiles is known to hold. The bare NSN
 * form is deliberately first — it is a real stored format that the previous
 * variant list never generated, so those recipients could not be found at all.
 */
export function phoneVariantsForNsn(nsn: string): string[] {
  return [nsn, `0${nsn}`, `+234${nsn}`, `234${nsn}`];
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

// ---------------------------------------------------------------------------
// Transfer input / output types
// ---------------------------------------------------------------------------

export interface WalletToWalletInput {
  senderId: string;
  recipientIdentifier: string;
  amountKobo: number;
  idempotencyKey: string;
  narration?: string;
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

// ---------------------------------------------------------------------------
// initiateWalletToWallet
// ---------------------------------------------------------------------------

export async function initiateWalletToWallet(
  input: WalletToWalletInput,
): Promise<WalletTransferResult> {
  // Validate amount
  if (!Number.isInteger(input.amountKobo) || input.amountKobo < 100) {
    throw new ApiError('Minimum transfer amount is 100 kobo (₦1)', 400);
  }

  const feeKobo = calculateTransferFee(input.amountKobo);
  const totalKobo = input.amountKobo + feeKobo;

  // Idempotency: check if this key was already used for a completed transfer
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('wallet_transfers')
    .select('id, reference, amount_kobo, fee_kobo, sender_entry_id, receiver_entry_id, created_at, receiver_id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    const row = existing as {
      id: string; reference: string; amount_kobo: number; fee_kobo: number;
      sender_entry_id: string; receiver_entry_id: string;
      created_at: string; receiver_id: string;
    };
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
    throw new ApiError(`Transfer failed: ${rpcError.message}`, 500);
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
