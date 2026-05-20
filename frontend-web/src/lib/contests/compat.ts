type UnknownRecord = Record<string, unknown>;

const SCHEMA_ERROR_CODES = new Set([
  '42P01', // undefined table
  '42703', // undefined column
  'PGRST200',
  'PGRST201',
  'PGRST204',
  'PGRST205',
]);

function readString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
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
    if (value === 'true' || value === '1' || value === 'yes') return true;
    if (value === 'false' || value === '0' || value === 'no') return false;
  }
  return fallback;
}

export function slugifyContestName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'contest'
  );
}

export function getContestName(row: UnknownRecord): string {
  return (
    readString(row.name) ||
    readString(row.title) ||
    readString(row.contest_name) ||
    'Untitled Contest'
  );
}

export function getContestSlug(row: UnknownRecord): string {
  const explicitSlug = readString(row.slug);
  if (explicitSlug) return explicitSlug;

  const explicitPublicSlug = readString(row.public_slug);
  if (explicitPublicSlug) return explicitPublicSlug;

  const nameSlug = slugifyContestName(getContestName(row));
  const idFallback = readString(row.id);
  return idFallback ? `${nameSlug}-${idFallback.slice(0, 8)}` : nameSlug;
}

export function inferContestType(row: UnknownRecord): string {
  const declared = readString(row.contest_type);
  if (declared) return declared;

  const category = (readString(row.category) || '').toLowerCase();
  const name = getContestName(row).toLowerCase();
  if (category.includes('music') || /open\s*mic|one[-\s]*beat|one[-\s]*verse/.test(name)) {
    return 'one_beat_one_verse';
  }

  return 'multi_skill';
}

export function isOpenMicContest(row: UnknownRecord): boolean {
  return inferContestType(row) === 'one_beat_one_verse';
}

export function isPublicContest(row: UnknownRecord): boolean {
  const visibility = readString(row.visibility);
  if (!visibility) return true;
  return visibility.toLowerCase() === 'public';
}

export function matchContestSlug(row: UnknownRecord, slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return false;

  const bySlug = getContestSlug(row).toLowerCase();
  if (bySlug === normalized) return true;

  const byId = (readString(row.id) || '').toLowerCase();
  if (byId === normalized) return true;

  const byNameSlug = slugifyContestName(getContestName(row)).toLowerCase();
  return byNameSlug === normalized;
}

export function isRecoverableSupabaseSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = readString((error as UnknownRecord).code);
  if (code && SCHEMA_ERROR_CODES.has(code)) return true;

  const message = (readString((error as UnknownRecord).message) || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('does not exist') ||
    message.includes('could not find') ||
    message.includes('schema cache')
  );
}
