/**
 * Block 12 — Beneficiary Management Service
 *
 * A "beneficiary" is a saved bank_transfer_recipient (is_favorite = true).
 * The underlying table was created in Block 11; this module just exposes
 * CRUD over the is_favorite flag and nickname, plus auto-save on transfer.
 *
 * No new migration required — is_favorite, nickname, and last_used_at
 * already exist on bank_transfer_recipients.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Beneficiary {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumberLast4: string;
  accountName: string;
  nickname: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// listBeneficiaries
// ---------------------------------------------------------------------------

export async function listBeneficiaries(userId: string): Promise<Beneficiary[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bank_transfer_recipients')
    .select('id, bank_code, bank_name, account_number_last4, account_name, nickname, last_used_at, created_at')
    .eq('user_id', userId)
    .eq('is_favorite', true)
    .order('last_used_at', { ascending: false, nullsFirst: false });

  if (error) throw new ApiError('Failed to list beneficiaries', 500);

  return ((data ?? []) as Array<Record<string, unknown>>).map(mapRow);
}

// ---------------------------------------------------------------------------
// saveBeneficiary — mark an existing recipient as saved, optionally set nickname
// ---------------------------------------------------------------------------

export async function saveBeneficiary(
  userId: string,
  recipientId: string,
  nickname?: string,
): Promise<Beneficiary> {
  const supabase = createAdminClient();

  const updates: Record<string, unknown> = { is_favorite: true };
  if (nickname !== undefined) updates.nickname = nickname.trim().slice(0, 50) || null;

  const { data, error } = await supabase
    .from('bank_transfer_recipients')
    .update(updates)
    .eq('id', recipientId)
    .eq('user_id', userId)  // row-level ownership check
    .select('id, bank_code, bank_name, account_number_last4, account_name, nickname, last_used_at, created_at')
    .maybeSingle();

  if (error) throw new ApiError('Failed to save beneficiary', 500);
  if (!data) throw new ApiError('Recipient not found', 404);

  return mapRow(data as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// removeBeneficiary — unmark (soft; the recipient row stays for reuse)
// ---------------------------------------------------------------------------

export async function removeBeneficiary(userId: string, recipientId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('bank_transfer_recipients')
    .update({ is_favorite: false, nickname: null })
    .eq('id', recipientId)
    .eq('user_id', userId);

  if (error) throw new ApiError('Failed to remove beneficiary', 500);
}

// ---------------------------------------------------------------------------
// touchLastUsed — called internally after every successful bank transfer
// ---------------------------------------------------------------------------

export async function touchLastUsed(recipientId: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('bank_transfer_recipients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', recipientId);
}

// ---------------------------------------------------------------------------
// autoSaveBeneficiary — set is_favorite=true when save_beneficiary=true on transfer
// ---------------------------------------------------------------------------

export async function autoSaveBeneficiary(
  userId: string,
  recipientId: string,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('bank_transfer_recipients')
    .update({ is_favorite: true, last_used_at: new Date().toISOString() })
    .eq('id', recipientId)
    .eq('user_id', userId);
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRow(row: Record<string, unknown>): Beneficiary {
  return {
    id:                 String(row.id ?? ''),
    bankCode:           String(row.bank_code ?? ''),
    bankName:           String(row.bank_name ?? ''),
    accountNumberLast4: String(row.account_number_last4 ?? ''),
    accountName:        String(row.account_name ?? ''),
    nickname:           (row.nickname as string | null) ?? null,
    lastUsedAt:         (row.last_used_at as string | null) ?? null,
    createdAt:          String(row.created_at ?? ''),
  };
}
