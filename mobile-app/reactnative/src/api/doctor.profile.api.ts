// ── Doctor (Telemedicine, provider-side) — Section B API client ──────────────
// Section B: Doctor Profile & Verification flow (31 screens). Phase A style:
// every function resolves demo data so screens render without a live API.
// `DEMO_*` exports double as `placeholderData` in useQuery. ADDITIVE to
// `@/api/doctor.api` and `@/api/doctor.phase2.api` — those fns/exports are
// untouched.
//
// TODO(Phase C): replace each body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/profile/draft'); return res.data.data;
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
  SaveTaxInfoInput,
  SaveTaxInfoResult,
  SubmitProfileVerificationInput,
  SubmitProfileVerificationResult,
  RenewLicenceInput,
  RenewLicenceResult,
  PublishProfileInput,
  PublishProfileResult,
} from '@/types/doctor.profile';

// Re-export the shared money formatter so Section B screens can import it here.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// ─── Demo data: document slots ───────────────────────────────────────────────
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

// ─── Demo data: the in-progress profile draft ────────────────────────────────

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
  taxInfo: {
    hasTin: true, tin: '1234567-0001', vatRegistered: false, businessName: 'Dr. Amaka Obi Family Practice',
  },
  completedSteps: [
    'personal_info', 'profile_photo', 'bio', 'specialty', 'sub_specialty',
    'experience', 'languages', 'licence_number', 'licence_upload', 'government_id',
    'affiliations', 'education', 'work_experience', 'pricing', 'free_follow_up',
    'availability', 'bank_account', 'tax_info',
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

// ─── Demo data: verification decision (screens 26, 27, 28) ───────────────────

// PRIVACY: reason labels are shown to the doctor — keep them coarse and never
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

// ─── Read endpoints ──────────────────────────────────────────────────────────

// GET /profile/draft (internal/doctor Service/Repository.GetProfileDraft) wires
// straight to GetProfile, whose response is the flat doctor_profiles row — id,
// userId, providerType, name, bio, specialtyId, languages, ..., profileDraft,
// completedSteps, createdAt, updatedAt — not the DoctorProfileDraft shape this
// function promises (personalInfo, licence, pricing, freeFollowUp, ...). Every
// one of Section B's screens writes and reads through this same function, so
// this was never reachable with real data: each screen's `save.mutateAsync({
// draft: {...} })` call sends the WHOLE SaveProfileDraftInput as the PUT body
// (doctorPut passes `input` straight through), so what actually lands in the
// `profile_draft` jsonb column is `{draft: {...that screen's patch...},
// idempotencyKey: "..."}` — the real fields the builder needs live one level
// deeper, at `profileDraft.draft`, not at the wire's top level or even at
// `profileDraft` directly.
//
// This unwraps that one level and fills in every required DoctorProfileDraft
// field DEMO_PROFILE_DRAFT already exercises, so a field a given user hasn't
// reached yet renders as empty rather than crashing the screen that reads it
// (`draft.personalInfo` etc. would otherwise be `undefined`, which is exactly
// what made personal.tsx's `if (isError || !draft || !form)` guard permanently
// true on the live path — the reported "We could not load your profile.").
//
// NOT fixed here, and out of scope for that crash: because `profileDraft.draft`
// is replaced wholesale on every save (jsonb `||` merges top-level keys only,
// and every screen's patch is nested one level under the same `draft` key),
// each step's save currently overwrites every OTHER step's already-saved data
// — a real, separate data-loss defect in the write path, not a shape mismatch.
// Reading it back accurately here does not fix that; it surfaces it (a
// returning user will see only whichever screen they saved last).
interface ProfileDraftWire {
  id:            string;
  userId:        string;
  verification:  VerificationStatus;
  isPublished:   boolean;
  updatedAt:     string;
  profileDraft?: { draft?: Partial<DoctorProfileDraft> } | null;
}

export async function getProfileDraft(draftId?: string): Promise<DoctorProfileDraft> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PROFILE_DRAFT);
  const wire = await doctorGet<ProfileDraftWire>('/profile/draft', { draftId });
  const saved = wire.profileDraft?.draft ?? {};
  return {
    id: wire.id,
    doctorId: wire.userId,
    personalInfo: saved.personalInfo ?? { firstName: '', lastName: '', title: '', email: '', phone: '' },
    photo: saved.photo,
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
    taxInfo: saved.taxInfo,
    completedSteps: saved.completedSteps ?? [],
    status: wire.verification,
    updatedAt: wire.updatedAt,
    isPublished: wire.isPublished,
  };
}

export async function getDocumentSlots(): Promise<ProfileDocumentSlot[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DOCUMENT_SLOTS);
  return doctorGet<ProfileDocumentSlot[]>('/profile/documents');
}

export async function getLicenceExpiryWarning(): Promise<LicenceExpiryWarning | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LICENCE_EXPIRY_WARNING);
  return doctorGet<LicenceExpiryWarning | undefined>('/licence/expiry-warning');
}

export async function getVerificationDecision(submissionId?: string): Promise<VerificationDecision> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VERIFICATION_DECISION);
  return doctorGet<VerificationDecision>('/verification/decision', { submissionId });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function saveProfileDraft(input: SaveProfileDraftInput): Promise<SaveProfileDraftResult> {
  if (DOCTOR_USE_MOCK) {
    void input.draft;
    return wait({ draftId: DEMO_PROFILE_DRAFT.id, status: 'unsubmitted', updatedAt: new Date().toISOString() }, 500);
  }
  return doctorPut<SaveProfileDraftResult>('/profile/draft', input, input.idempotencyKey);
}

export async function uploadProfilePhoto(input: UploadProfilePhotoInput): Promise<UploadResult> {
  if (DOCTOR_USE_MOCK) {
    const file: UploadedFile = {
      id: `f-${Date.now()}`, uri: input.uri, fileName: input.fileName,
      mimeType: input.mimeType, uploadedAt: new Date().toISOString(),
    };
    return wait({ file }, 600);
  }
  // Live: backend presigns R2 + records the metadata. See DOCTOR_GO_LIVE.md.
  return doctorPost<UploadResult>('/profile/photo', input, input.idempotencyKey);
}

export async function uploadDocument(input: UploadDocumentInput): Promise<UploadResult> {
  if (DOCTOR_USE_MOCK) {
    void input.type;
    const file: UploadedFile = {
      id: `f-${Date.now()}`, uri: input.uri, fileName: input.fileName,
      mimeType: input.mimeType, uploadedAt: new Date().toISOString(),
    };
    return wait({ file }, 600);
  }
  // Live: backend presigns R2 + records the metadata. See DOCTOR_GO_LIVE.md.
  return doctorPost<UploadResult>('/profile/documents', input, input.idempotencyKey);
}

export async function saveBankAccount(input: SaveBankAccountInput): Promise<SaveBankAccountResult> {
  if (DOCTOR_USE_MOCK) {
    const account: BankAccount = {
      bankName: input.bankName, bankCode: input.bankCode, accountNumber: input.accountNumber,
      accountName: 'AMAKA OBI', isVerified: true, // demo: name enquiry "resolves"
    };
    return wait({ account }, 600);
  }
  return doctorPost<SaveBankAccountResult>('/profile/bank-account', input, input.idempotencyKey);
}

export async function saveTaxInfo(input: SaveTaxInfoInput): Promise<SaveTaxInfoResult> {
  if (DOCTOR_USE_MOCK) return wait({ taxInfo: input.taxInfo }, 500);
  return doctorPut<SaveTaxInfoResult>('/profile/tax-info', input, input.idempotencyKey);
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
