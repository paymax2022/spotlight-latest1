import { ApiError } from '@/lib/api/responses';

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

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

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
