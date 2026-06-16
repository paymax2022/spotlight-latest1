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
 * Normalises phone input: strips leading +234 or 0 prefix and matches
 * both formats stored in user_profiles.
 */
export async function resolvePaymaxUser(
  identifier: string,
  requestingUserId: string,
): Promise<TransferRecipient> {
  if (!identifier || identifier.trim().length < 3) {
    throw new ApiError('Invalid identifier', 400);
  }

  const raw = identifier.trim();
  const supabase = createAdminClient();

  // Build candidate phone variants so we match "08012345678", "+2348012345678", etc.
  const phoneVariants = buildPhoneVariants(raw);

  // Query user_profiles — search by phone or email
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, phone, avatar_url')
    .or(
      [
        ...phoneVariants.map(p => `phone.eq.${p}`),
        raw.includes('@') ? `email.eq.${raw.toLowerCase()}` : null,
      ]
        .filter(Boolean)
        .join(','),
    )
    .limit(2);

  if (error) throw new ApiError('Failed to resolve recipient', 500);

  // Filter out the requesting user (can't send to yourself)
  const match = (profiles ?? []).find(p => (p as { id: string }).id !== requestingUserId);

  if (!match) throw new ApiError('No Paymax user found for this identifier', 404);

  const profile = match as {
    id: string;
    full_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  };

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

function buildPhoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  const variants = new Set<string>();
  variants.add(raw);
  if (digits.length === 11 && digits.startsWith('0')) {
    variants.add(digits);
    variants.add(`+234${digits.slice(1)}`);
    variants.add(`234${digits.slice(1)}`);
  } else if (digits.length === 10) {
    variants.add(`0${digits}`);
    variants.add(`+234${digits}`);
    variants.add(`234${digits}`);
  } else if (digits.length === 13 && digits.startsWith('234')) {
    variants.add(`0${digits.slice(3)}`);
    variants.add(`+${digits}`);
  }
  return Array.from(variants);
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
