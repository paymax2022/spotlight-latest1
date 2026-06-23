import { ApiError } from '@/lib/api/responses';

export type CompetitionEnrollmentInput = {
  stage_name: string;
  legal_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  email: string;
  state: string;
  city: string;
  genre_style: string;
  short_bio: string;
  social_links: Record<string, string>;
  terms_accepted: boolean;
  consent_accepted: boolean;
  eligibility_confirmed: boolean;
};

export type CompetitionBeatMutationInput = {
  title: string;
  genre: string;
  producer_credit: string;
  sponsor_tag: string;
  preview_url: string;
  download_url: string;
  rules_text: string;
  requires_enrollment: boolean;
  allow_multiple_choice: boolean;
  is_active: boolean;
};

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSocialLinks(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, raw]) => {
      if (typeof raw === 'string') {
        const normalized = raw.trim();
        if (normalized) {
          acc[key] = normalized;
        }
      }
      return acc;
    },
    {}
  );
}

export function parseCompetitionEnrollmentInput(body: unknown): CompetitionEnrollmentInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const input: CompetitionEnrollmentInput = {
    stage_name: readString(source.stage_name),
    legal_name: readString(source.legal_name),
    date_of_birth: readString(source.date_of_birth),
    gender: readString(source.gender),
    phone: readString(source.phone),
    email: readString(source.email).toLowerCase(),
    state: readString(source.state),
    city: readString(source.city),
    genre_style: readString(source.genre_style),
    short_bio: readString(source.short_bio),
    social_links: parseSocialLinks(source.social_links),
    terms_accepted: source.terms_accepted === true,
    consent_accepted: source.consent_accepted === true,
    eligibility_confirmed: source.eligibility_confirmed === true,
  };

  const errors: string[] = [];
  if (!input.stage_name) errors.push('Stage name is required');
  if (!input.legal_name) errors.push('Legal name is required');
  if (!input.date_of_birth) errors.push('Date of birth is required');
  if (!input.phone) errors.push('Phone is required');
  if (!input.email) errors.push('Email is required');
  if (!input.state) errors.push('State is required');
  if (!input.city) errors.push('City is required');
  if (!input.genre_style) errors.push('Genre style is required');
  if (!input.short_bio) errors.push('Short bio is required');
  if (!input.terms_accepted) errors.push('Terms must be accepted');
  if (!input.consent_accepted) errors.push('Consent must be accepted');
  if (!input.eligibility_confirmed) errors.push('Eligibility confirmation is required');

  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.push('Email is invalid');
  }

  if (input.phone && input.phone.replace(/\D/g, '').length < 10) {
    errors.push('Phone number is invalid');
  }

  if (errors.length > 0) {
    throw new ApiError(errors.join('. '), 400);
  }

  return input;
}

export function parseCompetitionBeatMutationInput(body: unknown): CompetitionBeatMutationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const input: CompetitionBeatMutationInput = {
    title: readString(source.title),
    genre: readString(source.genre),
    producer_credit: readString(source.producer_credit),
    sponsor_tag: readString(source.sponsor_tag),
    preview_url: readString(source.preview_url),
    download_url: readString(source.download_url),
    rules_text: readString(source.rules_text),
    requires_enrollment: source.requires_enrollment !== false,
    allow_multiple_choice: source.allow_multiple_choice === true,
    is_active: source.is_active !== false,
  };

  if (!input.title) {
    throw new ApiError('Beat title is required', 400);
  }

  if (!input.preview_url) {
    throw new ApiError('Beat preview URL is required', 400);
  }

  if (!input.download_url) {
    throw new ApiError('Beat download URL is required', 400);
  }

  return input;
}
