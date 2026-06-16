import { api } from '@/api/client';
import { createSupabaseClient } from '@/lib/supabase';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'failed' | 'suspended';
export type KycTier = 0 | 1 | 2 | 3;
export type KycDocumentType = 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';

export interface ProfileDetails {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  whatsapp?: string;
  dateOfBirth?: string;
  gender?: string;
  country?: string;
  state?: string;
  lga?: string;
  city?: string;
  address?: string;
}

export interface KycDetails {
  kycTier: KycTier;
  requestedTier: 1 | 2 | 3 | null;
  status: KycStatus;
  phoneVerified: boolean;
  submittedAt: string | null;
  verifiedAt: string | null;
  documentType: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function asRow(v: unknown): Row {
  return typeof v === 'object' && v !== null ? (v as Row) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function pick(row: Row, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const s = str(row[key]);
    if (s) return s;
  }
  return undefined;
}

// Maps a user_profiles DB row (snake_case) → ProfileDetails.
function profileFromRow(row: Row, authEmail?: string): ProfileDetails {
  const meta = asRow(row.metadata);
  return {
    id: String(row.id ?? ''),
    email: pick(row, 'email') ?? authEmail,
    firstName:   pick(row, 'first_name')    ?? pick(meta, 'firstName'),
    lastName:    pick(row, 'last_name')     ?? pick(meta, 'lastName'),
    displayName: pick(row, 'display_name', 'full_name') ?? pick(meta, 'displayName'),
    phone:       pick(row, 'phone', 'phone_number')     ?? pick(meta, 'phone'),
    whatsapp:    pick(row, 'whatsapp')      ?? pick(meta, 'whatsapp'),
    dateOfBirth: pick(row, 'date_of_birth', 'dob')      ?? pick(meta, 'dateOfBirth'),
    gender:      pick(row, 'gender')        ?? pick(meta, 'gender'),
    country:     pick(row, 'country')       ?? pick(meta, 'country'),
    state:       pick(row, 'state')         ?? pick(meta, 'state'),
    lga:         pick(row, 'lga')           ?? pick(meta, 'lga'),
    city:        pick(row, 'city')          ?? pick(meta, 'city'),
    address:     pick(row, 'address')       ?? pick(meta, 'address'),
  };
}

// Maps the KYC columns in user_profiles → KycDetails.
function kycFromRow(row: Row): KycDetails {
  return {
    kycTier:       Number(row.kyc_tier       ?? 0)          as KycTier,
    requestedTier: row.kyc_requested_tier == null
      ? null
      : Number(row.kyc_requested_tier) as 1 | 2 | 3,
    status:        String(row.kyc_status     ?? 'unverified') as KycStatus,
    phoneVerified: Boolean(row.phone_verified ?? false),
    submittedAt:   row.kyc_submitted_at  ? String(row.kyc_submitted_at)  : null,
    verifiedAt:    row.kyc_verified_at   ? String(row.kyc_verified_at)   : null,
    documentType:  row.document_type     ? String(row.document_type)     : null,
  };
}

// Maps a camelCase SpotlightUserProfile (returned by Next.js normalizeProfile) → ProfileDetails.
function profileFromApi(raw: Row): ProfileDetails {
  const meta = asRow(raw.metadata);
  return {
    id: String(raw.id ?? ''),
    email:       pick(raw, 'email'),
    firstName:   pick(raw, 'firstName')   ?? pick(meta, 'firstName'),
    lastName:    pick(raw, 'lastName')    ?? pick(meta, 'lastName'),
    displayName: pick(raw, 'displayName', 'displayname') ?? pick(meta, 'displayName'),
    phone:       pick(raw, 'phone')       ?? pick(meta, 'phone'),
    whatsapp:    pick(raw, 'whatsapp')    ?? pick(meta, 'whatsapp'),
    dateOfBirth: pick(raw, 'dateOfBirth') ?? pick(meta, 'dateOfBirth'),
    gender:      pick(raw, 'gender')      ?? pick(meta, 'gender'),
    country:     pick(raw, 'country')     ?? pick(meta, 'country'),
    state:       pick(raw, 'state')       ?? pick(meta, 'state'),
    lga:         pick(raw, 'lga')         ?? pick(meta, 'lga'),
    city:        pick(raw, 'city')        ?? pick(meta, 'city'),
    address:     pick(raw, 'address')     ?? pick(meta, 'address'),
  };
}

// ---------------------------------------------------------------------------
// Reads — Supabase direct (no Next.js dependency)
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<ProfileDetails> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, full_name, first_name, last_name, display_name, phone, whatsapp, date_of_birth, gender, country, state, lga, city, address, metadata')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  const row = asRow(data ?? {});
  if (!row.id) row.id = user.id;
  if (!row.email) row.email = user.email ?? undefined;
  return profileFromRow(row, user.email ?? undefined);
}

export async function getKyc(): Promise<KycDetails> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('user_profiles')
    .select('kyc_tier, kyc_requested_tier, kyc_status, phone_verified, kyc_submitted_at, kyc_verified_at, document_type')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  return kycFromRow(asRow(data));
}

// ---------------------------------------------------------------------------
// Mutations — Next.js API routes (server-side validation + business logic)
// ---------------------------------------------------------------------------

export async function updateProfile(payload: Partial<ProfileDetails>): Promise<ProfileDetails> {
  const res = await api.put('/api/me/profile', payload);
  const body = asRow(res.data);
  return profileFromApi(asRow(body.profile ?? body));
}

export async function submitKyc(payload: {
  requestedTier: 1 | 2 | 3;
  documentType: KycDocumentType;
  documentNumber: string;
  phone?: string;
}): Promise<KycDetails> {
  await api.post('/api/v1/kyc/initiate', {
    requested_tier:  payload.requestedTier,
    document_type:   payload.documentType,
    document_number: payload.documentNumber,
    phone:           payload.phone,
  });
  // Refetch the full KYC state from Supabase so the caller always gets
  // the complete picture (tier, documentType, timestamps, etc.).
  return getKyc();
}

export async function claimTier0(): Promise<KycDetails> {
  await api.post('/api/v1/kyc/tier0', {});
  return getKyc();
}
