import { ApiError } from '@/lib/api/responses';

export type AcademyApplicationInput = {
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  residential_address: string;
  city: string;
  state: string;
  nationality: string;
  areas_of_interest: string[];
  highest_education: string;
  school_name: string;
  relevant_training: string;
  has_prior_experience: boolean;
  experience_description: string;
  motivation: string;
  career_goals: string;
  batch_id: string;
  terms_accepted: boolean;
};

export type AcademyPaymentConfirmationInput = {
  applicationId: string;
  paymentReference: string;
};

export type AcademyReviewUpdateInput = {
  status?: string;
  rejection_reason?: string | null;
  admin_notes?: string | null;
};

export type AcademySettingsUpdateInput = {
  registration_type: 'free' | 'paid';
  application_fee: number;
  application_fee_refundable: boolean;
  tuition_fee: number;
};

export type AcademyBatchMutationInput = {
  batch_name: string;
  start_date: string;
  training_schedule: 'weekdays' | 'weekends' | 'accelerated';
  duration_weeks: number;
  max_students: number | null;
  description: string;
  benefits: string[];
  status?: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
};

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim());
}

export function parseAcademyApplicationInput(body: unknown): AcademyApplicationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const email = getString(source.email);
  const phone = getString(source.phone);
  const areasOfInterest = getStringArray(source.areas_of_interest);
  const errors: string[] = [];

  const input: AcademyApplicationInput = {
    full_name: getString(source.full_name),
    email,
    phone,
    gender: getString(source.gender),
    date_of_birth: getString(source.date_of_birth),
    residential_address: getString(source.residential_address),
    city: getString(source.city),
    state: getString(source.state),
    nationality: getOptionalString(source.nationality) || 'Nigerian',
    areas_of_interest: areasOfInterest,
    highest_education: getOptionalString(source.highest_education),
    school_name: getOptionalString(source.school_name),
    relevant_training: getOptionalString(source.relevant_training),
    has_prior_experience: Boolean(source.has_prior_experience),
    experience_description: getOptionalString(source.experience_description),
    motivation: getString(source.motivation),
    career_goals: getString(source.career_goals),
    batch_id: getString(source.batch_id),
    terms_accepted: source.terms_accepted === true,
  };

  if (!input.full_name) errors.push('Full name is required');
  if (!input.email) errors.push('Email is required');
  if (!input.phone) errors.push('Phone number is required');
  if (!input.gender) errors.push('Gender is required');
  if (!input.date_of_birth) errors.push('Date of birth is required');
  if (!input.residential_address) errors.push('Residential address is required');
  if (!input.city) errors.push('City is required');
  if (!input.state) errors.push('State is required');
  if (areasOfInterest.length === 0) errors.push('At least one area of interest is required');
  if (!input.motivation) errors.push('Motivation is required');
  if (!input.career_goals) errors.push('Career goals are required');
  if (!input.batch_id) errors.push('Batch selection is required');
  if (!input.terms_accepted) errors.push('You must accept the Terms & Conditions');

  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (input.email && !emailRegex.test(input.email)) {
    errors.push('Please enter a valid email address');
  }

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  const phoneDigits = input.phone.replace(/\D/g, '');
  if (phoneDigits.length < 10 || !phoneRegex.test(input.phone.replace(/\s/g, ''))) {
    errors.push('Please enter a valid phone number (min. 10 digits, international format)');
  }

  if (errors.length > 0) {
    throw new ApiError(errors.join('. '), 400);
  }

  return input;
}

export function parseAcademyPaymentConfirmationInput(
  body: unknown
): AcademyPaymentConfirmationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const applicationId = getString(source.applicationId);
  const paymentReference = getString(source.paymentReference);

  if (!applicationId || !paymentReference) {
    throw new ApiError('Application ID and payment reference are required', 400);
  }

  return { applicationId, paymentReference };
}

export function parseAcademyReviewUpdateInput(body: unknown): AcademyReviewUpdateInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;

  return {
    status: getOptionalString(source.status) || undefined,
    rejection_reason:
      source.rejection_reason === null ? null : getOptionalString(source.rejection_reason),
    admin_notes: source.admin_notes === null ? null : getOptionalString(source.admin_notes),
  };
}

export function parseAcademySettingsUpdateInput(body: unknown): AcademySettingsUpdateInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const registrationType = getString(source.registration_type);
  const applicationFee = getNumber(source.application_fee);
  const tuitionFee = getNumber(source.tuition_fee);
  const applicationFeeRefundable = source.application_fee_refundable === true;

  if (registrationType !== 'free' && registrationType !== 'paid') {
    throw new ApiError('Registration type must be free or paid', 400);
  }

  if (!Number.isFinite(applicationFee) || applicationFee < 0) {
    throw new ApiError('Application fee must be a valid positive amount', 400);
  }

  if (!Number.isFinite(tuitionFee) || tuitionFee < 0) {
    throw new ApiError('Tuition fee must be a valid positive amount', 400);
  }

  return {
    registration_type: registrationType,
    application_fee: applicationFee,
    application_fee_refundable: applicationFeeRefundable,
    tuition_fee: tuitionFee,
  };
}

export function parseAcademyBatchMutationInput(body: unknown): AcademyBatchMutationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const batchName = getString(source.batch_name);
  const startDate = getString(source.start_date);
  const trainingSchedule = getString(source.training_schedule);
  const durationWeeks = getNumber(source.duration_weeks);
  const maxStudentsValue = source.max_students;
  const maxStudents =
    maxStudentsValue === null || maxStudentsValue === undefined || maxStudentsValue === ''
      ? null
      : getNumber(maxStudentsValue);
  const benefits = getStringArray(source.benefits).filter(Boolean);
  const status = getOptionalString(source.status);

  if (!batchName) {
    throw new ApiError('Batch name is required', 400);
  }

  if (!startDate) {
    throw new ApiError('Start date is required', 400);
  }

  if (!['weekdays', 'weekends', 'accelerated'].includes(trainingSchedule)) {
    throw new ApiError('Training schedule is invalid', 400);
  }

  if (!Number.isFinite(durationWeeks) || durationWeeks <= 0) {
    throw new ApiError('Duration in weeks must be greater than zero', 400);
  }

  if (maxStudents !== null && (!Number.isFinite(maxStudents) || maxStudents <= 0)) {
    throw new ApiError('Max students must be greater than zero when provided', 400);
  }

  const normalizedStatus = status === 'active' ? 'ongoing' : status;

  if (
    normalizedStatus &&
    !['upcoming', 'ongoing', 'completed', 'cancelled'].includes(normalizedStatus)
  ) {
    throw new ApiError('Batch status is invalid', 400);
  }

  return {
    batch_name: batchName,
    start_date: startDate,
    training_schedule: trainingSchedule as AcademyBatchMutationInput['training_schedule'],
    duration_weeks: Math.trunc(durationWeeks),
    max_students: maxStudents === null ? null : Math.trunc(maxStudents),
    description: getOptionalString(source.description),
    benefits,
    status: normalizedStatus
      ? (normalizedStatus as AcademyBatchMutationInput['status'])
      : undefined,
  };
}
