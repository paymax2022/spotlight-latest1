import type {
  StemApplication,
  StemApplicationStatus,
  StemContest,
  StemStartApplicationInput,
} from './types';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateStemContestConfig(contest: Partial<StemContest>) {
  const errors: Record<string, string> = {};

  if (!contest.title?.trim()) errors.title = 'Contest title is required.';
  if (!contest.slug?.trim()) errors.slug = 'Contest slug is required.';
  if (!contest.season?.trim()) errors.season = 'Contest season is required.';
  if (!contest.description?.trim()) errors.description = 'Contest description is required.';
  if (!contest.tracksAllowed || contest.tracksAllowed.length === 0) {
    errors.tracksAllowed = 'At least one participation track is required.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateStartApplicationInput(input: StemStartApplicationInput) {
  const errors: Record<string, string> = {};
  if (!input.contestSlug?.trim()) errors.contestSlug = 'Contest slug is required.';
  if (!input.track?.trim()) errors.track = 'Track is required.';
  if (!input.applicantType?.trim()) errors.applicantType = 'Applicant type is required.';
  if (!input.applicantName?.trim()) errors.applicantName = 'Applicant name is required.';
  if (!input.applicantEmail?.trim() || !emailRegex.test(input.applicantEmail)) {
    errors.applicantEmail = 'A valid applicant email is required.';
  }
  if (!input.applicantPhone?.trim()) errors.applicantPhone = 'Applicant phone is required.';

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateApplicationDraft(
  contest: StemContest,
  data: Record<string, unknown>,
  status: StemApplicationStatus
) {
  const errors: Record<string, string> = {};

  for (const field of contest.requiredProjectFields) {
    if (!field.required) continue;
    const value = data[field.key];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && !value.trim()) ||
      (Array.isArray(value) && value.length === 0);

    if (isEmpty) {
      errors[field.key] = `${field.label} is required.`;
    }
  }

  if (status !== 'draft') {
    if (!data['consent.accuracyDeclaration']) {
      errors['consent.accuracyDeclaration'] = 'You must confirm the accuracy declaration.';
    }
    if (!data['consent.terms']) {
      errors['consent.terms'] = 'You must accept terms and conditions.';
    }
    if (!data['consent.dataPrivacy']) {
      errors['consent.dataPrivacy'] = 'You must accept data privacy consent.';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function computeCompletionPercent(contest: StemContest, formData: Record<string, unknown>) {
  const requiredFields = contest.requiredProjectFields.filter((field) => field.required);
  if (requiredFields.length === 0) return 0;

  let completed = 0;
  for (const field of requiredFields) {
    const value = formData[field.key];
    const hasValue =
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && !value.trim()) &&
      !(Array.isArray(value) && value.length === 0);
    if (hasValue) completed += 1;
  }

  return Math.min(100, Math.round((completed / requiredFields.length) * 100));
}

export function detectStemFraudFlags(application: StemApplication) {
  const flags: string[] = [];

  if (!application.applicantEmail || !application.applicantPhone) {
    flags.push('incomplete_identity');
  }

  if (application.paymentStatus === 'failed') {
    flags.push('payment_mismatch_flag');
  }

  if (application.track === 'school_student' && !application.schoolId) {
    flags.push('school_track_without_school');
  }

  if (application.status === 'submitted' && application.completionPercent < 70) {
    flags.push('suspicious_low_completion_submission');
  }

  return flags;
}
