import { ApiError } from '@/lib/api/responses';

export type SkillCategoryMutationInput = {
  title: string;
  slug: string;
  description: string;
  icon_url: string;
  image_url: string;
  vertical_group: string;
  active: boolean;
  featured: boolean;
  sort_order: number;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function parseSkillCategoryMutationInput(body: unknown): SkillCategoryMutationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const input: SkillCategoryMutationInput = {
    title: readString(source.title),
    slug: readString(source.slug).toLowerCase(),
    description: readString(source.description),
    icon_url: readString(source.icon_url),
    image_url: readString(source.image_url),
    vertical_group: readString(source.vertical_group) || 'general',
    active: source.active !== false,
    featured: source.featured === true,
    sort_order: readInt(source.sort_order, 0),
  };

  if (!input.title) throw new ApiError('title is required', 400);
  if (!input.slug) throw new ApiError('slug is required', 400);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new ApiError('slug must be lowercase alphanumeric with hyphens', 400);
  }

  return input;
}

export type CompetitionCategoryMappingInput = {
  category_id: string;
  subcategory_slug: string;
  is_active: boolean;
  config_overrides: Record<string, unknown>;
};

export type CompetitionCategoryMappingsMutationInput = {
  mappings: CompetitionCategoryMappingInput[];
};

export function parseCompetitionCategoryMappingsMutationInput(
  body: unknown
): CompetitionCategoryMappingsMutationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const rawMappings = source.mappings;
  if (!Array.isArray(rawMappings)) {
    throw new ApiError('mappings must be an array', 400);
  }

  if (rawMappings.length > 200) {
    throw new ApiError('Maximum of 200 competition category mappings is allowed', 400);
  }

  const mappings = rawMappings
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      return {
        category_id: readString(row.category_id),
        subcategory_slug: readString(row.subcategory_slug).toLowerCase(),
        is_active: row.is_active !== false,
        config_overrides: readObject(row.config_overrides),
      } satisfies CompetitionCategoryMappingInput;
    })
    .filter((item): item is CompetitionCategoryMappingInput => Boolean(item));

  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.category_id) {
      throw new ApiError('Each mapping requires category_id', 400);
    }

    const duplicateKey = `${mapping.category_id}::${mapping.subcategory_slug}`;
    if (seen.has(duplicateKey)) {
      throw new ApiError(
        `Duplicate mapping for category_id=${mapping.category_id} and subcategory_slug=${mapping.subcategory_slug || '(empty)'}`,
        400
      );
    }
    seen.add(duplicateKey);
  }

  return { mappings };
}

export type SkillProfileCreateInput = {
  category_id: string;
  display_name: string;
  headline: string;
  bio: string;
  skill_level: string;
  identity_mode: 'solo' | 'team';
  years_experience: number | null;
  city: string;
  state: string;
  country: string;
  social_links: Record<string, string>;
  custom_fields: Record<string, unknown>;
  is_public: boolean;
  is_primary: boolean;
};

export type SkillProfileUpdateInput = Partial<SkillProfileCreateInput>;

function readSocialLinks(value: unknown): Record<string, string> {
  const source = readObject(value);
  return Object.entries(source).reduce<Record<string, string>>((acc, [key, raw]) => {
    if (typeof raw === 'string' && raw.trim()) {
      acc[key] = raw.trim();
    }
    return acc;
  }, {});
}

function readYearsExperience(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

export function parseSkillProfileCreateInput(body: unknown): SkillProfileCreateInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const input: SkillProfileCreateInput = {
    category_id: readString(source.category_id),
    display_name: readString(source.display_name),
    headline: readString(source.headline),
    bio: readString(source.bio),
    skill_level: readString(source.skill_level) || 'beginner',
    identity_mode: source.identity_mode === 'team' ? 'team' : 'solo',
    years_experience: readYearsExperience(source.years_experience),
    city: readString(source.city),
    state: readString(source.state),
    country: readString(source.country) || 'Nigeria',
    social_links: readSocialLinks(source.social_links),
    custom_fields: readObject(source.custom_fields),
    is_public: source.is_public !== false,
    is_primary: source.is_primary === true,
  };

  if (!input.category_id) throw new ApiError('category_id is required', 400);
  if (!input.display_name) throw new ApiError('display_name is required', 400);

  return input;
}

export function parseSkillProfileUpdateInput(body: unknown): SkillProfileUpdateInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const output: SkillProfileUpdateInput = {};

  if ('category_id' in source) output.category_id = readString(source.category_id);
  if ('display_name' in source) output.display_name = readString(source.display_name);
  if ('headline' in source) output.headline = readString(source.headline);
  if ('bio' in source) output.bio = readString(source.bio);
  if ('skill_level' in source) output.skill_level = readString(source.skill_level);
  if ('identity_mode' in source) {
    if (source.identity_mode !== 'solo' && source.identity_mode !== 'team') {
      throw new ApiError('identity_mode must be solo or team', 400);
    }
    output.identity_mode = source.identity_mode;
  }
  if ('years_experience' in source)
    output.years_experience = readYearsExperience(source.years_experience);
  if ('city' in source) output.city = readString(source.city);
  if ('state' in source) output.state = readString(source.state);
  if ('country' in source) output.country = readString(source.country);
  if ('social_links' in source) output.social_links = readSocialLinks(source.social_links);
  if ('custom_fields' in source) output.custom_fields = readObject(source.custom_fields);
  if ('is_public' in source) output.is_public = source.is_public === true;
  if ('is_primary' in source) output.is_primary = source.is_primary === true;

  return output;
}

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

export type CompetitionEntryMediaInput = {
  media_type: 'audio' | 'video' | 'image';
  media_url: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number;
  caption: string;
  is_primary: boolean;
};

export type CompetitionEntryDynamicFieldInput = {
  field_key: string;
  field_label: string;
  field_type: string;
  field_value_text: string;
  field_value_json: Record<string, unknown>;
  is_required: boolean;
};

export type CompetitionEntryCreateInput = {
  competition_id: string;
  beat_id: string;
  entry_title: string;
  entry_description: string;
  lyrical_concept_summary: string;
  category: string;
  media_mode: 'audio' | 'video' | 'video_link';
  video_link: string;
  explicit_content_declared: boolean;
  originality_confirmed: boolean;
  media_items: CompetitionEntryMediaInput[];
  dynamic_fields: CompetitionEntryDynamicFieldInput[];
};

export type CompetitionEntryUpdateInput = Partial<CompetitionEntryCreateInput>;

function readMediaItems(value: unknown): CompetitionEntryMediaInput[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const source = item as Record<string, unknown>;
      const mediaType = readString(source.media_type).toLowerCase();
      if (mediaType !== 'audio' && mediaType !== 'video' && mediaType !== 'image') {
        return null;
      }

      return {
        media_type: mediaType as CompetitionEntryMediaInput['media_type'],
        media_url: readString(source.media_url),
        mime_type: readString(source.mime_type),
        size_bytes: Math.max(0, readInt(source.size_bytes)),
        duration_seconds: Math.max(0, readInt(source.duration_seconds)),
        caption: readString(source.caption),
        is_primary: source.is_primary === true,
      };
    })
    .filter((item): item is CompetitionEntryMediaInput => Boolean(item));
}

function readDynamicFields(value: unknown): CompetitionEntryDynamicFieldInput[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, unknown>;
      const fieldKey = readString(source.field_key);
      if (!fieldKey) return null;

      const rawJson = source.field_value_json;
      const fieldValueJson =
        rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)
          ? (rawJson as Record<string, unknown>)
          : {};

      return {
        field_key: fieldKey,
        field_label: readString(source.field_label),
        field_type: readString(source.field_type) || 'text',
        field_value_text: readString(source.field_value_text),
        field_value_json: fieldValueJson,
        is_required: source.is_required === true,
      };
    })
    .filter((item): item is CompetitionEntryDynamicFieldInput => Boolean(item));
}

function validateMediaItems(mediaItems: CompetitionEntryMediaInput[], required: boolean) {
  if (required && mediaItems.length === 0) {
    throw new ApiError('At least one media item is required', 400);
  }

  if (mediaItems.length > 10) {
    throw new ApiError('Maximum of 10 media items is allowed', 400);
  }

  for (const media of mediaItems) {
    if (!media.media_url) {
      throw new ApiError('Each media item requires a media_url', 400);
    }
  }
}

function validateDynamicFields(dynamicFields: CompetitionEntryDynamicFieldInput[]) {
  if (dynamicFields.length > 100) {
    throw new ApiError('Maximum of 100 dynamic fields is allowed', 400);
  }
}

export function parseCompetitionEntryCreateInput(body: unknown): CompetitionEntryCreateInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const mediaModeRaw = readString(source.media_mode).toLowerCase();
  const mediaMode =
    mediaModeRaw === 'video' || mediaModeRaw === 'video_link' || mediaModeRaw === 'audio'
      ? mediaModeRaw
      : 'audio';
  const mediaItems = readMediaItems(source.media_items);
  const dynamicFields = readDynamicFields(source.dynamic_fields);

  const input: CompetitionEntryCreateInput = {
    competition_id: readString(source.competition_id),
    beat_id: readString(source.beat_id),
    entry_title: readString(source.entry_title),
    entry_description: readString(source.entry_description),
    lyrical_concept_summary: readString(source.lyrical_concept_summary),
    category: readString(source.category),
    media_mode: mediaMode,
    video_link: readString(source.video_link),
    explicit_content_declared: source.explicit_content_declared === true,
    originality_confirmed: source.originality_confirmed === true,
    media_items: mediaItems,
    dynamic_fields: dynamicFields,
  };

  if (!input.competition_id) {
    throw new ApiError('competition_id is required', 400);
  }

  validateMediaItems(input.media_items, false);
  validateDynamicFields(input.dynamic_fields);
  return input;
}

export function parseCompetitionEntryUpdateInput(body: unknown): CompetitionEntryUpdateInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const output: CompetitionEntryUpdateInput = {};

  if ('beat_id' in source) output.beat_id = readString(source.beat_id);
  if ('entry_title' in source) output.entry_title = readString(source.entry_title);
  if ('entry_description' in source)
    output.entry_description = readString(source.entry_description);
  if ('lyrical_concept_summary' in source)
    output.lyrical_concept_summary = readString(source.lyrical_concept_summary);
  if ('category' in source) output.category = readString(source.category);
  if ('video_link' in source) output.video_link = readString(source.video_link);
  if ('explicit_content_declared' in source)
    output.explicit_content_declared = source.explicit_content_declared === true;
  if ('originality_confirmed' in source)
    output.originality_confirmed = source.originality_confirmed === true;

  if ('media_mode' in source) {
    const mediaModeRaw = readString(source.media_mode).toLowerCase();
    if (mediaModeRaw !== 'audio' && mediaModeRaw !== 'video' && mediaModeRaw !== 'video_link') {
      throw new ApiError('media_mode must be audio, video, or video_link', 400);
    }
    output.media_mode = mediaModeRaw as CompetitionEntryCreateInput['media_mode'];
  }

  if ('media_items' in source) {
    output.media_items = readMediaItems(source.media_items);
    validateMediaItems(output.media_items, false);
  }

  if ('dynamic_fields' in source) {
    output.dynamic_fields = readDynamicFields(source.dynamic_fields);
    validateDynamicFields(output.dynamic_fields);
  }

  return output;
}

export type SkillCategoryRulesMutationInput = {
  entry_type_rules: Record<string, unknown>;
  allowed_media_types: string[];
  max_file_size_mb: number;
  max_duration_seconds: number;
  voting_settings: Record<string, unknown>;
  age_min: number | null;
  age_max: number | null;
  team_participation_allowed: boolean;
  custom_onboarding_questions: Array<Record<string, unknown>>;
  moderation_policy: Record<string, unknown>;
  plagiarism_check_enabled: boolean;
  duplicate_check_enabled: boolean;
};

const ALLOWED_QUESTION_TYPES = new Set([
  'text',
  'textarea',
  'long_text',
  'number',
  'url',
  'date',
  'select',
  'radio',
  'checkbox',
]);

function readArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

function readQuestions(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const source = item as Record<string, unknown>;
      const key = String(source.key || source.field_key || '')
        .trim()
        .toLowerCase();
      const label = String(source.label || source.field_label || '').trim();
      const type = String(source.type || source.field_type || 'text')
        .trim()
        .toLowerCase();
      const required = source.required === true || source.is_required === true;

      const rawOptions = Array.isArray(source.options) ? source.options : [];
      const options = rawOptions
        .map((option) => (typeof option === 'string' ? option.trim() : ''))
        .filter(Boolean);

      return {
        key: key || `field_${index + 1}`,
        label,
        type: type || 'text',
        required,
        placeholder: String(source.placeholder || '').trim(),
        options,
      } as Record<string, unknown>;
    });
}

function validateQuestions(questions: Array<Record<string, unknown>>) {
  const keySet = new Set<string>();
  for (const question of questions) {
    const key = String(question.key || '')
      .trim()
      .toLowerCase();
    const label = String(question.label || '').trim();
    const type = String(question.type || 'text')
      .trim()
      .toLowerCase();
    const options = Array.isArray(question.options) ? question.options : [];

    if (!key) {
      throw new ApiError('Each onboarding question requires a key', 400);
    }
    if (!label) {
      throw new ApiError(`Question "${key}" requires a label`, 400);
    }
    if (keySet.has(key)) {
      throw new ApiError(`Duplicate onboarding question key: ${key}`, 400);
    }
    keySet.add(key);

    if (!ALLOWED_QUESTION_TYPES.has(type)) {
      throw new ApiError(`Unsupported question type "${type}" for key "${key}"`, 400);
    }

    if ((type === 'select' || type === 'radio' || type === 'checkbox') && options.length === 0) {
      throw new ApiError(`Question "${key}" requires non-empty options`, 400);
    }
  }
}

export function parseSkillCategoryRulesMutationInput(
  body: unknown
): SkillCategoryRulesMutationInput {
  if (!body || typeof body !== 'object') {
    throw new ApiError('Invalid request body', 400);
  }

  const source = body as Record<string, unknown>;
  const input: SkillCategoryRulesMutationInput = {
    entry_type_rules: readObject(source.entry_type_rules),
    allowed_media_types: readArrayOfStrings(source.allowed_media_types),
    max_file_size_mb: readNumber(source.max_file_size_mb, 100),
    max_duration_seconds: readNumber(source.max_duration_seconds, 300),
    voting_settings: readObject(source.voting_settings),
    age_min: readNullableNumber(source.age_min),
    age_max: readNullableNumber(source.age_max),
    team_participation_allowed: source.team_participation_allowed === true,
    custom_onboarding_questions: readQuestions(source.custom_onboarding_questions),
    moderation_policy: readObject(source.moderation_policy),
    plagiarism_check_enabled: source.plagiarism_check_enabled === true,
    duplicate_check_enabled: source.duplicate_check_enabled === true,
  };

  if (
    input.age_min !== null &&
    input.age_max !== null &&
    Number.isFinite(input.age_min) &&
    Number.isFinite(input.age_max) &&
    input.age_min > input.age_max
  ) {
    throw new ApiError('age_min cannot be greater than age_max', 400);
  }

  if (input.custom_onboarding_questions.length > 100) {
    throw new ApiError('Maximum of 100 onboarding questions is allowed', 400);
  }
  validateQuestions(input.custom_onboarding_questions);

  return input;
}
