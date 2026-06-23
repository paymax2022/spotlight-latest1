import { ApiError } from '@/lib/api/responses';

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

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

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
