import { ApiError } from '@/lib/api/responses';

export type CompetitionCategoryMappingInput = {
  category_id: string;
  subcategory_slug: string;
  is_active: boolean;
  config_overrides: Record<string, unknown>;
};

export type CompetitionCategoryMappingsMutationInput = {
  mappings: CompetitionCategoryMappingInput[];
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

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
