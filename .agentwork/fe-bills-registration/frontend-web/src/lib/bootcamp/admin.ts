import { ApiError } from '@/lib/api/responses';
import { slugify } from '@/lib/bootcamp/serializers';

export const BOOTCAMP_EDITION_STATUSES = [
  'upcoming',
  'open_for_applications',
  'full',
  'ongoing',
  'completed',
] as const;

export const BOOTCAMP_APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'accepted',
  'waitlisted',
  'rejected',
  'payment_pending',
  'enrolled',
  'completed',
] as const;

export const BOOTCAMP_PAYMENT_STATUSES = [
  'pending',
  'confirmed',
  'failed',
  'refunded',
  'not_required',
] as const;

export type BootcampEditionStatus = (typeof BOOTCAMP_EDITION_STATUSES)[number];
export type BootcampApplicationStatus = (typeof BOOTCAMP_APPLICATION_STATUSES)[number];
export type BootcampPaymentStatus = (typeof BOOTCAMP_PAYMENT_STATUSES)[number];

type UnknownRecord = Record<string, unknown>;

export function readString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readObject(raw: unknown): UnknownRecord {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as UnknownRecord) : {};
}

export function readBoolean(raw: unknown, fallback = false): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw > 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'no'].includes(normalized)) return false;
  }
  return fallback;
}

export function readInt(raw: unknown, fallback = 0): number {
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

export function readIso(raw: unknown): string | null {
  const value = readString(raw);
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function assertEnumValue<T extends readonly string[]>(
  value: string,
  allowed: T,
  message: string
): T[number] {
  if (allowed.includes(value)) {
    return value as T[number];
  }
  throw new ApiError(message, 400);
}

export function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  return [];
}

export async function ensureUniqueBootcampEditionSlug(
  supabase: unknown,
  title: string,
  requestedSlug?: string
) {
  const client = supabase as {
    from: (table: string) => {
      select: (query: string) => {
        eq: (
          column: string,
          value: string
        ) => {
          maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };

  const base = slugify(requestedSlug || title || 'music-bootcamp');
  let candidate = base;
  let counter = 2;

  while (true) {
    const { data, error } = await client
      .from('bootcamp_editions')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
  }
}

export function normalizeLinksArray(raw: unknown): string[] {
  return readStringArray(raw).slice(0, 10);
}
