import {
  bootcampStatusLabel,
  resolveBootcampStatus,
  type BootcampStatus,
} from '@/lib/bootcamp/status';

type UnknownRecord = Record<string, unknown>;

export function readString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function readMaybeString(raw: unknown): string | null {
  const value = readString(raw);
  return value.length ? value : null;
}

export function readNumberish(raw: unknown, fallback = 0): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function readBooleanish(raw: unknown, fallback = false): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw > 0;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(value)) return true;
    if (['0', 'false', 'no'].includes(value)) return false;
  }
  return fallback;
}

export function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'music-bootcamp'
  );
}

export function normalizeBootcampEdition(row: UnknownRecord) {
  const status = resolveBootcampStatus({
    status: readMaybeString(row.status),
    start_at: readMaybeString(row.start_at),
    end_at: readMaybeString(row.end_at),
    application_deadline: readMaybeString(row.application_deadline),
    seat_limit: readNumberish(row.seat_limit, 0),
    seats_filled: readNumberish(row.seats_filled, 0),
  });

  return {
    id: readString(row.id),
    title: readString(row.title),
    slug: readString(row.slug),
    summary: readString(row.summary),
    location_name: readString(row.location_name) || 'Timeless Studio',
    is_residential: readBooleanish(row.is_residential, true),
    start_at: readMaybeString(row.start_at),
    end_at: readMaybeString(row.end_at),
    application_deadline: readMaybeString(row.application_deadline),
    seat_limit: Math.max(0, Math.trunc(readNumberish(row.seat_limit, 0))),
    seats_filled: Math.max(0, Math.trunc(readNumberish(row.seats_filled, 0))),
    is_published: readBooleanish(row.is_published, false),
    hero_title: readString(row.hero_title),
    hero_subtitle: readString(row.hero_subtitle),
    highlights: readStringArray(row.highlights),
    benefits: readStringArray(row.benefits),
    faq: Array.isArray(row.faq) ? row.faq : [],
    includes_items: readStringArray(row.includes_items),
    requirements: readStringArray(row.requirements),
    outcomes: readStringArray(row.outcomes),
    status,
    status_label: bootcampStatusLabel(status as BootcampStatus),
    created_at: readMaybeString(row.created_at),
  };
}
