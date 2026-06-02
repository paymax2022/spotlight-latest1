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

export async function updateUserProfile(user: RequestUser, patch: Partial<SpotlightUserProfile>) {
  const supabase = createAdminClient();
  const metadata = {
    firstName: patch.firstName,
    lastName: patch.lastName,
    displayName: patch.displayName,
    gender: patch.gender,
    dateOfBirth: patch.dateOfBirth,
    phone: patch.phone,
    whatsapp: patch.whatsapp,
    country: patch.country,
    state: patch.state,
    lga: patch.lga,
    city: patch.city,
    address: patch.address,
    profilePhotoUrl: patch.profilePhotoUrl,
    bio: patch.bio,
    preferredCategory: patch.preferredCategory,
    profileTypes: patch.profileTypes,
    social: patch.social,
    emergencyContactName: patch.emergencyContactName,
    emergencyContactPhone: patch.emergencyContactPhone,
    consentAccepted: patch.consentAccepted,
  };
  const fullName = [patch.firstName, patch.lastName].filter(Boolean).join(' ').trim() || patch.displayName;

  const widePayload = {
    id: user.id,
    email: patch.email || user.email || null,
    role: patch.role || 'USER',
    full_name: fullName || null,
    first_name: patch.firstName || null,
    last_name: patch.lastName || null,
    display_name: patch.displayName || fullName || null,
    phone: patch.phone || null,
    metadata,
    social: patch.social || {},
    identity: patch.identity || {},
    specialist_profiles: patch.specialistProfiles || {},
    profile_types: patch.profileTypes || ['general_applicant'],
    updated_at: new Date().toISOString(),
  };

  const narrowPayload = {
    id: user.id,
    email: patch.email || user.email || null,
    role: patch.role || 'USER',
  };

  const attempts = [widePayload, narrowPayload];
  for (const payload of attempts) {
    const { data, error } = await supabase.from('user_profiles').upsert(payload as any).select('*').maybeSingle();
    if (!error) return normalizeProfile((data as Record<string, unknown>) || payload, user);
  }

  return getOrCreateUserProfile(user);
}
