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
