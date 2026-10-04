import { createAdminClient } from '@/lib/supabase/server';
import type { RequestUser } from '@/src/lib/auth/request';

export type SpotlightProfileType =
  | 'artist'
  | 'student'
  | 'school_representative'
  | 'sme_founder'
  | 'football_talent'
  | 'actor'
  | 'content_creator'
  | 'parent_guardian'
  | 'general_applicant';

export type SpotlightUserProfile = {
  id: string;
  email?: string;
  role: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  gender?: string;
  dateOfBirth?: string;
  phone?: string;
  whatsapp?: string;
  country?: string;
  state?: string;
  lga?: string;
  city?: string;
  address?: string;
  profilePhotoUrl?: string;
  bio?: string;
  preferredCategory?: string;
  profileTypes: SpotlightProfileType[];
  social?: Record<string, string>;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  consentAccepted?: boolean;
  identity?: Record<string, unknown>;
  specialistProfiles?: Record<string, Record<string, unknown>>;
  raw?: Record<string, unknown>;
};

export const PROFILE_TYPE_OPTIONS: Array<{ value: SpotlightProfileType; label: string }> = [
  { value: 'artist', label: 'Artist' },
  { value: 'student', label: 'Student' },
  { value: 'school_representative', label: 'School Representative' },
  { value: 'sme_founder', label: 'SME Founder' },
  { value: 'football_talent', label: 'Football Talent' },
  { value: 'actor', label: 'Actor' },
  { value: 'content_creator', label: 'Content Creator' },
  { value: 'parent_guardian', label: 'Parent/Guardian' },
  { value: 'general_applicant', label: 'General Applicant' },
];

const BASIC_REQUIRED_FIELDS: Array<keyof SpotlightUserProfile> = [
  'firstName',
  'lastName',
  'displayName',
  'gender',
  'dateOfBirth',
  'email',
  'phone',
  'whatsapp',
  'country',
  'state',
  'lga',
  'city',
  'address',
  'profilePhotoUrl',
  'bio',
  'preferredCategory',
  'emergencyContactName',
  'emergencyContactPhone',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getBool(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function normalizeProfile(row: Record<string, unknown> | null, user: RequestUser): SpotlightUserProfile {
  const raw = row || {};
  const metadata = asRecord(raw.metadata);
  const social = asRecord(raw.social);
  const identity = asRecord(raw.identity);
  const specialistProfiles = asRecord(raw.specialist_profiles) as Record<string, Record<string, unknown>>;
  const profileTypesRaw = raw.profile_types || metadata.profileTypes || raw.profileTypes;
  const profileTypes = Array.isArray(profileTypesRaw)
    ? profileTypesRaw.filter((item): item is SpotlightProfileType => typeof item === 'string') as SpotlightProfileType[]
    : [];

  return {
    id: user.id,
    email: getString(raw, ['email']) || user.email,
    role: getString(raw, ['role']) || 'USER',
    firstName: getString(raw, ['first_name', 'firstName']) || getString(metadata, ['firstName']),
    lastName: getString(raw, ['last_name', 'lastName']) || getString(metadata, ['lastName']),
    displayName: getString(raw, ['display_name', 'displayName', 'full_name', 'name']) || getString(metadata, ['displayName']),
    gender: getString(raw, ['gender']) || getString(metadata, ['gender']),
    dateOfBirth: getString(raw, ['date_of_birth', 'dateOfBirth', 'dob']) || getString(metadata, ['dateOfBirth']),
    phone: getString(raw, ['phone', 'phone_number']) || getString(metadata, ['phone']),
    whatsapp: getString(raw, ['whatsapp', 'whatsapp_number']) || getString(metadata, ['whatsapp']),
    country: getString(raw, ['country']) || getString(metadata, ['country']),
    state: getString(raw, ['state']) || getString(metadata, ['state']),
    lga: getString(raw, ['lga', 'local_government_area']) || getString(metadata, ['lga']),
    city: getString(raw, ['city']) || getString(metadata, ['city']),
    address: getString(raw, ['address']) || getString(metadata, ['address']),
    profilePhotoUrl: getString(raw, ['profile_photo_url', 'avatar_url', 'profilePhotoUrl']) || getString(metadata, ['profilePhotoUrl']),
    bio: getString(raw, ['bio', 'about_me']) || getString(metadata, ['bio']),
    preferredCategory: getString(raw, ['preferred_category', 'preferredCategory']) || getString(metadata, ['preferredCategory']),
    profileTypes: profileTypes.length ? profileTypes : ['general_applicant'],
    social: Object.keys(social).length ? social as Record<string, string> : asRecord(metadata.social) as Record<string, string>,
    emergencyContactName: getString(raw, ['emergency_contact_name']) || getString(metadata, ['emergencyContactName']),
    emergencyContactPhone: getString(raw, ['emergency_contact_phone']) || getString(metadata, ['emergencyContactPhone']),
    consentAccepted: getBool(raw, ['consent_accepted']) ?? getBool(metadata, ['consentAccepted']),
    identity,
    specialistProfiles,
    raw,
  };
}

export function calculateProfileCompletion(profile: SpotlightUserProfile) {
  const missingRequired = BASIC_REQUIRED_FIELDS.filter((field) => {
    const value = profile[field];
    return value === undefined || value === null || String(value).trim() === '';
  }).map((field) => String(field));

  if (!profile.consentAccepted) missingRequired.push('consentAccepted');
  if (!profile.profileTypes.length) missingRequired.push('profileTypes');

  const requiredCount = BASIC_REQUIRED_FIELDS.length + 2;
  const completedCount = Math.max(0, requiredCount - missingRequired.length);
  const percentage = Math.round((completedCount / requiredCount) * 100);

  return {
    percentage,
    missingRequired,
    missingRecommended: ['instagram', 'tiktok', 'youtube'].filter((key) => !profile.social?.[key]),
    verificationStatus: profile.identity && Object.keys(profile.identity).length ? 'pending_review' : 'not_started',
    eligibilityStatus: percentage >= 70 ? 'eligible_for_basic_applications' : 'profile_incomplete',
  };
}

export async function getOrCreateUserProfile(user: RequestUser) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (data) return normalizeProfile(data as Record<string, unknown>, user);

  const baseRows: Array<Record<string, unknown>> = [
    { id: user.id, email: user.email || null, role: 'USER' },
    { id: user.id, email: null, role: 'USER' },
  ];

  for (const row of baseRows) {
    const { data: created, error: createError } = await supabase.from('user_profiles').insert(row as any).select('*').maybeSingle();
    if (!createError) return normalizeProfile((created as Record<string, unknown>) || row, user);
  }

  return normalizeProfile({ id: user.id, email: user.email, role: 'USER' }, user);
}

// E2E-SEC-053: the ONLY fields a user may write on their own profile. The
// handler used to accept the raw request body as a patch, so
// PUT /api/me/profile {"role":"admin"} persisted user_profiles.role — which
// assertAdminPermission then trusted, self-granting super_admin on every BFF
// admin route. Anything not listed here (role, is_admin, kyc_tier, kyc_status,
// status, verified, permissions, roles, or any other privileged/unknown key)
// is dropped before it can reach the upsert. Keep this list in sync with the
// `optional`/metadata column maps below.
const USER_WRITABLE_PROFILE_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'displayName',
  'gender',
  'dateOfBirth',
  'phone',
  'whatsapp',
  'country',
  'state',
  'lga',
  'city',
  'address',
  'profilePhotoUrl',
  'bio',
  'preferredCategory',
  'profileTypes',
  'social',
  'emergencyContactName',
  'emergencyContactPhone',
  'consentAccepted',
  'identity',
  'specialistProfiles',
] as const;

export type UserWritableProfilePatch = Partial<
  Pick<SpotlightUserProfile, (typeof USER_WRITABLE_PROFILE_FIELDS)[number]>
>;

// sanitizeProfilePatch drops every non-allowlisted key from a user-supplied
// profile patch. It exists so NO caller of updateUserProfile can smuggle a
// privileged column (role et al.) through, whatever shape the request body
// arrived in.
export function sanitizeProfilePatch(input: unknown): UserWritableProfilePatch {
  const raw = asRecord(input);
  const patch: Record<string, unknown> = {};
  for (const field of USER_WRITABLE_PROFILE_FIELDS) {
    if (field in raw) patch[field] = raw[field];
  }
  return patch as UserWritableProfilePatch;
}

export async function updateUserProfile(user: RequestUser, patch: Partial<SpotlightUserProfile> | unknown) {
  const supabase = createAdminClient();
  // Allowlist the writable field set — see USER_WRITABLE_PROFILE_FIELDS.
  const safe = sanitizeProfilePatch(patch);

  // The role column is server-managed and must never come from the patch.
  // Preserve whatever the row already holds on update; 'USER' only seeds a
  // first-time insert. (Writing 'USER' unconditionally would also have
  // clobbered a legitimately-set role on every profile edit.)
  const { data: existingRow } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const persistedRole =
    getString(asRecord(existingRow as Record<string, unknown> | null), ['role']) || 'USER';

  const metadata = {
    firstName: safe.firstName,
    lastName: safe.lastName,
    displayName: safe.displayName,
    gender: safe.gender,
    dateOfBirth: safe.dateOfBirth,
    phone: safe.phone,
    whatsapp: safe.whatsapp,
    country: safe.country,
    state: safe.state,
    lga: safe.lga,
    city: safe.city,
    address: safe.address,
    profilePhotoUrl: safe.profilePhotoUrl,
    bio: safe.bio,
    preferredCategory: safe.preferredCategory,
    profileTypes: safe.profileTypes,
    social: safe.social,
    emergencyContactName: safe.emergencyContactName,
    emergencyContactPhone: safe.emergencyContactPhone,
    consentAccepted: safe.consentAccepted,
  };
  const fullName = [safe.firstName, safe.lastName].filter(Boolean).join(' ').trim() || safe.displayName;

  // A PATCH must only carry the fields it was actually given.
  // This payload used to spell out every column with `patch.x || null`, which
  // broke updates twice over:
  //   1. full_name is NOT NULL. `PUT /api/me/profile {"phone":"…"}` carries no
  //      name, so full_name became null, the upsert failed 23502, and the
  //      fallback below quietly persisted only id/email/role — a 200 response
  //      that saved nothing. That is why a user could never add a phone number,
  //      and why marketplace's seller-phone reveal had almost nobody to reveal.
  //   2. Had it succeeded it would have been destructive: sending only a phone
  //      also nulled first_name, city, address and everything else the caller
  //      never mentioned.
  // Omitting undefined keys fixes both — an absent field is left exactly as it
  // is, and a NOT NULL column is never handed a null it did not ask for.
  const optional: Record<string, unknown> = {
    full_name: fullName || undefined,
    first_name: safe.firstName,
    last_name: safe.lastName,
    display_name: safe.displayName || fullName || undefined,
    phone: safe.phone,
    date_of_birth: safe.dateOfBirth,
    gender: safe.gender,
    country: safe.country,
    state: safe.state,
    lga: safe.lga,
    city: safe.city,
    address: safe.address,
    social: safe.social,
    identity: safe.identity,
    specialist_profiles: safe.specialistProfiles,
    profile_types: safe.profileTypes,
  };

  const widePayload: Record<string, unknown> = {
    // it has to be present for the insert half of the upsert.
    id: user.id,
    email: safe.email || user.email || null,
    role: persistedRole,
    metadata,
    updated_at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) widePayload[key] = value;
  }

  const narrowPayload = {
    id: user.id,
    email: safe.email || user.email || null,
    role: persistedRole,
  };

  const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: 'full', payload: widePayload },
    { label: 'minimal', payload: narrowPayload },
  ];
  let lastError: unknown = null;
  for (const { label, payload } of attempts) {
    const { data, error } = await supabase.from('user_profiles').upsert(payload as any).select('*').maybeSingle();
    if (!error) {
      if (label === 'minimal') {
        // The full write failed (almost always a user_profiles column that the app
        // expects but the schema lacks) and we fell back to persisting only
        // id/email/role — the user's edited details were DROPPED. Log loudly so this
        // schema drift is caught instead of silently returning a "successful" update
        // that saved nothing. (Fix: add the missing columns via an additive migration.)
        console.error('[profile] updateUserProfile: full upsert failed, fell back to the minimal payload — user details were NOT persisted. Wide-upsert error:', lastError);
      }
      return normalizeProfile((data as Record<string, unknown>) || payload, user);
    }
    lastError = error;
    console.error(`[profile] updateUserProfile: "${label}" upsert failed:`, error);
  }

  // Every attempt failed — do not claim success; the caller gets the unchanged profile.
  console.error('[profile] updateUserProfile: all upsert attempts failed; profile left unchanged. Last error:', lastError);
  return getOrCreateUserProfile(user);
}
