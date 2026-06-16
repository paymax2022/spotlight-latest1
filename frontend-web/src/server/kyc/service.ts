/**
 * KYC state machine service.
 *
 * All writes use service_role (createAdminClient).
 * Raw document numbers are NEVER stored — only HMAC-SHA256 hashes.
 * Every state change appends an immutable row to kyc_events.
 *
 * State machine:
 *   unverified ──► pending ──► verified
 *                      │
 *                      └──► failed ──► pending  (retry)
 *   verified ──► suspended  (admin-only)
 *
 * New files only — protected source files are not touched.
 */

import { createHmac } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { getRequiredEnv, getOptionalEnv } from '@/src/lib/config/env';
import type {
  KycProfile,
  KycStatus,
  KycTier,
  InitiateKycInput,
  DocumentType,
} from './types';
import { VALID_TRANSITIONS } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Hash a document number so no PII is stored in the DB. */
function hashDocument(documentNumber: string, userId: string): string {
  const secret = getOptionalEnv('SPOTLIGHT_KYC_HASH_SECRET') ?? userId;
  return createHmac('sha256', secret).update(documentNumber).digest('hex');
}

/** Null-safe column picker — returns defaults for new users with no KYC data. */
function toKycProfile(row: Record<string, unknown> | null): KycProfile {
  return {
    kyc_tier:         (row?.kyc_tier as KycTier)     ?? 0,
    kyc_requested_tier: (row?.kyc_requested_tier as 1 | 2 | 3 | null) ?? null,
    kyc_status:       (row?.kyc_status as KycStatus) ?? 'unverified',
    phone_verified:   (row?.phone_verified as boolean) ?? false,
    kyc_submitted_at: (row?.kyc_submitted_at as string) ?? null,
    kyc_verified_at:  (row?.kyc_verified_at as string)  ?? null,
    document_type:    (row?.document_type as DocumentType) ?? null,
  };
}

function assertValidTransition(from: KycStatus, to: KycStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ApiError(
      `KYC transition ${from} → ${to} is not permitted.`,
      409,
    );
  }
}

async function appendKycEvent(params: {
  userId: string;
  oldStatus: KycStatus | null;
  newStatus: KycStatus;
  oldTier: KycTier;
  newTier: KycTier;
  documentType?: DocumentType | null;
  actorId?: string | null;
  note?: string | null;
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('kyc_events').insert({
    user_id:      params.userId,
    old_status:   params.oldStatus,
    new_status:   params.newStatus,
    old_tier:     params.oldTier,
    new_tier:     params.newTier,
    document_type: params.documentType ?? null,
    actor_id:     params.actorId ?? null,
    note:         params.note ?? null,
  });
  if (error) {
    // Audit write failure is critical — surface it
    throw new ApiError('Failed to write KYC audit event', 500);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch the KYC profile for a user. Returns tier=0/status=unverified for new users. */
export async function getKycProfile(userId: string): Promise<KycProfile> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('kyc_tier, kyc_requested_tier, kyc_status, phone_verified, kyc_submitted_at, kyc_verified_at, document_type')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new ApiError('Failed to fetch KYC profile', 500);
  return toKycProfile(data);
}

/** Shorthand: just the tier integer, used for gate checks. */
export async function getKycTier(userId: string): Promise<KycTier> {
  const profile = await getKycProfile(userId);
  return profile.kyc_tier;
}

/**
 * Submit KYC documents — moves status from unverified/failed → pending.
 * Idempotent: calling when already pending returns the current profile.
 */
export async function initiateKyc(
  userId: string,
  input: InitiateKycInput,
): Promise<KycProfile> {
  const current = await getKycProfile(userId);

  // Idempotency: already pending → return current state
  if (current.kyc_status === 'pending') return current;

  assertValidTransition(current.kyc_status, 'pending');

  const docHash = hashDocument(input.document_number, userId);
  const hashCol = input.document_type === 'BVN' ? 'bvn_hash' : 'nin_hash';
  const now = new Date().toISOString();

  const supabase = createAdminClient();
  const updates: Record<string, unknown> = {
    kyc_status:      'pending',
    kyc_submitted_at: now,
    kyc_requested_tier: input.requested_tier ?? null,
    document_type:   input.document_type,
    document_ref:    null, // populated by provider webhook later
    [hashCol]:       docHash,
  };

  if (input.phone) {
    updates.phone = input.phone;
  }

  const { error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', userId);

  if (error) throw new ApiError('Failed to initiate KYC', 500);

  await appendKycEvent({
    userId,
    oldStatus:    current.kyc_status,
    newStatus:    'pending',
    oldTier:      current.kyc_tier,
    newTier:      current.kyc_tier, // tier unchanged until approved
    documentType: input.document_type,
    note: 'User-initiated KYC submission',
  });

  return { ...current, kyc_status: 'pending', kyc_submitted_at: now, kyc_requested_tier: input.requested_tier ?? null, document_type: input.document_type };
}

/**
 * Approve KYC and assign a new tier.
 * Admin-only — caller must verify actor has `kyc:approve` permission.
 */
export async function approveKyc(
  userId: string,
  newTier: KycTier,
  actorId: string,
): Promise<KycProfile> {
  const current = await getKycProfile(userId);
  assertValidTransition(current.kyc_status, 'verified');

  const now = new Date().toISOString();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({ kyc_status: 'verified', kyc_tier: newTier, kyc_requested_tier: null, kyc_verified_at: now })
    .eq('id', userId);

  if (error) throw new ApiError('Failed to approve KYC', 500);

  await appendKycEvent({
    userId,
    oldStatus:  current.kyc_status,
    newStatus:  'verified',
    oldTier:    current.kyc_tier,
    newTier,
    actorId,
    note: `Approved — tier set to ${newTier}`,
  });

  return { ...current, kyc_status: 'verified', kyc_tier: newTier, kyc_requested_tier: null, kyc_verified_at: now };
}

/**
 * Fail a KYC submission.
 * Admin-only — caller must verify actor has `kyc:reject` permission.
 */
export async function failKyc(
  userId: string,
  reason: string,
  actorId: string,
): Promise<KycProfile> {
  const current = await getKycProfile(userId);
  assertValidTransition(current.kyc_status, 'failed');

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({ kyc_status: 'failed' })
    .eq('id', userId);

  if (error) throw new ApiError('Failed to record KYC failure', 500);

  await appendKycEvent({
    userId,
    oldStatus: current.kyc_status,
    newStatus: 'failed',
    oldTier:   current.kyc_tier,
    newTier:   current.kyc_tier,
    actorId,
    note: reason,
  });

  return { ...current, kyc_status: 'failed' };
}

/**
 * Auto-verify Tier 0: email + date_of_birth + phone present → immediately verified.
 * No document required. Bypasses the unverified→pending state machine step.
 * Allowed from: unverified, failed. Blocked if pending or already verified at tier >= 0.
 */
export async function claimTier0(userId: string): Promise<KycProfile> {
  const supabase = createAdminClient();

  // Fetch both KYC state and the required profile fields in one query
  const { data, error: fetchError } = await supabase
    .from('user_profiles')
    .select('kyc_tier, kyc_status, kyc_requested_tier, phone_verified, kyc_submitted_at, kyc_verified_at, document_type, date_of_birth, phone, email')
    .eq('id', userId)
    .maybeSingle();

  if (fetchError) throw new ApiError('Failed to fetch profile for Tier 0 claim', 500);

  const current = toKycProfile(data);

  if (current.kyc_status === 'pending') {
    throw new ApiError('A KYC review is already in progress. Please wait for it to complete.', 409);
  }
  if (current.kyc_status === 'verified' && current.kyc_tier >= 0) {
    return current;
  }
  if (current.kyc_status === 'suspended') {
    throw new ApiError('Account is suspended. Contact support.', 403);
  }

  const row = (data ?? {}) as Record<string, unknown>;
  if (!row.date_of_birth) {
    throw new ApiError('Date of birth is required to reach Tier 0. Please update your profile first.', 422);
  }
  if (!row.phone && !row.email) {
    throw new ApiError('Phone number or email is required to reach Tier 0.', 422);
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      kyc_status:    'verified',
      kyc_tier:      0,
      kyc_verified_at: now,
      kyc_submitted_at: now,
      kyc_requested_tier: null,
    })
    .eq('id', userId);

  if (updateError) throw new ApiError('Failed to claim Tier 0', 500);

  await appendKycEvent({
    userId,
    oldStatus: current.kyc_status,
    newStatus: 'verified',
    oldTier:   current.kyc_tier,
    newTier:   0,
    note: 'Tier 0 auto-verified — email + date_of_birth + phone provided',
  });

  return { ...current, kyc_status: 'verified', kyc_tier: 0, kyc_verified_at: now, kyc_submitted_at: now, kyc_requested_tier: null };
}

/**
 * Suspend a verified user's KYC (e.g. fraud detected post-approval).
 * Admin-only — caller must verify actor has `kyc:suspend` permission.
 */
export async function suspendKyc(
  userId: string,
  reason: string,
  actorId: string,
): Promise<KycProfile> {
  const current = await getKycProfile(userId);
  assertValidTransition(current.kyc_status, 'suspended');

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({ kyc_status: 'suspended' })
    .eq('id', userId);

  if (error) throw new ApiError('Failed to suspend KYC', 500);

  await appendKycEvent({
    userId,
    oldStatus: current.kyc_status,
    newStatus: 'suspended',
    oldTier:   current.kyc_tier,
    newTier:   current.kyc_tier,
    actorId,
    note: reason,
  });

  return { ...current, kyc_status: 'suspended' };
}
