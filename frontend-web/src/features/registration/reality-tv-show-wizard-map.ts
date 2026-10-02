// Field map for the bespoke RealityTvShowApplicationWizard
// (components/forms/RealityTvShowApplicationWizard.tsx).
//
// AUD-FE-009: the wizard collects a DIFFERENT shape than the server-side
// schema in `forms/reality-tv-show.ts` — five UI steps vs four schema steps
// (contest_selection / personal_information / category_specific /
// review_submit), snake_case UI keys vs dotted flat keys. This module is the
// single place that mapping lives, kept pure (no React, no fetch) so it can
// be unit-tested against the REAL schema validator: `validateStepData` is
// imported here and `realityTvWizardSchemaErrors` runs it over the exact flat
// payload the wizard PATCHes, which is the same function submitRegistration
// re-runs server-side.
import { deriveAge, validateStepData } from './validation';
import { buildRealityTvShowSteps } from './forms/reality-tv-show';
import type { RegistrationDraft, RegistrationStepKey } from './types';

export interface RealityTvWizardForm {
  // Wizard step 1 — About You
  personal_firstName: string;
  personal_middleName: string;
  personal_lastName: string;
  personal_stageName: string;
  personal_dateOfBirth: string;
  personal_gender: string;
  personal_nationality: string;
  personal_stateOfOrigin: string;
  personal_stateOfResidence: string;
  personal_city: string;
  personal_primaryPhone: string;
  personal_whatsapp: string;
  personal_address: string;
  // File held only for the instant preview — the PERSISTED value is the
  // upload's previewUrl (media_profilePhotoUrl), written to
  // 'media.profilePhoto'. A File object cannot cross the PATCH JSON body.
  media_profilePhoto: File | null;
  media_profilePhotoPreview: string;
  media_profilePhotoUrl: string;
  media_profilePhotoName: string;
  contest_entryMode: string;
  // Guardian consent — required by the schema whenever derived.age < 18.
  guardian_fullName: string;
  guardian_relationship: string;
  guardian_phone: string;
  guardian_email: string;
  guardian_address: string;
  guardian_digitalSignature: string;
  guardian_consentGranted: boolean;
  guardian_idUploadUrl: string;
  guardian_idUploadName: string;

  // Wizard step 2 — Your Talent
  talent_primarySkill: string[];
  talent_experienceYears: string; // emitted as a NUMBER by formToFlat
  talent_skillLevel: string;
  talent_previousCompetitions: string;
  talent_strengths: string;
  talent_careerGoal: string;
  talent_uniqueStory: string;

  // Wizard step 3 — Show Profile (identity, media, socials, audition, public profile)
  category_uniqueStory: string;
  identity_idType: string;
  identity_idNumber: string;
  identity_idUploadUrl: string;
  identity_idUploadName: string;
  media_introVideoUrl: string;
  media_introVideoName: string;
  social_instagram: string;
  social_tiktok: string;
  social_youtube: string;
  social_x: string;
  social_totalFollowers: string; // emitted as a NUMBER by formToFlat
  social_willingToInviteVoting: boolean;
  media_performanceLink: string; // persisted as schema key 'audition.onlineLink'
  media_rightsConfirmed: boolean;
  audition_format: string;
  publicProfile_talentSummary: string;
  publicProfile_publicVotingConsent: boolean;

  // Wizard step 4 — Readiness (bootcamp, medical, emergency, compliance)
  bootcamp_availableFullPeriod: string;
  bootcamp_canTravel: boolean;
  bootcamp_travelRestrictions: string;
  bootcamp_comfortPublicVoting: boolean;
  category_housemateReadiness: boolean;
  category_dailyFilmingConsent: boolean;
  bootcamp_personalConsiderations: string;
  medical_generalHealthStatus: string[];
  medical_knownConditions: string[];
  medical_allergies: string[];
  medical_currentMedication: string;
  medical_dietaryRestrictions: string;
  medical_emergencyTreatmentConsent: boolean;
  emergency_fullName: string;
  emergency_relationship: string;
  emergency_phone: string;
  emergency_altPhone: string;
  emergency_state: string;
  emergency_city: string;
  compliance_previouslyInRealityShow: boolean;
  compliance_exclusiveContract: boolean;
  compliance_legalRestriction: boolean;
  compliance_codeOfConductAgreement: boolean;
  compliance_backgroundCheckAgreement: boolean;
  compliance_truthDeclaration: boolean;

  // Wizard step 5 — Legal & Submit
  legal_accuracyDeclaration: boolean;
  legal_termsConsent: boolean;
  legal_privacyConsent: boolean;
  legal_mediaRelease: boolean;
  legal_publicVotingConsent: boolean;
  legal_sponsorActivationConsent: boolean;
  legal_productionRulesConsent: boolean;
  legal_disqualificationAcknowledgment: boolean;
  legal_ageGuardianConfirmation: boolean;
  legal_communicationConsent: boolean;
  review_confirmSubmit: boolean;
}

export const REALITY_TV_WIZARD_INITIAL: RealityTvWizardForm = {
  personal_firstName: '', personal_middleName: '', personal_lastName: '',
  personal_stageName: '', personal_dateOfBirth: '', personal_gender: '',
  personal_nationality: 'Nigerian', personal_stateOfOrigin: '',
  personal_stateOfResidence: '', personal_city: '', personal_primaryPhone: '',
  personal_whatsapp: '', personal_address: '', contest_entryMode: 'Individual',
  media_profilePhoto: null, media_profilePhotoPreview: '',
  media_profilePhotoUrl: '', media_profilePhotoName: '',
  guardian_fullName: '', guardian_relationship: '', guardian_phone: '',
  guardian_email: '', guardian_address: '', guardian_digitalSignature: '',
  guardian_consentGranted: false,
  guardian_idUploadUrl: '', guardian_idUploadName: '',

  talent_primarySkill: [], talent_experienceYears: '', talent_skillLevel: '',
  talent_previousCompetitions: '', talent_strengths: '', talent_careerGoal: '',
  talent_uniqueStory: '',

  category_uniqueStory: '', identity_idType: '', identity_idNumber: '',
  identity_idUploadUrl: '', identity_idUploadName: '',
  media_introVideoUrl: '', media_introVideoName: '',
  social_instagram: '', social_tiktok: '', social_youtube: '', social_x: '',
  social_totalFollowers: '', social_willingToInviteVoting: false,
  media_performanceLink: '', media_rightsConfirmed: false,
  audition_format: '', publicProfile_talentSummary: '',
  publicProfile_publicVotingConsent: false,

  bootcamp_availableFullPeriod: '', bootcamp_canTravel: false,
  bootcamp_travelRestrictions: '', bootcamp_comfortPublicVoting: false,
  category_housemateReadiness: false, category_dailyFilmingConsent: false,
  bootcamp_personalConsiderations: '',
  medical_generalHealthStatus: [], medical_knownConditions: [],
  medical_allergies: [], medical_currentMedication: '',
  medical_dietaryRestrictions: '', medical_emergencyTreatmentConsent: false,
  emergency_fullName: '', emergency_relationship: '', emergency_phone: '',
  emergency_altPhone: '', emergency_state: '', emergency_city: '',
  compliance_previouslyInRealityShow: false, compliance_exclusiveContract: false,
  compliance_legalRestriction: false, compliance_codeOfConductAgreement: false,
  compliance_backgroundCheckAgreement: false, compliance_truthDeclaration: false,

  legal_accuracyDeclaration: false, legal_termsConsent: false,
  legal_privacyConsent: false, legal_mediaRelease: false,
  legal_publicVotingConsent: false, legal_sponsorActivationConsent: false,
  legal_productionRulesConsent: false, legal_disqualificationAcknowledgment: false,
  legal_ageGuardianConfirmation: false, legal_communicationConsent: false,
  review_confirmSubmit: false,
};

// Upload slots the wizard offers, keyed by the FLAT (schema) field key. The
// stored value is the upload's previewUrl; `<key>.__meta` carries the upload
// payload (fileName, storageKey, …) so names/sizes survive a reload — the
// same convention ContestRegistrationWizard uses.
export const REALITY_TV_UPLOAD_FIELDS = [
  'media.profilePhoto',
  'media.introVideo',
  'identity.idUpload',
  'guardian.idUpload',
] as const;

export type RealityTvUploadMeta = Record<string, Record<string, unknown>>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function bool(value: unknown): boolean {
  return value === true;
}

function metaFileName(saved: Record<string, unknown>, flatKey: string): string {
  const meta = saved[`${flatKey}.__meta`];
  if (!meta || typeof meta !== 'object') return '';
  return str((meta as Record<string, unknown>).fileName);
}

/**
 * Wizard form -> flat draft formData. Emit numbers where the schema declares
 * `type: 'number'` (experienceYears especially — the old select produced
 * '5+ years', which the server-side NaN check rejected). Uploads emit the
 * persisted previewUrl; accompanying `__meta` is merged from uploadMeta.
 */
export function realityTvWizardFormToFlat(
  f: RealityTvWizardForm,
  uploadMeta: RealityTvUploadMeta = {},
): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    'contest.entryMode': f.contest_entryMode,

    'personal.firstName': f.personal_firstName,
    'personal.middleName': f.personal_middleName,
    'personal.lastName': f.personal_lastName,
    'personal.stageName': f.personal_stageName,
    'personal.dateOfBirth': f.personal_dateOfBirth,
    'personal.gender': f.personal_gender,
    'personal.nationality': f.personal_nationality || 'Nigerian',
    'personal.stateOfOrigin': f.personal_stateOfOrigin,
    'personal.stateOfResidence': f.personal_stateOfResidence,
    'personal.city': f.personal_city,
    'personal.primaryPhone': f.personal_primaryPhone,
    'personal.whatsapp': f.personal_whatsapp,
    'personal.address': f.personal_address,

    'guardian.fullName': f.guardian_fullName,
    'guardian.relationship': f.guardian_relationship,
    'guardian.phone': f.guardian_phone,
    'guardian.email': f.guardian_email,
    'guardian.address': f.guardian_address,
    'guardian.digitalSignature': f.guardian_digitalSignature,
    'guardian.consentGranted': f.guardian_consentGranted,
    'guardian.idUpload': f.guardian_idUploadUrl,

    'talent.primarySkill': f.talent_primarySkill,
    'talent.experienceYears': f.talent_experienceYears === '' ? '' : Number(f.talent_experienceYears),
    'talent.skillLevel': f.talent_skillLevel,
    'talent.previousCompetitions': f.talent_previousCompetitions,
    'talent.strengths': f.talent_strengths,
    'talent.careerGoal': f.talent_careerGoal,
    'talent.uniqueStory': f.talent_uniqueStory,

    'identity.idType': f.identity_idType,
    'identity.idNumber': f.identity_idNumber,
    'identity.idUpload': f.identity_idUploadUrl,

    'media.profilePhoto': f.media_profilePhotoUrl,
    'media.introVideo': f.media_introVideoUrl,
    'media.rightsConfirmed': f.media_rightsConfirmed,

    'category.uniqueStory': f.category_uniqueStory,
    'category.housemateReadiness': f.category_housemateReadiness,
    'category.dailyFilmingConsent': f.category_dailyFilmingConsent,

    'social.instagram': f.social_instagram,
    'social.tiktok': f.social_tiktok,
    'social.youtube': f.social_youtube,
    'social.x': f.social_x,
    'social.totalFollowers': f.social_totalFollowers === '' ? '' : Number(f.social_totalFollowers),
    'social.willingToInviteVoting': f.social_willingToInviteVoting,

    'compliance.previouslyInRealityShow': f.compliance_previouslyInRealityShow,
    'compliance.exclusiveContract': f.compliance_exclusiveContract,
    'compliance.legalRestriction': f.compliance_legalRestriction,
    'compliance.codeOfConductAgreement': f.compliance_codeOfConductAgreement,
    'compliance.backgroundCheckAgreement': f.compliance_backgroundCheckAgreement,
    'compliance.truthDeclaration': f.compliance_truthDeclaration,

    'bootcamp.availableFullPeriod': f.bootcamp_availableFullPeriod,
    'bootcamp.canTravel': f.bootcamp_canTravel,
    'bootcamp.travelRestrictions': f.bootcamp_travelRestrictions,
    'bootcamp.comfortPublicVoting': f.bootcamp_comfortPublicVoting,
    'bootcamp.personalConsiderations': f.bootcamp_personalConsiderations,

    'medical.generalHealthStatus': f.medical_generalHealthStatus,
    'medical.knownConditions': f.medical_knownConditions,
    'medical.allergies': f.medical_allergies,
    'medical.currentMedication': f.medical_currentMedication,
    'medical.dietaryRestrictions': f.medical_dietaryRestrictions,
    'medical.emergencyTreatmentConsent': f.medical_emergencyTreatmentConsent,

    'emergency.fullName': f.emergency_fullName,
    'emergency.relationship': f.emergency_relationship,
    'emergency.phone': f.emergency_phone,
    'emergency.altPhone': f.emergency_altPhone,
    'emergency.state': f.emergency_state,
    'emergency.city': f.emergency_city,

    'audition.format': f.audition_format,
    // The wizard labels this input "performance/audition link"; the schema key
    // for it is audition.onlineLink. Older drafts stored it under the
    // non-schema 'media.performanceLink' — hydrate() reads both.
    'audition.onlineLink': f.media_performanceLink,

    'publicProfile.talentSummary': f.publicProfile_talentSummary,
    // The same headshot doubles as the public-voting profile photo (the
    // schema field is optional and there is only one upload slot in the UI).
    'publicProfile.profilePhoto': f.media_profilePhotoUrl,
    'publicProfile.publicVotingConsent': f.publicProfile_publicVotingConsent,

    'legal.accuracyDeclaration': f.legal_accuracyDeclaration,
    'legal.termsConsent': f.legal_termsConsent,
    'legal.privacyConsent': f.legal_privacyConsent,
    'legal.mediaRelease': f.legal_mediaRelease,
    'legal.publicVotingConsent': f.legal_publicVotingConsent,
    'legal.sponsorActivationConsent': f.legal_sponsorActivationConsent,
    'legal.productionRulesConsent': f.legal_productionRulesConsent,
    'legal.disqualificationAcknowledgment': f.legal_disqualificationAcknowledgment,
    'legal.ageGuardianConfirmation': f.legal_ageGuardianConfirmation,
    'legal.communicationConsent': f.legal_communicationConsent,
    'review.confirmSubmit': f.review_confirmSubmit,
  };

  for (const key of REALITY_TV_UPLOAD_FIELDS) {
    const meta = uploadMeta[key];
    if (meta) flat[`${key}.__meta`] = meta;
  }

  return flat;
}

/**
 * Saved flat formData -> wizard form, plus the upload `__meta` map so file
 * names can be redisplayed after a reload.
 */
export function realityTvWizardHydrate(saved: Record<string, unknown>): {
  form: Partial<RealityTvWizardForm>;
  uploadMeta: RealityTvUploadMeta;
} {
  const uploadMeta: RealityTvUploadMeta = {};
  for (const key of REALITY_TV_UPLOAD_FIELDS) {
    const meta = saved[`${key}.__meta`];
    if (meta && typeof meta === 'object') {
      uploadMeta[key] = meta as Record<string, unknown>;
    }
  }

  const photoUrl = str(saved['media.profilePhoto']);
  const form: Partial<RealityTvWizardForm> = {
    personal_firstName: str(saved['personal.firstName']),
    personal_middleName: str(saved['personal.middleName']),
    personal_lastName: str(saved['personal.lastName']),
    personal_stageName: str(saved['personal.stageName']),
    personal_dateOfBirth: str(saved['personal.dateOfBirth']),
    personal_gender: str(saved['personal.gender']),
    personal_nationality: str(saved['personal.nationality']) || 'Nigerian',
    personal_stateOfOrigin: str(saved['personal.stateOfOrigin']),
    personal_stateOfResidence: str(saved['personal.stateOfResidence']),
    personal_city: str(saved['personal.city']),
    personal_primaryPhone: str(saved['personal.primaryPhone']),
    personal_whatsapp: str(saved['personal.whatsapp']),
    personal_address: str(saved['personal.address']),
    contest_entryMode: str(saved['contest.entryMode']) || 'Individual',
    media_profilePhotoUrl: photoUrl,
    media_profilePhotoName: metaFileName(saved, 'media.profilePhoto'),
    // A persisted upload redownloads through its preview route for the
    // circular preview — the File itself is only needed before upload.
    media_profilePhotoPreview: photoUrl,

    guardian_fullName: str(saved['guardian.fullName']),
    guardian_relationship: str(saved['guardian.relationship']),
    guardian_phone: str(saved['guardian.phone']),
    guardian_email: str(saved['guardian.email']),
    guardian_address: str(saved['guardian.address']),
    guardian_digitalSignature: str(saved['guardian.digitalSignature']),
    guardian_consentGranted: bool(saved['guardian.consentGranted']),
    guardian_idUploadUrl: str(saved['guardian.idUpload']),
    guardian_idUploadName: metaFileName(saved, 'guardian.idUpload'),

    talent_primarySkill: strArr(saved['talent.primarySkill']),
    talent_experienceYears: str(saved['talent.experienceYears']),
    talent_skillLevel: str(saved['talent.skillLevel']),
    talent_previousCompetitions: str(saved['talent.previousCompetitions']),
    talent_strengths: str(saved['talent.strengths']),
    talent_careerGoal: str(saved['talent.careerGoal']),
    talent_uniqueStory: str(saved['talent.uniqueStory']),

    category_uniqueStory: str(saved['category.uniqueStory']),
    identity_idType: str(saved['identity.idType']),
    identity_idNumber: str(saved['identity.idNumber']),
    identity_idUploadUrl: str(saved['identity.idUpload']),
    identity_idUploadName: metaFileName(saved, 'identity.idUpload'),
    media_introVideoUrl: str(saved['media.introVideo']),
    media_introVideoName: metaFileName(saved, 'media.introVideo'),
    social_instagram: str(saved['social.instagram']),
    social_tiktok: str(saved['social.tiktok']),
    social_youtube: str(saved['social.youtube']),
    social_x: str(saved['social.x']),
    social_totalFollowers: str(saved['social.totalFollowers']),
    social_willingToInviteVoting: bool(saved['social.willingToInviteVoting']),
    media_performanceLink:
      str(saved['audition.onlineLink']) || str(saved['media.performanceLink']),
    media_rightsConfirmed: bool(saved['media.rightsConfirmed']),
    audition_format: str(saved['audition.format']),
    publicProfile_talentSummary: str(saved['publicProfile.talentSummary']),
    publicProfile_publicVotingConsent: bool(saved['publicProfile.publicVotingConsent']),

    bootcamp_availableFullPeriod: str(saved['bootcamp.availableFullPeriod']),
    bootcamp_canTravel: bool(saved['bootcamp.canTravel']),
    bootcamp_travelRestrictions: str(saved['bootcamp.travelRestrictions']),
    bootcamp_comfortPublicVoting: bool(saved['bootcamp.comfortPublicVoting']),
    category_housemateReadiness: bool(saved['category.housemateReadiness']),
    category_dailyFilmingConsent: bool(saved['category.dailyFilmingConsent']),
    bootcamp_personalConsiderations: str(saved['bootcamp.personalConsiderations']),
    medical_generalHealthStatus: strArr(saved['medical.generalHealthStatus']),
    medical_knownConditions: strArr(saved['medical.knownConditions']),
    medical_allergies: strArr(saved['medical.allergies']),
    medical_currentMedication: str(saved['medical.currentMedication']),
    medical_dietaryRestrictions: str(saved['medical.dietaryRestrictions']),
    medical_emergencyTreatmentConsent: bool(saved['medical.emergencyTreatmentConsent']),
    emergency_fullName: str(saved['emergency.fullName']),
    emergency_relationship: str(saved['emergency.relationship']),
    emergency_phone: str(saved['emergency.phone']),
    emergency_altPhone: str(saved['emergency.altPhone']),
    emergency_state: str(saved['emergency.state']),
    emergency_city: str(saved['emergency.city']),
    compliance_previouslyInRealityShow: bool(saved['compliance.previouslyInRealityShow']),
    compliance_exclusiveContract: bool(saved['compliance.exclusiveContract']),
    compliance_legalRestriction: bool(saved['compliance.legalRestriction']),
    compliance_codeOfConductAgreement: bool(saved['compliance.codeOfConductAgreement']),
    compliance_backgroundCheckAgreement: bool(saved['compliance.backgroundCheckAgreement']),
    compliance_truthDeclaration: bool(saved['compliance.truthDeclaration']),

    legal_accuracyDeclaration: bool(saved['legal.accuracyDeclaration']),
    legal_termsConsent: bool(saved['legal.termsConsent']),
    legal_privacyConsent: bool(saved['legal.privacyConsent']),
    legal_mediaRelease: bool(saved['legal.mediaRelease']),
    legal_publicVotingConsent: bool(saved['legal.publicVotingConsent']),
    legal_sponsorActivationConsent: bool(saved['legal.sponsorActivationConsent']),
    legal_productionRulesConsent: bool(saved['legal.productionRulesConsent']),
    legal_disqualificationAcknowledgment: bool(saved['legal.disqualificationAcknowledgment']),
    legal_ageGuardianConfirmation: bool(saved['legal.ageGuardianConfirmation']),
    legal_communicationConsent: bool(saved['legal.communicationConsent']),
    review_confirmSubmit: bool(saved['review.confirmSubmit']),
  };

  return { form, uploadMeta };
}

/**
 * Wizard step number -> the schema stepKey the PATCH save is validated
 * under. The wizard's 5 UI steps do not align 1:1 with the 4 schema steps:
 * schema `personal_information` spans wizard steps 1-2 (About You + Your
 * Talent + guardian-when-minor) and `category_specific` spans wizard steps
 * 3-4 (Show Profile + Readiness). A save under a schema step only persists
 * when THAT step validates, so mid-way through a spanning pair the wizard
 * falls back to the always-valid `contest_selection` checkpoint; the real
 * key is used on the step that completes the schema step.
 */
export const REALITY_TV_WIZARD_STEP_SAVE_KEY: Record<number, RegistrationStepKey> = {
  1: 'contest_selection',
  2: 'personal_information',
  3: 'contest_selection',
  4: 'category_specific',
  5: 'review_submit',
};

// A draft stub just real enough for buildRealityTvShowSteps: isMinor() reads
// formData['derived.age'], which the age argument stands in for.
function schemaDraft(age: number | null): RegistrationDraft {
  return {
    id: '', reference: '', contestSlug: 'reality-tv-show', status: 'draft',
    role: 'public_user', createdAt: '', updatedAt: '',
    formData: { 'derived.age': age ?? 0 },
    completionPercent: 0, fraudFlags: [],
  } as RegistrationDraft;
}

/**
 * Look up a field's option list straight from the live schema, so wizard
 * selects can never drift onto values validateStepData would reject
 * (this is exactly how 'Prefer not to say' and 'Mentor' got in). Lookup uses
 * an adult stub; guardian fields carry no options.
 */
export function realityTvFieldOptions(fieldKey: string): string[] {
  for (const step of buildRealityTvShowSteps(schemaDraft(null))) {
    const field = step.fields.find((item) => item.key === fieldKey);
    if (field?.options) return [...field.options];
  }
  return [];
}

/** True when the schema will demand guardian.* fields for this date of birth. */
export function realityTvWizardIsMinor(dateOfBirth: string): boolean {
  const age = deriveAge(dateOfBirth);
  return age !== null && age < 18;
}

/**
 * Client-side mirror of submitRegistrationApplication's full re-validation:
 * run the REAL schema validator over the flat payload, for every step, so a
 * missing required key fails BEFORE Paystack collects money instead of after
 * it. Keys server-stamped on save (contest.title, payment.feeAmount) are
 * injected so they do not false-positive here.
 */
export function realityTvWizardSchemaErrors(
  f: RealityTvWizardForm,
  uploadMeta: RealityTvUploadMeta = {},
): Record<string, string> {
  const flat = realityTvWizardFormToFlat(f, uploadMeta);
  const age = deriveAge(f.personal_dateOfBirth);
  const merged: Record<string, unknown> = {
    'contest.title': 'Spotlight Reality TV Show',
    'payment.feeAmount': 5000,
    ...flat,
    'derived.age': age ?? 0,
  };

  const errors: Record<string, string> = {};
  for (const step of buildRealityTvShowSteps(schemaDraft(age))) {
    const result = validateStepData(step, merged);
    if (!result.isValid) Object.assign(errors, result.errors);
  }
  return errors;
}

/**
 * Per-UI-step client validation. Mirrors (but does not replace) the schema
 * rules — the PATCH save and the submit-path `realityTvWizardSchemaErrors`
 * still run the real validator. These checks exist to highlight fields on
 * the step the user is currently on.
 */
// Kept in sync with validation.ts's E164ish_RE / EMAIL_RE so a malformed
// value is flagged on the step the input lives on instead of surfacing later
// as a mapped server error on a step the user already left.
const TEL_RE = /^\+?[0-9][0-9\-\s]{6,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function validateRealityTvWizardStep(
  step: number,
  f: RealityTvWizardForm,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    if (!f.personal_firstName.trim()) e.personal_firstName = 'First name is required';
    if (!f.personal_lastName.trim()) e.personal_lastName = 'Last name is required';
    if (!f.personal_dateOfBirth) e.personal_dateOfBirth = 'Date of birth is required';
    if (!f.personal_gender) e.personal_gender = 'Gender is required';
    if (!f.personal_stateOfOrigin) e.personal_stateOfOrigin = 'State of origin is required';
    if (!f.personal_stateOfResidence) e.personal_stateOfResidence = 'State is required';
    if (!f.personal_city) e.personal_city = 'City / town is required';
    if (!f.personal_primaryPhone.trim()) e.personal_primaryPhone = 'Phone number is required';
    else if (!TEL_RE.test(f.personal_primaryPhone.trim())) e.personal_primaryPhone = 'Enter a valid phone number';
    if (!f.personal_address.trim()) e.personal_address = 'Residential address is required';
    // The persisted value is the upload URL — a locally-held File that never
    // uploaded is not a valid answer (the schema `file` check reads the URL).
    if (!f.media_profilePhotoUrl) {
      e.media_profilePhotoUrl = 'Please upload a profile photo (JPG/PNG) before continuing';
    }
    if (realityTvWizardIsMinor(f.personal_dateOfBirth)) {
      if (!f.guardian_fullName.trim()) e.guardian_fullName = 'Guardian name is required';
      if (!f.guardian_relationship.trim()) e.guardian_relationship = 'Guardian relationship is required';
      if (!f.guardian_phone.trim()) e.guardian_phone = 'Guardian phone is required';
      else if (!TEL_RE.test(f.guardian_phone.trim())) e.guardian_phone = 'Enter a valid phone number';
      if (!f.guardian_email.trim()) e.guardian_email = 'Guardian email is required';
      else if (!EMAIL_RE.test(f.guardian_email.trim())) e.guardian_email = 'Enter a valid email address';
      if (!f.guardian_address.trim()) e.guardian_address = 'Guardian address is required';
      if (!f.guardian_digitalSignature.trim()) e.guardian_digitalSignature = 'Guardian signature is required';
      if (!f.guardian_consentGranted) e.guardian_consentGranted = 'Guardian consent is required';
    }
  }
  if (step === 2) {
    if (f.talent_primarySkill.length === 0) e.talent_primarySkill = 'Select at least one talent';
    if (!f.talent_experienceYears || Number.isNaN(Number(f.talent_experienceYears))) {
      e.talent_experienceYears = 'Years of experience is required';
    }
    if (!f.talent_skillLevel) e.talent_skillLevel = 'Skill level is required';
    if (!f.talent_strengths.trim()) e.talent_strengths = 'Tell us your strengths';
    if (!f.talent_careerGoal.trim()) e.talent_careerGoal = 'Career goal is required';
    if (!f.talent_uniqueStory.trim()) e.talent_uniqueStory = 'This field is required';
  }
  if (step === 3) {
    if (!f.category_uniqueStory.trim()) e.category_uniqueStory = 'Tell us what makes you a great TV contestant';
    if (!f.identity_idType) e.identity_idType = 'Select your ID type';
    if (!f.identity_idUploadUrl) e.identity_idUploadUrl = 'A government-issued ID upload is required';
    if (!f.audition_format) e.audition_format = 'Select your preferred audition format';
    if (!f.media_rightsConfirmed) e.media_rightsConfirmed = 'You must confirm content rights';
    if (!f.publicProfile_publicVotingConsent) e.publicProfile_publicVotingConsent = 'This consent is required';
  }
  if (step === 4) {
    if (!f.bootcamp_availableFullPeriod) e.bootcamp_availableFullPeriod = 'Please indicate your availability';
    if (!f.bootcamp_canTravel) e.bootcamp_canTravel = 'This confirmation is required';
    if (!f.category_housemateReadiness) e.category_housemateReadiness = 'This consent is required';
    if (!f.category_dailyFilmingConsent) e.category_dailyFilmingConsent = 'This consent is required';
    if (f.medical_generalHealthStatus.length === 0) e.medical_generalHealthStatus = 'Select your general health status';
    if (!f.medical_emergencyTreatmentConsent) e.medical_emergencyTreatmentConsent = 'This consent is required';
    if (!f.emergency_fullName.trim()) e.emergency_fullName = 'Emergency contact name is required';
    if (!f.emergency_phone.trim()) e.emergency_phone = 'Emergency contact phone is required';
    else if (!TEL_RE.test(f.emergency_phone.trim())) e.emergency_phone = 'Enter a valid phone number';
    if (!f.emergency_relationship) e.emergency_relationship = 'Relationship is required';
    if (!f.emergency_state) e.emergency_state = 'Emergency contact state is required';
    if (!f.emergency_city) e.emergency_city = 'Emergency contact city is required';
    if (!f.compliance_codeOfConductAgreement) e.compliance_codeOfConductAgreement = 'This agreement is required';
    if (!f.compliance_backgroundCheckAgreement) e.compliance_backgroundCheckAgreement = 'This agreement is required';
    if (!f.compliance_truthDeclaration) e.compliance_truthDeclaration = 'This declaration is required';
  }
  if (step === 5) {
    if (!f.legal_accuracyDeclaration) e.legal_accuracyDeclaration = 'Required';
    if (!f.legal_termsConsent) e.legal_termsConsent = 'Required';
    if (!f.legal_privacyConsent) e.legal_privacyConsent = 'Required';
    if (!f.legal_mediaRelease) e.legal_mediaRelease = 'Required';
    if (!f.legal_publicVotingConsent) e.legal_publicVotingConsent = 'Required';
    if (!f.legal_productionRulesConsent) e.legal_productionRulesConsent = 'Required';
    // Not a schema field — an extra consent this wizard has always collected.
    // Kept required so the UI does not silently relax it.
    if (!f.legal_sponsorActivationConsent) e.legal_sponsorActivationConsent = 'Required';
    if (!f.legal_disqualificationAcknowledgment) e.legal_disqualificationAcknowledgment = 'Required';
    if (!f.legal_ageGuardianConfirmation) e.legal_ageGuardianConfirmation = 'Required';
    if (!f.legal_communicationConsent) e.legal_communicationConsent = 'Required';
    if (!f.review_confirmSubmit) e.review_confirmSubmit = 'Please confirm you are ready to submit';
  }
  return e;
}

// File fields: the schema error key ('media.profilePhoto') maps onto the
// wizard's persisted-URL field ('media_profilePhotoUrl'), not the File slot.
const FLAT_ERROR_KEY_OVERRIDES: Record<string, keyof RealityTvWizardForm> = {
  'media.profilePhoto': 'media_profilePhotoUrl',
  'media.introVideo': 'media_introVideoUrl',
  'identity.idUpload': 'identity_idUploadUrl',
  'guardian.idUpload': 'guardian_idUploadUrl',
  // The wizard keeps the audition link under its legacy 'media_performanceLink'
  // form key while emitting the schema's 'audition.onlineLink' flat key.
  'audition.onlineLink': 'media_performanceLink',
};

/** Server error keys are flat ('identity.idType'); wizard keys are snake. */
export function flatErrorKeyToFormKey(flatKey: string): string {
  return FLAT_ERROR_KEY_OVERRIDES[flatKey] || flatKey.replace(/\./g, '_');
}
