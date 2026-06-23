import { ApiError } from '@/lib/api/responses';

export type BootcampApplicationInput = {
  stage_name: string;
  legal_name: string;
  genre_style: string;
  short_bio: string;
  city: string;
  state: string;
  social_links: Record<string, string>;
  sample_links: string[];
  portfolio_links: string[];
  past_experience: string;
  motivation_text: string;
  goals_text: string;
  selected_package_id: string;
  terms_accepted: boolean;
  explicit_content_declared: boolean;
};

export type BootcampAdminEditionInput = {
  title: string;
  slug?: string;
  summary: string;
  status: 'upcoming' | 'open_for_applications' | 'full' | 'ongoing' | 'completed';
  location_name: string;
  is_residential: boolean;
  start_at: string | null;
  end_at: string | null;
  application_deadline: string | null;
  seat_limit: number;
  is_published: boolean;
  hero_title: string;
  hero_subtitle: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const output: Record<string, string> = {};
  Object.keys(source).forEach((key) => {
    const raw = source[key];
    if (typeof raw === 'string' && raw.trim()) {
      output[key] = raw.trim();
    }
  });
  return output;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    // We throw an error instead of returning a fallback to avoid masking invalid input
    throw new ApiError(`Invalid positive integer provided. Expected a number greater than 0.`, 400);
  }
  return Math.trunc(parsed);
}

function asIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function parseBootcampApplicationInput(body: unknown): BootcampApplicationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  return {
    stage_name: asString(source.stage_name),
    legal_name: asString(source.legal_name),
    genre_style: asString(source.genre_style),
    short_bio: asString(source.short_bio),
    city: asString(source.city),
    state: asString(source.state),
    social_links: asRecord(source.social_links),
    sample_links: asStringArray(source.sample_links),
    portfolio_links: asStringArray(source.portfolio_links),
    past_experience: asString(source.past_experience),
    motivation_text: asString(source.motivation_text),
    goals_text: asString(source.goals_text),
    selected_package_id: asString(source.selected_package_id),
    terms_accepted: asBool(source.terms_accepted),
    explicit_content_declared: asBool(source.explicit_content_declared),
  };
}

export function validateBootcampApplicationForSubmit(input: BootcampApplicationInput) {
  const errors: string[] = [];
  if (!input.stage_name) errors.push('Stage name is required');
  if (!input.legal_name) errors.push('Legal name is required');
  if (!input.genre_style) errors.push('Genre/style is required');
  if (!input.short_bio) errors.push('Short bio is required');
  if (!input.city) errors.push('City is required');
  if (!input.state) errors.push('State is required');
  if (!input.motivation_text) errors.push('Motivation is required');
  if (!input.goals_text) errors.push('Goals are required');
  if (!input.selected_package_id) errors.push('Package selection is required');
  if (!input.terms_accepted) errors.push('Terms acceptance is required');
  if (input.sample_links.length === 0) {
    errors.push('At least one music sample link is required');
  }

  if (errors.length > 0) {
    throw new ApiError(errors.join('. '), 400);
  }
}

export function parseBootcampAdminEditionInput(body: unknown): BootcampAdminEditionInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const status = asString(source.status) as BootcampAdminEditionInput['status'];
  if (!['upcoming', 'open_for_applications', 'full', 'ongoing', 'completed'].includes(status)) {
    throw new ApiError('Invalid bootcamp status', 400);
  }

  const title = asString(source.title);
  if (!title) {
    throw new ApiError('Bootcamp title is required', 400);
  }

  return {
    title,
    slug: asString(source.slug) || undefined,
    summary: asString(source.summary),
    status,
    location_name: asString(source.location_name) || 'Timeless Studio',
    is_residential: source.is_residential !== false,
    start_at: asIso(source.start_at),
    end_at: asIso(source.end_at),
    application_deadline: asIso(source.application_deadline),
    seat_limit: asPositiveInt(source.seat_limit, 30),
    is_published: source.is_published === true,
    hero_title: asString(source.hero_title),
    hero_subtitle: asString(source.hero_subtitle),
  };
}
