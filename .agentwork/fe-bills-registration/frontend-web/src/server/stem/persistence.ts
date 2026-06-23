import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { hasUsableSupabaseConfig } from '@/lib/supabase/runtime';
import {
  addStemContestCategory as addStemContestCategoryMemory,
  addStemPriceCategory as addStemPriceCategoryMemory,
  addStemPrizeCategory as addStemPrizeCategoryMemory,
  createSchoolJoinRequest as createSchoolJoinRequestMemory,
  createStemContestAdmin as createStemContestAdminMemory,
  getStemApplication as getStemApplicationMemory,
  getStemApplicationTimeline as getStemApplicationTimelineMemory,
  getStemContestById as getStemContestByIdMemory,
  getStemContestBySlug as getStemContestBySlugMemory,
  listSchoolJoinRequests as listSchoolJoinRequestsMemory,
  listStemAdminContests as listStemAdminContestsMemory,
  listStemApplications as listStemApplicationsMemory,
  listStemContests as listStemContestsMemory,
  listStemSchools as listStemSchoolsMemory,
  publishStemContestAdmin as publishStemContestAdminMemory,
  registerStemSchool as registerStemSchoolMemory,
  reviewSchoolJoinRequest as reviewSchoolJoinRequestMemory,
  reviewStemApplicationAdmin as reviewStemApplicationAdminMemory,
  reviewStemSchool as reviewStemSchoolMemory,
  saveStemApplicationDraft as saveStemApplicationDraftMemory,
  startStemApplication as startStemApplicationMemory,
  submitStemApplication as submitStemApplicationMemory,
  updateStemContestAdmin as updateStemContestAdminMemory,
} from './store';
import { stemDefaultProjectFields, stemDefaultScoringCriteria, stemDefaultTrackRules, stemDefaultUploads } from '@/src/features/stem/constants';
import { computeCompletionPercent, validateApplicationDraft } from '@/src/features/stem/validation';
import type {
  StemAdminApplicationReviewInput,
  StemApplicantType,
  StemApplication,
  StemApplicationFilter,
  StemApplicationStatus,
  StemContest,
  StemContestCategory,
  StemPriceCategory,
  StemPrizeCategory,
  StemSchool,
  StemSchoolJoinRequest,
  StemStartApplicationInput,
  StemStatusEvent,
} from '@/src/features/stem/types';

function shouldUseDb() {
  return hasUsableSupabaseConfig();
}

function nowIso() {
  return new Date().toISOString();
}

function makeReference(prefix: string) {
  const cleanPrefix = prefix.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'STEM';
  const stamp = Date.now().toString().slice(-6);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${cleanPrefix}-${stamp}-${suffix}`;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mapContestRow(row: any): StemContest {
  const cfg = Array.isArray(row.stem_contest_configs) ? row.stem_contest_configs[0] || {} : row.stem_contest_configs || {};
  const categories = safeArray<any>(row.stem_contest_categories).map((cat): StemContestCategory => ({
    id: cat.id,
    contestId: cat.contest_id,
    name: cat.category_name,
    description: cat.category_description || undefined,
    icon: cat.category_icon || undefined,
    banner: cat.category_banner || undefined,
    eligibleTracks: safeArray(cat.eligible_tracks),
    eligibleAgeRange: cat.eligible_age_min || cat.eligible_age_max ? { min: cat.eligible_age_min ?? undefined, max: cat.eligible_age_max ?? undefined } : undefined,
    eligibleSchoolLevels: safeArray(cat.eligible_school_levels),
    eligibleProjectStages: safeArray(cat.eligible_project_stages),
    requiredUploads: safeArray(cat.required_uploads),
    requiredQuestions: safeArray(cat.required_questions),
    judgingCriteria: safeArray(cat.judging_criteria),
    scoreWeightPercent: cat.score_weight_pct ?? undefined,
    sponsorAssigned: cat.sponsor_name || undefined,
    maxApplicants: cat.max_applicants ?? undefined,
    maxFinalists: cat.max_finalists ?? undefined,
    publicProfileVisible: cat.is_public_profile_visible !== false,
    rules: cat.category_rules || undefined,
    safetyRequirements: cat.safety_requirements || undefined,
    status: (String(cat.status || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'),
    createdAt: cat.created_at || nowIso(),
    updatedAt: cat.updated_at || nowIso(),
  }));

  const priceCategories = safeArray<any>(row.stem_price_categories).map((price): StemPriceCategory => ({
    id: price.id,
    contestId: price.contest_id,
    name: price.category_name,
    description: price.description || undefined,
    appliesToTracks: safeArray(price.applies_to_tracks),
    appliesToApplicantTypes: safeArray(price.applies_to_applicant_types),
    appliesToSchoolTypes: safeArray(price.applies_to_school_types),
    appliesToCategoryIds: [],
    appliesToStates: safeArray(price.applies_to_states),
    currency: price.currency || 'NGN',
    amount: Number(price.amount || 0),
    earlyBirdAmount: price.early_bird_amount ?? undefined,
    lateFeeAmount: price.late_fee_amount ?? undefined,
    startDate: price.starts_at || undefined,
    endDate: price.ends_at || undefined,
    paymentRequiredBeforeSubmission: price.payment_required_before_submission === true,
    paymentRequiredAfterShortlisting: price.payment_required_after_shortlisting === true,
    paymentRequiredBeforeDemoDay: price.payment_required_before_demo_day === true,
    refundPolicy: price.refund_policy || undefined,
    discountCodeEnabled: price.discount_code_enabled === true,
    waiverCodeEnabled: price.waiver_code_enabled === true,
    sponsorCodeEnabled: price.sponsor_code_enabled === true,
    maxApplicants: price.max_applicants ?? undefined,
    visiblePublicly: price.is_publicly_visible !== false,
    adminOnly: price.is_admin_only === true,
    status: (String(price.status || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'),
    createdAt: price.created_at || nowIso(),
    updatedAt: price.updated_at || nowIso(),
  }));

  const prizeCategories = safeArray<any>(row.stem_prize_categories).map((prize): StemPrizeCategory => ({
    id: prize.id,
    contestId: prize.contest_id,
    title: prize.prize_title,
    description: prize.prize_description || undefined,
    prizeType: prize.prize_type,
    prizeValue: prize.prize_value || undefined,
    cashPrizeAmount: prize.cash_prize_amount ?? undefined,
    nonCashPrizeDescription: prize.non_cash_prize_description || undefined,
    sponsor: prize.sponsor_name || undefined,
    eligibleCategoryIds: [],
    eligibleTracks: safeArray(prize.eligible_tracks),
    numberOfWinners: Number(prize.number_of_winners || 1),
    selectionCriteria: prize.selection_criteria || undefined,
    publiclyVisible: prize.is_publicly_visible !== false,
    terms: prize.terms || undefined,
    disbursementCondition: prize.disbursement_condition || undefined,
    verificationRequiredBeforeAward: prize.verification_required_before_award !== false,
    status: (String(prize.status || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'),
    createdAt: prize.created_at || nowIso(),
    updatedAt: prize.updated_at || nowIso(),
  }));

  return {
    id: row.id,
    slug: row.slug,
    title: row.name,
    season: cfg.season || 'Season 1',
    subtitle: cfg.subtitle || undefined,
    description: row.description || cfg.objective || 'STEM contest',
    objective: cfg.objective || undefined,
    status: String(cfg.contest_status || row.status || 'draft').toLowerCase() as any,
    visibility: String(cfg.contest_visibility || 'public').toLowerCase() as any,
    tracksAllowed: safeArray(cfg.tracks_allowed),
    trackRules: (cfg.track_rules || stemDefaultTrackRules) as any,
    applicantAgeMin: cfg.eligibility_rules?.applicantAgeMin,
    applicantAgeMax: cfg.eligibility_rules?.applicantAgeMax,
    schoolTypeEligibility: safeArray(cfg.eligibility_rules?.schoolTypeEligibility),
    innovatorEligibility: safeArray(cfg.eligibility_rules?.innovatorEligibility),
    stateEligibility: safeArray(cfg.eligibility_rules?.stateEligibility),
    requiredDocuments: safeArray(cfg.required_documents),
    requiredMediaUploads: safeArray(cfg.required_uploads),
    requiredProjectFields: safeArray(cfg.required_project_fields).length ? safeArray(cfg.required_project_fields) : [...stemDefaultProjectFields],
    teamSizeMin: cfg.team_rules?.teamSizeMin,
    teamSizeMax: cfg.team_rules?.teamSizeMax,
    judgingCriteriaDefault: safeArray(cfg.judging_rules?.criteria).length ? safeArray(cfg.judging_rules?.criteria) : [...stemDefaultScoringCriteria],
    votingEnabled: Boolean(cfg.voting_rules?.enabled),
    votingFeePerVote: cfg.voting_rules?.pricePerVote,
    votingStartDate: cfg.voting_open_at || undefined,
    votingEndDate: cfg.voting_close_at || undefined,
    registrationOpenDate: cfg.registration_open_at || undefined,
    registrationCloseDate: cfg.registration_close_at || undefined,
    demoDayEnabled: Boolean(cfg.showcase_rules?.demoDayEnabled),
    demoLocations: safeArray(cfg.showcase_rules?.locations),
    sponsorBackedCategories: safeArray(cfg.eligibility_rules?.sponsorBackedCategories),
    freeEntryEnabled: Boolean(cfg.eligibility_rules?.freeEntryEnabled ?? true),
    paidEntryEnabled: Boolean(cfg.eligibility_rules?.paidEntryEnabled ?? false),
    couponEnabled: Boolean(cfg.eligibility_rules?.couponEnabled ?? false),
    waiverEnabled: Boolean(cfg.eligibility_rules?.waiverEnabled ?? false),
    schoolBulkRegistrationEnabled: Boolean(cfg.eligibility_rules?.schoolBulkRegistrationEnabled ?? false),
    publicProfileEnabled: Boolean(cfg.public_profile_enabled ?? false),
    finalistSelectionProcess: cfg.reporting_rules?.finalistSelectionProcess,
    winnerSelectionRules: cfg.reporting_rules?.winnerSelectionRules,
    reportingRequirements: cfg.reporting_rules?.reportingRequirements,
    categories,
    priceCategories,
    prizeCategories,
    createdBy: row.created_by || undefined,
    updatedBy: cfg.updated_by || undefined,
    createdAt: row.created_at || nowIso(),
    updatedAt: cfg.updated_at || row.updated_at || nowIso(),
    bannerImage: undefined,
    logo: undefined,
    sponsorLogo: undefined,
    organizer: cfg.organizer || undefined,
    partnerSponsor: cfg.partner_sponsor || undefined,
    supportContact: cfg.support_contact || undefined,
    faq: cfg.faq || undefined,
    termsAndConditions: cfg.terms_and_conditions || undefined,
    privacyNote: cfg.privacy_note || undefined,
  };
}

function mapSchoolRow(row: any): StemSchool {
  return {
    id: row.id,
    schoolName: row.school_name,
    schoolType: row.school_type || '',
    ownershipType: row.ownership_type || undefined,
    schoolCategory: undefined,
    registrationNumber: undefined,
    yearEstablished: undefined,
    officialEmail: row.official_email || undefined,
    officialPhone: row.official_phone || undefined,
    website: row.website || undefined,
    address: row.address || undefined,
    country: row.country || undefined,
    state: row.state || undefined,
    lga: row.lga_city || undefined,
    city: row.lga_city || undefined,
    nearestLandmark: undefined,
    schoolLogo: row.school_logo_url || undefined,
    campusPhoto: undefined,
    schoolDescription: undefined,
    adminContact: {
      fullName: row.school_admin_name || '',
      designation: undefined,
      email: row.school_admin_email || row.official_email || '',
      phone: row.school_admin_phone || row.official_phone || '',
      whatsapp: undefined,
      preferredContactMethod: undefined,
    },
    verificationDocuments: [row.registration_document_url, row.accreditation_document_url].filter(Boolean),
    status: String(row.verification_status || 'submitted').toLowerCase() as any,
    reviewedBy: row.reviewed_by || undefined,
    reviewNote: row.verification_notes || undefined,
    createdAt: row.created_at || nowIso(),
    updatedAt: row.updated_at || nowIso(),
  };
}

function mapJoinRequestRow(row: any): StemSchoolJoinRequest {
  return {
    id: row.id,
    schoolId: row.school_id,
    studentUserId: row.student_user_id || undefined,
    fullName: row.full_name,
    email: row.email || undefined,
    phone: row.phone || undefined,
    studentId: row.student_id || undefined,
    classLevel: row.class_level || undefined,
    department: row.department || undefined,
    studentIdUpload: row.student_id_upload_url || undefined,
    admissionLetterUpload: row.admission_letter_upload_url || undefined,
    mentorName: row.mentor_name || undefined,
    note: row.request_note || undefined,
    status: String(row.status || 'pending').toLowerCase() as any,
    reviewedBy: row.reviewed_by || undefined,
    reviewNote: row.review_note || undefined,
    createdAt: row.created_at || nowIso(),
    updatedAt: row.updated_at || nowIso(),
  };
}

function mapApplicationRow(row: any): StemApplication {
  return {
    id: row.id,
    reference: row.application_reference,
    contestId: row.contest_id,
    contestSlug: row.contest_slug || '',
    track: row.participation_track,
    applicantType: row.applicant_type,
    status: String(row.application_status || 'draft').toLowerCase() as any,
    schoolId: row.school_id || undefined,
    schoolJoinRequestId: row.school_join_request_id || undefined,
    applicantUserId: row.applicant_user_id || undefined,
    applicantEmail: row.form_answers?.['applicant.email'] || undefined,
    applicantPhone: row.form_answers?.['applicant.phone'] || undefined,
    applicantName: row.form_answers?.['applicant.name'] || undefined,
    categoryId: row.category_id || undefined,
    priceCategoryId: row.price_category_id || undefined,
    paymentStatus: String(row.payment_status || 'pending').toLowerCase() as any,
    completionPercent: Number(row.form_answers?.['meta.completionPercent'] || 0),
    formData: row.form_answers || {},
    projectData: row.project_payload || {},
    uploadData: row.upload_payload || {},
    fraudFlags: safeArray(row.fraud_payload?.flags),
    safetyFlags: safeArray(row.safety_payload?.flags),
    submittedAt: row.submitted_at || undefined,
    createdAt: row.created_at || nowIso(),
    updatedAt: row.updated_at || nowIso(),
  };
}

function mapTimelineRow(row: any): StemStatusEvent {
  return {
    id: row.id,
    applicationId: row.application_id,
    oldStatus: row.from_status || undefined,
    newStatus: row.to_status,
    actorRole: row.actor_role || 'system',
    note: row.note || undefined,
    createdAt: row.created_at || nowIso(),
  };
}

async function getContestRowBySlug(slug: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('stem_contests')
    .select('id,name,slug,description,status,created_at,updated_at,created_by,stem_contest_configs(*),stem_contest_categories(*),stem_price_categories(*),stem_prize_categories(*)')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getContestRowById(contestId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('stem_contests')
    .select('id,name,slug,description,status,created_at,updated_at,created_by,stem_contest_configs(*),stem_contest_categories(*),stem_price_categories(*),stem_prize_categories(*)')
    .eq('id', contestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function shouldFallback(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error || '');
  return msg.includes('relation') || msg.includes('does not exist') || msg.includes('not configured') || msg.includes('Failed to fetch');
}

export async function listContests(input?: { includeNonPublic?: boolean; status?: string }) {
  if (!shouldUseDb()) return listStemContestsMemory(input);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_contests')
      .select('id,name,slug,description,status,created_at,updated_at,created_by,stem_contest_configs(*),stem_contest_categories(*),stem_price_categories(*),stem_prize_categories(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = safeArray<any>(data).map(mapContestRow);
    return rows.filter((contest) => {
      if (!input?.includeNonPublic && contest.visibility === 'hidden') return false;
      if (!input?.includeNonPublic && contest.status !== 'published' && contest.status !== 'open_for_registration' && contest.status !== 'voting_live') {
        return false;
      }
      if (input?.status && contest.status !== input.status) return false;
      return true;
    });
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listStemContestsMemory(input);
  }
}

export async function listAdminContests() {
  if (!shouldUseDb()) return listStemAdminContestsMemory();
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_contests')
      .select('id,name,slug,description,status,created_at,updated_at,created_by,stem_contest_configs(*),stem_contest_categories(*),stem_price_categories(*),stem_prize_categories(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return safeArray<any>(data).map(mapContestRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listStemAdminContestsMemory();
  }
}

export async function getContestBySlug(slug: string) {
  if (!shouldUseDb()) return getStemContestBySlugMemory(slug);
  try {
    const row = await getContestRowBySlug(slug);
    if (!row) return null;
    return mapContestRow(row);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getStemContestBySlugMemory(slug);
  }
}

export async function getContestById(contestId: string) {
  if (!shouldUseDb()) return getStemContestByIdMemory(contestId);
  try {
    const row = await getContestRowById(contestId);
    if (!row) return null;
    return mapContestRow(row);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getStemContestByIdMemory(contestId);
  }
}

export async function createContest(input: Partial<StemContest>, actorId?: string) {
  if (!shouldUseDb()) return createStemContestAdminMemory(input, actorId);
  try {
    const supabase = createAdminClient();
    const name = String(input.title || '').trim();
    const slug = String(input.slug || '').trim();
    const season = String(input.season || '').trim();
    const description = String(input.description || '').trim();

    if (!name || !slug || !season || !description) {
      return { success: false as const, errors: { required: 'title, slug, season, description are required' } };
    }

    const { data: existing, error: existingError } = await supabase
      .from('stem_contests')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return { success: false as const, errors: { slug: 'Contest slug already exists.' } };
    }

    const { data: contestRow, error: contestErr } = await supabase
      .from('stem_contests')
      .insert({
        name,
        slug,
        contest_type: 'STEM',
        contest_mode: 'MIXED',
        eligible_participant_types: ['school_student', 'independent_innovator', 'mixed'],
        eligible_school_levels: [],
        eligible_states: [],
        status: String(input.status || 'draft').toUpperCase(),
      })
      .select('*')
      .single();

    if (contestErr) throw contestErr;

    const { error: cfgErr } = await supabase
      .from('stem_contest_configs')
      .insert({
        contest_id: contestRow.id,
        season,
        subtitle: input.subtitle || null,
        objective: input.objective || description,
        organizer: input.organizer || null,
        partner_sponsor: input.partnerSponsor || null,
        contest_status: String(input.status || 'draft').toUpperCase(),
        contest_visibility: String(input.visibility || 'public').toUpperCase(),
        tracks_allowed: input.tracksAllowed || ['school_student', 'independent_innovator'],
        track_rules: input.trackRules || stemDefaultTrackRules,
        eligibility_rules: {
          applicantAgeMin: input.applicantAgeMin ?? null,
          applicantAgeMax: input.applicantAgeMax ?? null,
          schoolTypeEligibility: input.schoolTypeEligibility || [],
          innovatorEligibility: input.innovatorEligibility || [],
          stateEligibility: input.stateEligibility || [],
          freeEntryEnabled: input.freeEntryEnabled ?? true,
          paidEntryEnabled: input.paidEntryEnabled ?? false,
          couponEnabled: input.couponEnabled ?? false,
          waiverEnabled: input.waiverEnabled ?? false,
          schoolBulkRegistrationEnabled: input.schoolBulkRegistrationEnabled ?? false,
        },
        required_documents: input.requiredDocuments || [],
        required_uploads: input.requiredMediaUploads || [...stemDefaultUploads],
        required_project_fields: input.requiredProjectFields || [...stemDefaultProjectFields],
        team_rules: {
          teamSizeMin: input.teamSizeMin ?? 1,
          teamSizeMax: input.teamSizeMax ?? 8,
        },
        judging_rules: {
          criteria: input.judgingCriteriaDefault || [...stemDefaultScoringCriteria],
        },
        voting_rules: {
          enabled: Boolean(input.votingEnabled),
          pricePerVote: input.votingFeePerVote ?? null,
        },
        showcase_rules: {
          demoDayEnabled: Boolean(input.demoDayEnabled),
          locations: input.demoLocations || [],
        },
        reporting_rules: {
          finalistSelectionProcess: input.finalistSelectionProcess || null,
          winnerSelectionRules: input.winnerSelectionRules || null,
          reportingRequirements: input.reportingRequirements || null,
        },
        registration_open_at: input.registrationOpenDate || null,
        registration_close_at: input.registrationCloseDate || null,
        voting_open_at: input.votingStartDate || null,
        voting_close_at: input.votingEndDate || null,
        public_profile_enabled: Boolean(input.publicProfileEnabled),
        terms_and_conditions: input.termsAndConditions || null,
        privacy_note: input.privacyNote || null,
        faq: input.faq || null,
        support_contact: input.supportContact || null,
        created_by: actorId || null,
        updated_by: actorId || null,
      });
    if (cfgErr) throw cfgErr;

    const row = await getContestRowById(contestRow.id);
    return { success: true as const, contest: mapContestRow(row) };
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return createStemContestAdminMemory(input, actorId);
  }
}

export async function updateContest(contestId: string, patch: Partial<StemContest>, actorId?: string) {
  if (!shouldUseDb()) return updateStemContestAdminMemory(contestId, patch, actorId);
  try {
    const supabase = createAdminClient();
    const contestUpdate: Record<string, unknown> = {};
    if (patch.title !== undefined) contestUpdate.name = patch.title;
    if (patch.slug !== undefined) contestUpdate.slug = patch.slug;
    if (patch.status !== undefined) contestUpdate.status = String(patch.status).toUpperCase();
    if (Object.keys(contestUpdate).length > 0) {
      const { error } = await supabase.from('stem_contests').update(contestUpdate).eq('id', contestId);
      if (error) throw error;
    }

    const cfgPatch: Record<string, unknown> = {};
    if (patch.season !== undefined) cfgPatch.season = patch.season;
    if (patch.subtitle !== undefined) cfgPatch.subtitle = patch.subtitle;
    if (patch.objective !== undefined) cfgPatch.objective = patch.objective;
    if (patch.status !== undefined) cfgPatch.contest_status = String(patch.status).toUpperCase();
    if (patch.visibility !== undefined) cfgPatch.contest_visibility = String(patch.visibility).toUpperCase();
    if (patch.trackRules !== undefined) cfgPatch.track_rules = patch.trackRules;
    if (patch.tracksAllowed !== undefined) cfgPatch.tracks_allowed = patch.tracksAllowed;
    if (patch.requiredProjectFields !== undefined) cfgPatch.required_project_fields = patch.requiredProjectFields;
    if (patch.requiredMediaUploads !== undefined) cfgPatch.required_uploads = patch.requiredMediaUploads;
    if (patch.publicProfileEnabled !== undefined) cfgPatch.public_profile_enabled = patch.publicProfileEnabled;
    if (patch.registrationOpenDate !== undefined) cfgPatch.registration_open_at = patch.registrationOpenDate;
    if (patch.registrationCloseDate !== undefined) cfgPatch.registration_close_at = patch.registrationCloseDate;
    if (patch.votingStartDate !== undefined) cfgPatch.voting_open_at = patch.votingStartDate;
    if (patch.votingEndDate !== undefined) cfgPatch.voting_close_at = patch.votingEndDate;
    cfgPatch.updated_by = actorId || null;

    if (Object.keys(cfgPatch).length > 0) {
      const { error } = await supabase.from('stem_contest_configs').update(cfgPatch).eq('contest_id', contestId);
      if (error) throw error;
    }

    const row = await getContestRowById(contestId);
    if (!row) throw new Error('Contest not found.');
    return mapContestRow(row);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return updateStemContestAdminMemory(contestId, patch, actorId);
  }
}

export async function publishContest(contestId: string, actorId?: string) {
  if (!shouldUseDb()) return publishStemContestAdminMemory(contestId, actorId);
  return updateContest(contestId, { status: 'published' }, actorId);
}

export async function addContestCategory(contestId: string, payload: Partial<StemContestCategory>) {
  if (!shouldUseDb()) return addStemContestCategoryMemory(contestId, payload);
  try {
    const supabase = createAdminClient();
    if (!payload.name?.trim()) throw new Error('Category name is required.');

    const { data, error } = await supabase
      .from('stem_contest_categories')
      .insert({
        contest_id: contestId,
        category_name: payload.name,
        category_description: payload.description || null,
        category_icon: payload.icon || null,
        category_banner: payload.banner || null,
        eligible_tracks: payload.eligibleTracks || [],
        eligible_age_min: payload.eligibleAgeRange?.min ?? null,
        eligible_age_max: payload.eligibleAgeRange?.max ?? null,
        eligible_school_levels: payload.eligibleSchoolLevels || [],
        eligible_project_stages: payload.eligibleProjectStages || [],
        required_uploads: payload.requiredUploads || [],
        required_questions: payload.requiredQuestions || [],
        judging_criteria: payload.judgingCriteria || [],
        score_weight_pct: payload.scoreWeightPercent ?? null,
        sponsor_name: payload.sponsorAssigned || null,
        max_applicants: payload.maxApplicants ?? null,
        max_finalists: payload.maxFinalists ?? null,
        is_public_profile_visible: payload.publicProfileVisible ?? true,
        category_rules: payload.rules || null,
        safety_requirements: payload.safetyRequirements || null,
        status: String(payload.status || 'active').toUpperCase(),
      })
      .select('*')
      .single();

    if (error) throw error;
    return mapContestRow({ stem_contest_categories: [data], stem_price_categories: [], stem_prize_categories: [], stem_contest_configs: [] }).categories[0];
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return addStemContestCategoryMemory(contestId, payload);
  }
}

export async function addPriceCategory(contestId: string, payload: Partial<StemPriceCategory>) {
  if (!shouldUseDb()) return addStemPriceCategoryMemory(contestId, payload);
  try {
    const supabase = createAdminClient();
    if (!payload.name?.trim()) throw new Error('Price category name is required.');

    const { data, error } = await supabase
      .from('stem_price_categories')
      .insert({
        contest_id: contestId,
        category_name: payload.name,
        description: payload.description || null,
        applies_to_tracks: payload.appliesToTracks || [],
        applies_to_applicant_types: payload.appliesToApplicantTypes || [],
        applies_to_school_types: payload.appliesToSchoolTypes || [],
        applies_to_states: payload.appliesToStates || [],
        currency: payload.currency || 'NGN',
        amount: payload.amount || 0,
        early_bird_amount: payload.earlyBirdAmount ?? null,
        late_fee_amount: payload.lateFeeAmount ?? null,
        starts_at: payload.startDate || null,
        ends_at: payload.endDate || null,
        payment_required_before_submission: payload.paymentRequiredBeforeSubmission ?? false,
        payment_required_after_shortlisting: payload.paymentRequiredAfterShortlisting ?? false,
        payment_required_before_demo_day: payload.paymentRequiredBeforeDemoDay ?? false,
        refund_policy: payload.refundPolicy || null,
        discount_code_enabled: payload.discountCodeEnabled ?? false,
        waiver_code_enabled: payload.waiverCodeEnabled ?? false,
        sponsor_code_enabled: payload.sponsorCodeEnabled ?? false,
        max_applicants: payload.maxApplicants ?? null,
        is_publicly_visible: payload.visiblePublicly ?? true,
        is_admin_only: payload.adminOnly ?? false,
        status: String(payload.status || 'active').toUpperCase(),
      })
      .select('*')
      .single();

    if (error) throw error;
    return mapContestRow({ stem_price_categories: [data], stem_contest_categories: [], stem_prize_categories: [], stem_contest_configs: [] }).priceCategories[0];
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return addStemPriceCategoryMemory(contestId, payload);
  }
}

export async function addPrizeCategory(contestId: string, payload: Partial<StemPrizeCategory>) {
  if (!shouldUseDb()) return addStemPrizeCategoryMemory(contestId, payload);
  try {
    const supabase = createAdminClient();
    if (!payload.title?.trim()) throw new Error('Prize title is required.');

    const { data, error } = await supabase
      .from('stem_prize_categories')
      .insert({
        contest_id: contestId,
        prize_title: payload.title,
        prize_description: payload.description || null,
        prize_type: payload.prizeType || 'CATEGORY_WINNER',
        prize_value: payload.prizeValue || null,
        cash_prize_amount: payload.cashPrizeAmount ?? null,
        non_cash_prize_description: payload.nonCashPrizeDescription || null,
        sponsor_name: payload.sponsor || null,
        eligible_tracks: payload.eligibleTracks || [],
        number_of_winners: payload.numberOfWinners || 1,
        selection_criteria: payload.selectionCriteria || null,
        is_publicly_visible: payload.publiclyVisible ?? true,
        terms: payload.terms || null,
        disbursement_condition: payload.disbursementCondition || null,
        verification_required_before_award: payload.verificationRequiredBeforeAward ?? true,
        status: String(payload.status || 'active').toUpperCase(),
      })
      .select('*')
      .single();

    if (error) throw error;
    return mapContestRow({ stem_prize_categories: [data], stem_contest_categories: [], stem_price_categories: [], stem_contest_configs: [] }).prizeCategories[0];
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return addStemPrizeCategoryMemory(contestId, payload);
  }
}

export async function registerSchool(input: Omit<StemSchool, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
  if (!shouldUseDb()) return registerStemSchoolMemory(input);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_schools')
      .insert({
        school_name: input.schoolName,
        school_type: input.schoolType,
        ownership_type: input.ownershipType || null,
        country: input.country || 'Nigeria',
        state: input.state || null,
        lga_city: input.city || input.lga || null,
        address: input.address || null,
        official_email: input.officialEmail || null,
        official_phone: input.officialPhone || null,
        website: input.website || null,
        school_admin_name: input.adminContact.fullName,
        school_admin_email: input.adminContact.email,
        school_admin_phone: input.adminContact.phone,
        school_logo_url: input.schoolLogo || null,
        registration_document_url: input.verificationDocuments?.[0] || null,
        accreditation_document_url: input.verificationDocuments?.[1] || null,
        social_links: {},
        verification_status: 'SUBMITTED',
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapSchoolRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return registerStemSchoolMemory(input);
  }
}

export async function listSchools(status?: StemSchool['status']) {
  if (!shouldUseDb()) return listStemSchoolsMemory(status);
  try {
    const supabase = createAdminClient();
    let query = supabase.from('stem_schools').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('verification_status', String(status).toUpperCase());
    const { data, error } = await query;
    if (error) throw error;
    return safeArray<any>(data).map(mapSchoolRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listStemSchoolsMemory(status);
  }
}

export async function reviewSchool(schoolId: string, status: StemSchool['status'], note?: string, actorId?: string) {
  if (!shouldUseDb()) return reviewStemSchoolMemory(schoolId, status, note, actorId);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_schools')
      .update({
        verification_status: String(status).toUpperCase(),
        verification_notes: note || null,
        reviewed_by: actorId || null,
        reviewed_at: nowIso(),
      })
      .eq('id', schoolId)
      .select('*')
      .single();
    if (error) throw error;
    return mapSchoolRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return reviewStemSchoolMemory(schoolId, status, note, actorId);
  }
}

export async function createSchoolJoinRequest(input: Omit<StemSchoolJoinRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
  if (!shouldUseDb()) return createSchoolJoinRequestMemory(input);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_school_join_requests')
      .insert({
        school_id: input.schoolId,
        student_user_id: input.studentUserId || null,
        full_name: input.fullName,
        email: input.email || null,
        phone: input.phone || null,
        student_id: input.studentId || null,
        class_level: input.classLevel || null,
        department: input.department || null,
        student_id_upload_url: input.studentIdUpload || null,
        admission_letter_upload_url: input.admissionLetterUpload || null,
        mentor_name: input.mentorName || null,
        request_note: input.note || null,
        status: 'PENDING',
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapJoinRequestRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return createSchoolJoinRequestMemory(input);
  }
}

export async function listSchoolJoinRequests(schoolId?: string) {
  if (!shouldUseDb()) return listSchoolJoinRequestsMemory(schoolId);
  try {
    const supabase = createAdminClient();
    let query = supabase.from('stem_school_join_requests').select('*').order('created_at', { ascending: false });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data, error } = await query;
    if (error) throw error;
    return safeArray<any>(data).map(mapJoinRequestRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listSchoolJoinRequestsMemory(schoolId);
  }
}

export async function reviewSchoolJoinRequest(requestId: string, status: 'approved' | 'rejected', note?: string, actorId?: string) {
  if (!shouldUseDb()) return reviewSchoolJoinRequestMemory(requestId, status, note, actorId);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_school_join_requests')
      .update({
        status: String(status).toUpperCase(),
        review_note: note || null,
        reviewed_by: actorId || null,
        reviewed_at: nowIso(),
      })
      .eq('id', requestId)
      .select('*')
      .single();
    if (error) throw error;
    return mapJoinRequestRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return reviewSchoolJoinRequestMemory(requestId, status, note, actorId);
  }
}

function resolveInitialStatus(contest: StemContest, input: StemStartApplicationInput): StemApplicationStatus {
  if (input.applicantType === 'student' && contest.trackRules.studentNeedsSchoolApproval) {
    return 'awaiting_school_approval';
  }
  return 'draft';
}

function resolveInitialPaymentStatus(contest: StemContest, applicantType: StemApplicantType) {
  if (contest.freeEntryEnabled && !contest.paidEntryEnabled) return 'not_required';
  if (applicantType === 'student' && contest.freeEntryEnabled) return 'waived';
  return 'pending';
}

export async function startApplication(input: StemStartApplicationInput) {
  if (!shouldUseDb()) return startStemApplicationMemory(input);
  try {
    const contest = await getContestBySlug(input.contestSlug);
    if (!contest) {
      return { success: false as const, errors: { contestSlug: 'Contest not found.' } };
    }
    if (contest.status !== 'published' && contest.status !== 'open_for_registration') {
      return { success: false as const, errors: { contestStatus: 'Contest is not accepting applications.' } };
    }

    const initialStatus = resolveInitialStatus(contest, input);
    const paymentStatus = resolveInitialPaymentStatus(contest, input.applicantType);

    const supabase = createAdminClient();
    const reference = makeReference(contest.slug);

    const { data, error } = await supabase
      .from('stem_contest_applications')
      .insert({
        contest_id: contest.id,
        application_reference: reference,
        applicant_user_id: input.applicantUserId || null,
        school_id: input.schoolId || null,
        school_join_request_id: input.schoolJoinRequestId || null,
        applicant_type: input.applicantType,
        participation_track: input.track,
        payment_status: String(paymentStatus).toUpperCase(),
        application_status: String(initialStatus).toUpperCase(),
        public_profile_status: 'HIDDEN',
        contest_slug: contest.slug,
        form_answers: {
          'applicant.name': input.applicantName,
          'applicant.email': input.applicantEmail,
          'applicant.phone': input.applicantPhone,
          'meta.completionPercent': 0,
        },
        project_payload: {},
        upload_payload: {},
        safety_payload: { flags: [] },
        fraud_payload: { flags: [] },
      })
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('stem_application_status_history').insert({
      application_id: data.id,
      from_status: null,
      to_status: String(initialStatus).toUpperCase(),
      actor_role: 'applicant',
      note: 'Application draft created',
    });

    return {
      success: true as const,
      application: mapApplicationRow(data),
      contest,
    };
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return startStemApplicationMemory(input);
  }
}

async function fetchApplicationRow(applicationId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('stem_contest_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getApplication(applicationId: string) {
  if (!shouldUseDb()) return getStemApplicationMemory(applicationId);
  try {
    const row = await fetchApplicationRow(applicationId);
    if (!row) return null;
    return mapApplicationRow(row);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getStemApplicationMemory(applicationId);
  }
}

export async function saveApplicationDraft(
  applicationId: string,
  payload: {
    status?: StemApplicationStatus;
    categoryId?: string;
    priceCategoryId?: string;
    formData?: Record<string, unknown>;
    projectData?: Record<string, unknown>;
    uploadData?: Record<string, unknown>;
  }
) {
  if (!shouldUseDb()) return saveStemApplicationDraftMemory(applicationId, payload);
  try {
    const row = await fetchApplicationRow(applicationId);
    if (!row) throw new Error('Application not found.');

    const contest = await getContestById(row.contest_id);
    if (!contest) throw new Error('Contest not found for application.');

    const formData = { ...(row.form_answers || {}), ...(payload.formData || {}) };
    const projectData = { ...(row.project_payload || {}), ...(payload.projectData || {}) };
    const uploadData = { ...(row.upload_payload || {}), ...(payload.uploadData || {}) };

    const combined = { ...formData, ...projectData, ...uploadData };
    const completionPercent = computeCompletionPercent(contest, combined);
    formData['meta.completionPercent'] = completionPercent;

    const nextStatus = String(payload.status || row.application_status || 'draft').toUpperCase();

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_contest_applications')
      .update({
        application_status: nextStatus,
        category_id: payload.categoryId || row.category_id || null,
        price_category_id: payload.priceCategoryId || row.price_category_id || null,
        form_answers: formData,
        project_payload: projectData,
        upload_payload: uploadData,
      })
      .eq('id', applicationId)
      .select('*')
      .single();
    if (error) throw error;

    return mapApplicationRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return saveStemApplicationDraftMemory(applicationId, payload);
  }
}

export async function submitApplication(applicationId: string) {
  if (!shouldUseDb()) return submitStemApplicationMemory(applicationId);
  try {
    const row = await fetchApplicationRow(applicationId);
    if (!row) throw new Error('Application not found.');

    const contest = await getContestById(row.contest_id);
    if (!contest) throw new Error('Contest not found for application.');

    const merged = {
      ...(row.form_answers || {}),
      ...(row.project_payload || {}),
      ...(row.upload_payload || {}),
    };

    const validation = validateApplicationDraft(contest, merged, 'submitted');
    if (!validation.isValid) {
      return {
        success: false as const,
        errors: validation.errors,
        application: mapApplicationRow(row),
      };
    }

    const nextStatus =
      String(row.payment_status || '').toUpperCase() === 'PENDING' && contest.paidEntryEnabled
        ? 'AWAITING_PAYMENT'
        : 'SUBMITTED';

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_contest_applications')
      .update({
        application_status: nextStatus,
        submitted_at: nowIso(),
      })
      .eq('id', applicationId)
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('stem_application_status_history').insert({
      application_id: applicationId,
      from_status: row.application_status,
      to_status: nextStatus,
      actor_role: 'applicant',
      note: 'Application submitted',
    });

    return {
      success: true as const,
      application: mapApplicationRow(data),
    };
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return submitStemApplicationMemory(applicationId);
  }
}

export async function listApplications(filter: StemApplicationFilter = {}) {
  if (!shouldUseDb()) return listStemApplicationsMemory(filter);
  try {
    const supabase = createAdminClient();
    let query = supabase.from('stem_contest_applications').select('*').order('created_at', { ascending: false });

    if (filter.contestId) query = query.eq('contest_id', filter.contestId);
    if (filter.applicantUserId) query = query.eq('applicant_user_id', filter.applicantUserId);
    if (filter.status) query = query.eq('application_status', String(filter.status).toUpperCase());
    if (filter.applicantType) query = query.eq('applicant_type', filter.applicantType);
    if (filter.track) query = query.eq('participation_track', filter.track);
    if (filter.schoolId) query = query.eq('school_id', filter.schoolId);
    if (filter.paymentStatus) query = query.eq('payment_status', String(filter.paymentStatus).toUpperCase());

    const { data, error } = await query;
    if (error) throw error;

    let rows = safeArray<any>(data).map(mapApplicationRow);

    if (filter.contestSlug) rows = rows.filter((row) => row.contestSlug === filter.contestSlug);
    if (filter.query) {
      const q = filter.query.toLowerCase();
      rows = rows.filter((row) => `${row.reference} ${row.applicantName || ''} ${row.applicantEmail || ''}`.toLowerCase().includes(q));
    }

    return rows;
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return listStemApplicationsMemory(filter);
  }
}

export async function reviewApplication(applicationId: string, input: StemAdminApplicationReviewInput) {
  if (!shouldUseDb()) return reviewStemApplicationAdminMemory(applicationId, input);
  try {
    const row = await fetchApplicationRow(applicationId);
    if (!row) throw new Error('Application not found.');

    const formAnswers = {
      ...(row.form_answers || {}),
      'admin.reviewNote': input.note || '',
      'admin.reviewScore': typeof input.score === 'number' ? input.score : (row.form_answers || {})['admin.reviewScore'],
    };

    const safetyPayload = {
      ...(row.safety_payload || {}),
      flags: input.safetyFlags || (row.safety_payload?.flags || []),
    };

    const fraudPayload = {
      ...(row.fraud_payload || {}),
      flags: input.fraudFlags || (row.fraud_payload?.flags || []),
    };

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_contest_applications')
      .update({
        application_status: String(input.status).toUpperCase(),
        form_answers: formAnswers,
        safety_payload: safetyPayload,
        fraud_payload: fraudPayload,
      })
      .eq('id', applicationId)
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('stem_application_status_history').insert({
      application_id: applicationId,
      from_status: row.application_status,
      to_status: String(input.status).toUpperCase(),
      actor_role: 'admin',
      note: input.note || null,
    });

    return mapApplicationRow(data);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return reviewStemApplicationAdminMemory(applicationId, input);
  }
}

export async function getApplicationTimeline(applicationId: string) {
  if (!shouldUseDb()) return getStemApplicationTimelineMemory(applicationId);
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('stem_application_status_history')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    return safeArray<any>(data).map(mapTimelineRow);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    return getStemApplicationTimelineMemory(applicationId);
  }
}
