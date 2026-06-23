import { ApiError } from '@/lib/api/responses';

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

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

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
