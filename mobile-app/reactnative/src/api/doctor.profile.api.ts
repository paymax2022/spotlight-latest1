// Section B: Doctor Profile & Verification flow (31 screens). Phase A style:
// every function resolves demo data so screens render without a live API.
// `DEMO_*` exports double as `placeholderData` in useQuery. ADDITIVE to
// `@/api/doctor.api` and `@/api/doctor.phase2.api` — those fns/exports are
// untouched.
// TODO(Phase C): replace each body with the live endpoint, e.g.
// uploads → presigned R2 PUT; mutations pass the Idempotency-Key header below.

import type {
  DoctorProfileDraft,
  VerificationStatus,
  ProfileDocumentSlot,
  UploadedFile,
  BankAccount,
  LicenceExpiryWarning,
  VerificationDecision,
  VerificationRejectionReason,
  SaveProfileDraftInput,
  SaveProfileDraftResult,
  UploadProfilePhotoInput,
  UploadDocumentInput,
  UploadResult,
  SaveBankAccountInput,
  SaveBankAccountResult,
  VerifyBankAccountInput,
  VerifyBankAccountResult,
  SubmitProfileVerificationInput,
  SubmitProfileVerificationResult,
  RenewLicenceInput,
  RenewLicenceResult,
  PublishProfileInput,
  PublishProfileResult,
} from '@/types/doctor.profile';

// Re-export the shared money formatter so Section B screens can import it here.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut, doctorUploadFile } from '@/api/doctor.client';
import { createSupabaseClient, getSupabaseConfigStatus } from '@/lib/supabase';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// The full set of document slots collected by the builder, keyed by doc type.
// Reuses the Phase 1 VerificationDocType values plus Section B additions.

export const DEMO_DOCUMENT_SLOTS: ProfileDocumentSlot[] = [
  { type: 'mdcn_certificate',      label: 'MDCN Certificate',                 required: true },
  { type: 'medical_license',       label: 'Medical License',                  required: true,
    file: { id: 'f-lic', uri: 'file:///demo/license.pdf', fileName: 'license.pdf', mimeType: 'application/pdf', uploadedAt: iso(1) } },
  { type: 'degree_certificate',    label: 'Degree Certificate (MBBS)',        required: true },
  { type: 'government_id',         label: 'Government ID (NIN)',              required: true,
    file: { id: 'f-nin', uri: 'file:///demo/nin.jpg', fileName: 'nin.jpg', mimeType: 'image/jpeg', uploadedAt: iso(1) } },
  { type: 'passport_photo',        label: 'Passport Photograph',             required: true },
  { type: 'certificate',           label: 'Additional Certificate',          required: false },
  { type: 'association_membership', label: 'Professional Association Membership', required: false },
  { type: 'cv',                    label: 'Curriculum Vitae',                 required: false },
];

export const DEMO_PROFILE_DRAFT: DoctorProfileDraft = {
  id: 'draft-1', doctorId: 'doc-1',
  personalInfo: {
    firstName: 'Amaka', lastName: 'Obi', title: 'Dr.', gender: 'female',
    dateOfBirth: '1986-04-12', email: 'amaka.obi@spotlight.ng', phone: '+234 803 123 4567',
    state: 'Lagos', city: 'Lagos', address: '12 Adeola Odeku St, Victoria Island',
  },
  photo: { id: 'f-photo', uri: 'file:///demo/photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', uploadedAt: iso(2) },
  bio: 'Family physician with over a decade of experience in primary care, chronic disease management and preventive health.',
  specialtyId: 'gp',
  subSpecialtyIds: ['Chronic Disease Management', 'Preventive Health'],
  yearsExperience: 12,
  languages: ['English', 'Igbo'],
  licence: {
    licenceNumber: 'MDCN/R/45821', issuingBody: 'MDCN',
    issuedAt: isoDate(-700), expiresAt: isoDate(45), status: 'expiring_soon',
    licenceFile: { id: 'f-lic', uri: 'file:///demo/license.pdf', fileName: 'license.pdf', mimeType: 'application/pdf', uploadedAt: iso(1) },
  },
  documents: DEMO_DOCUMENT_SLOTS,
  certificates: [
    { id: 'f-cert1', uri: 'file:///demo/fwacp.pdf', fileName: 'fwacp-fellowship.pdf', mimeType: 'application/pdf', uploadedAt: iso(3) },
  ],
  associationMembership: { id: 'f-assoc', uri: 'file:///demo/nma.pdf', fileName: 'nma-membership.pdf', mimeType: 'application/pdf', uploadedAt: iso(3) },
  affiliations: [
    { id: 'aff-1', name: 'Lagoon Medical Centre', role: 'Consultant Family Physician', state: 'Lagos', city: 'Lagos', isPrimary: true },
    { id: 'aff-2', name: 'Reddington Hospital', role: 'Visiting Physician', state: 'Lagos', city: 'Lagos', isPrimary: false },
  ],
  education: [
    { id: 'edu-1', institution: 'University of Lagos', degree: 'MBBS', field: 'Medicine & Surgery', startYear: 2004, endYear: 2010, isCurrent: false },
    { id: 'edu-2', institution: 'West African College of Physicians', degree: 'FWACP', field: 'Family Medicine', startYear: 2013, endYear: 2017, isCurrent: false },
  ],
  workExperience: [
    { id: 'work-1', organisation: 'Lagoon Medical Centre', role: 'Consultant Family Physician', location: 'Lagos, NG', startYear: 2018, isCurrent: true, description: 'Primary care, chronic disease clinics, supervision of resident doctors.' },
    { id: 'work-2', organisation: 'Lagos University Teaching Hospital', role: 'Senior Registrar', location: 'Lagos, NG', startYear: 2014, endYear: 2018, isCurrent: false },
  ],
  pricing: {
    videoFeeKobo: 350000, audioFeeKobo: 300000, chatFeeKobo: 200000,
    currency: 'NGN', acceptsInstant: true,
  },
  freeFollowUp: {
    enabled: true, windowDays: 7, maxFreeVisits: 1,
    note: 'One free follow-up within 7 days of a paid consultation.',
  },
  bankAccount: {
    bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789',
    accountName: 'AMAKA OBI', isVerified: true,
  },
  completedSteps: [
    'personal_info', 'profile_photo', 'bio', 'specialty', 'sub_specialty',
    'experience', 'languages', 'licence_number', 'licence_upload', 'government_id',
    'affiliations', 'education', 'work_experience', 'pricing', 'free_follow_up',
    'availability', 'bank_account',
  ],
  status: 'unsubmitted',
  updatedAt: iso(0),
  isPublished: false,
};

// ─── Demo data: licence expiry warning (screens 29, 30) ──────────────────────

export const DEMO_LICENCE_EXPIRY_WARNING: LicenceExpiryWarning = {
  licenceNumber: 'MDCN/R/45821',
  expiresAt: isoDate(45),
  daysToExpiry: 45,
  status: 'expiring_soon',
  message: 'Your MDCN licence expires in 45 days. Upload your renewed licence to avoid suspension.',
};

// reference the MDCN register or matched-field detail.
export const DEMO_REJECTION_REASONS: VerificationRejectionReason[] = [
  { code: 'doc_unclear',      label: 'Document image is blurry or unreadable', docType: 'government_id' },
  { code: 'licence_mismatch', label: 'We could not confirm your licence details', docType: 'medical_license' },
];

// PRIVACY: `reviewer` and `notes` are intentionally NOT surfaced on the doctor's
// verification screens (assisted Mode B). Kept here only as a coarse demo record.
export const DEMO_VERIFICATION_DECISION: VerificationDecision = {
  submissionId: 'ver-1', outcome: 'approved', decidedAt: iso(27),
};

// GET /profile/draft (internal/doctor Service/Repository.GetProfileDraft) wires
// straight to GetProfile, whose response is the flat doctor_profiles row — id,
// userId, providerType, name, bio, specialtyId, languages, ..., profileDraft,
// completedSteps, createdAt, updatedAt — not the DoctorProfileDraft shape this
// this was never reachable with real data: each screen's `save.mutateAsync({
// draft: {...} })` call sends the WHOLE SaveProfileDraftInput as the PUT body
// (doctorPut passes `input` straight through), so what actually lands in the
// `profile_draft` jsonb column is `{draft: {...that screen's patch...},
// idempotencyKey: "..."}` — the real fields the builder needs live one level
// deeper, at `profileDraft.draft`, not at the wire's top level or even at
// `profileDraft` directly.
// This unwraps that one level and fills in every required DoctorProfileDraft
// field DEMO_PROFILE_DRAFT already exercises, so a field a given user hasn't
// reached yet renders as empty rather than crashing the screen that reads it
// (`draft.personalInfo` etc. would otherwise be `undefined`, which is exactly
// true on the live path — the reported "We could not load your profile.").
// The write path is fixed server-side: SaveProfileDraft (doctor repository)
// now merges the nested `draft` object one level deep, so each step's patch
// accumulates instead of replacing every other step's saved data.
interface ProfileDraftWire {
  id:            string;
  userId:        string;
  verification:  VerificationStatus;
  isPublished:   boolean;
  updatedAt:     string;
  avatarUrl?:    string | null;
  email?:        string | null;
  phone?:        string | null;
  profileDraft?: { draft?: Partial<DoctorProfileDraft> } | null;
}

export async function getProfileDraft(draftId?: string): Promise<DoctorProfileDraft> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PROFILE_DRAFT);
  const wire = await doctorGet<ProfileDraftWire>('/profile/draft', { draftId });
  const saved = wire.profileDraft?.draft ?? {};
  // The builder renders email/phone read-only, so drafts made there store them
  // empty forever. Backfill from the doctor_profiles columns, then the auth
  // session, so the preview / published views show real contact info.
  const personalInfo = { ...(saved.personalInfo ?? { firstName: '', lastName: '', title: '', email: '', phone: '' }) };
  if (!personalInfo.email || !personalInfo.phone) {
    if (getSupabaseConfigStatus().hasConfig) {
      const { data: { session } } = await createSupabaseClient().auth.getSession();
      personalInfo.email = personalInfo.email || wire.email || session?.user?.email || '';
      personalInfo.phone = personalInfo.phone || wire.phone || session?.user?.phone || '';
    }
  }
  return {
    id: wire.id,
    doctorId: wire.userId,
    personalInfo,
    // The photo step records the R2 key in avatar_url; drafts saved before the
    // step persisted `photo` have no draft entry, so fall back to the column.
    photo: saved.photo ?? (wire.avatarUrl
      ? { id: wire.avatarUrl, uri: wire.avatarUrl, fileName: 'Profile photo', mimeType: 'image/jpeg', uploadedAt: wire.updatedAt }
      : undefined),
    bio: saved.bio ?? '',
    specialtyId: saved.specialtyId ?? '',
    subSpecialtyIds: saved.subSpecialtyIds ?? [],
    yearsExperience: saved.yearsExperience ?? 0,
    languages: saved.languages ?? [],
    licence: saved.licence ?? { licenceNumber: '', issuingBody: 'MDCN' },
    documents: saved.documents ?? [],
    certificates: saved.certificates ?? [],
    associationMembership: saved.associationMembership,
    affiliations: saved.affiliations ?? [],
    education: saved.education ?? [],
    workExperience: saved.workExperience ?? [],
    pricing: saved.pricing ?? { videoFeeKobo: 0, audioFeeKobo: 0, chatFeeKobo: 0, currency: 'NGN', acceptsInstant: false },
    freeFollowUp: saved.freeFollowUp ?? { enabled: false, windowDays: 0, maxFreeVisits: 0 },
    bankAccount: saved.bankAccount,
    completedSteps: saved.completedSteps ?? [],
    status: wire.verification,
    updatedAt: wire.updatedAt,
    isPublished: wire.isPublished,
  };
}

interface VerificationDocRow {
  id:         string;
  docType:    string;
  label?:     string;
  fileName?:  string;
  fileUrl?:   string;
  mimeType?:  string;
  sizeBytes?: number;
  required?:  boolean;
  uploadedAt?: string;
}

function docRowToFile(r: VerificationDocRow): UploadedFile {
  return {
    id: r.id, uri: r.fileUrl ?? '', fileName: r.fileName ?? r.docType,
    mimeType: r.mimeType, sizeBytes: r.sizeBytes, uploadedAt: r.uploadedAt ?? '',
  };
}

export async function getDocumentSlots(): Promise<ProfileDocumentSlot[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DOCUMENT_SLOTS);
  // Live GET /profile/documents returns doctor_verification_documents rows
  // ({docType, fileName, fileUrl, …}), not the slot registry shape — merge the
  // uploaded rows into the known slot list so screens can find their slot/file.
  const rows = await doctorGet<VerificationDocRow[]>('/profile/documents');
  const byType = new Map<string, VerificationDocRow>();
  for (const r of rows ?? []) byType.set(r.docType, r);
  const slots: ProfileDocumentSlot[] = DEMO_DOCUMENT_SLOTS.map(({ file: _f, ...s }) => {
    const row = byType.get(s.type);
    byType.delete(s.type);
    return { ...s, file: row ? docRowToFile(row) : undefined };
  });
  for (const row of byType.values()) {
    slots.push({ type: row.docType as ProfileDocumentSlot['type'], label: row.label ?? row.docType, required: row.required ?? false, file: docRowToFile(row) });
  }
  return slots;
}

// Nigerian geography from the Dojah-backed proxy endpoints. State/LGA pickers
// on the affiliations screen. On any error the caller falls back to the static
// state list / free-text city.
export async function getNigerianStates(): Promise<string[]> {
  if (DOCTOR_USE_MOCK) return wait<string[]>([], 300);
  const raw = await doctorGet<{ states?: string[] }>('/geo/states');
  return raw?.states ?? [];
}

export async function getLgasByState(state: string): Promise<string[]> {
  if (DOCTOR_USE_MOCK) return wait<string[]>([], 300);
  const raw = await doctorGet<{ lgas?: string[] }>('/geo/lgas', { state });
  return raw?.lgas ?? [];
}

export async function getLicenceExpiryWarning(): Promise<LicenceExpiryWarning | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LICENCE_EXPIRY_WARNING);
  return doctorGet<LicenceExpiryWarning | undefined>('/licence/expiry-warning');
}

export async function getVerificationDecision(submissionId?: string): Promise<VerificationDecision> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VERIFICATION_DECISION);
  return doctorGet<VerificationDecision>('/verification/decision', { submissionId });
}

export async function saveProfileDraft(input: SaveProfileDraftInput): Promise<SaveProfileDraftResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draft;
    return wait({ draftId: DEMO_PROFILE_DRAFT.id, status: 'unsubmitted', updatedAt: new Date().toISOString() }, 500);
  }
  return doctorPut<SaveProfileDraftResult>('/profile/draft', input, input.idempotencyKey);
}

// POST /profile/photo (internal/doctor Service.SetProfilePhoto) requires
// {photoUrl}, binding:"required" — the live branch used to post {uri,
// fileName, mimeType} straight through with no upload ever happening, so this
// 400'd on the missing field every time, on top of never reaching R2 at all.
// Now: presign, PUT the real binary, then record the resulting object key.
// SetProfilePhoto's response is the whole doctor_profiles row, not an
// UploadResult — the caller only needs confirmation the write succeeded, so
// the result is built from what's already known rather than parsed from a
// response shape this endpoint was never going to match.
export async function uploadProfilePhoto(input: UploadProfilePhotoInput): Promise<UploadResult> {
  if (DOCTOR_USE_MOCK) {
    const file: UploadedFile = {
      id: `f-${Date.now()}`, uri: input.uri, fileName: input.fileName,
      mimeType: input.mimeType, uploadedAt: new Date().toISOString(),
    };
    return wait({ file }, 600);
  }
  const mimeType = input.mimeType ?? 'image/jpeg';
  const objectKey = await doctorUploadFile('profile_photo', { ...input, mimeType });
  await doctorPost<unknown>('/profile/photo', { photoUrl: objectKey }, input.idempotencyKey);
  return {
    file: {
      id: objectKey, uri: input.uri, fileName: input.fileName,
      mimeType: input.mimeType, uploadedAt: new Date().toISOString(),
    },
  };
}

// POST /profile/documents (internal/doctor Service.UploadProfileDocument)
// requires `docType`, binding:"required", and stores `fileUrl` — the live
// branch sent `{type, uri, fileName, mimeType}`, so `docType` was always
// absent (400) and `fileUrl` never populated even had it not been. Same fix
// as uploadProfilePhoto: presign, PUT the real binary, record the object key
// under the field names the backend actually binds.
export async function uploadDocument(input: UploadDocumentInput): Promise<UploadResult> {
  if (DOCTOR_USE_MOCK) {
    void input.type;
    const file: UploadedFile = {
      id: `f-${Date.now()}`, uri: input.uri, fileName: input.fileName,
      mimeType: input.mimeType, uploadedAt: new Date().toISOString(),
    };
    return wait({ file }, 600);
  }
  const mimeType = input.mimeType ?? 'application/octet-stream';
  const objectKey = await doctorUploadFile('document', { ...input, mimeType });
  await doctorPost<unknown>('/profile/documents', {
    docType: input.type, fileUrl: objectKey, fileName: input.fileName, mimeType,
  }, input.idempotencyKey);
  return {
    file: {
      id: objectKey, uri: input.uri, fileName: input.fileName,
      mimeType: input.mimeType, uploadedAt: new Date().toISOString(),
    },
  };
}

export async function saveBankAccount(input: SaveBankAccountInput): Promise<SaveBankAccountResult> {
  if (DOCTOR_USE_MOCK) {
    const account: BankAccount = {
      bankName: input.bankName, bankCode: input.bankCode, accountNumber: input.accountNumber,
      accountName: 'AMAKA OBI', isVerified: true,
    };
    return wait({ account }, 600);
  }
  return doctorPost<SaveBankAccountResult>('/profile/bank-account', input, input.idempotencyKey);
}

/** POST /profile/bank-account/verify — name enquiry WITHOUT saving the account. */
export async function verifyBankAccount(input: VerifyBankAccountInput): Promise<VerifyBankAccountResult> {
  if (DOCTOR_USE_MOCK) {
    const res = await wait<{ account_name: string; account_number_masked: string }>(
      { account_name: 'AMAKA OBI', account_number_masked: `****${input.accountNumber.slice(-4)}` }, 600);
    return { accountName: res.account_name, accountNumberMasked: res.account_number_masked };
  }
  // The Go handler returns snake_case keys (map[string]any projection).
  const raw = await doctorPost<{ account_name?: string; account_number_masked?: string }>(
    '/profile/bank-account/verify', input);
  return {
    accountName: raw?.account_name ?? '',
    accountNumberMasked: raw?.account_number_masked ?? `****${input.accountNumber.slice(-4)}`,
  };
}

export async function submitProfileVerification(
  input: SubmitProfileVerificationInput,
): Promise<SubmitProfileVerificationResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draftId;
    return wait({ submissionId: `ver-${Date.now()}`, status: 'pending' }, 700);
  }
  return doctorPost<SubmitProfileVerificationResult>('/verification', input, input.idempotencyKey);
}

export async function renewLicence(input: RenewLicenceInput): Promise<RenewLicenceResult> {
  if (DOCTOR_USE_MOCK) {
    void input.newExpiresAt;
    return wait({ renewalId: `lr-${Date.now()}`, status: 'pending' }, 700);
  }
  return doctorPost<RenewLicenceResult>('/licence/renew', input, input.idempotencyKey);
}

export async function publishProfile(input: PublishProfileInput): Promise<PublishProfileResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draftId;
    return wait({ doctorId: 'doc-1', isPublished: true, publishedAt: new Date().toISOString() }, 600);
  }
  return doctorPost<PublishProfileResult>('/profile/publish', input, input.idempotencyKey);
}
