// Reading (and writing) the training-format catalogue that
// ./pricing.ts prices against.
//
// Split out because two very different callers need it: every applicant-facing
// surface needs the ON-OFFER formats in the operator's order, and the admin
// console needs the retired ones too — an operator who withdraws a format has
// to be able to put it back. Both must not disagree about what the table said,
// so the read lives once, here, on the same admin client the rest of the
// academy plane uses (the tables are deny-all to the browser by RLS).

import { createAdminClient } from '@/lib/supabase/server';
import {
  ACADEMY_LAUNCH_FORMATS,
  orderFormats,
  type AcademyPricingFormat,
} from './pricing';

/**
 * The key shape the database enforces (20271800000000): lowercase, starts with
 * a letter, underscores and digits after that. The admin API refuses a key that
 * fails it rather than letting Postgres raise, because the key is written into
 * academy_applications and cannot be edited afterwards.
 */
export const FORMAT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export function isValidFormatKey(value: unknown): value is string {
  return typeof value === 'string' && FORMAT_KEY_PATTERN.test(value);
}

function rowToFormat(row: Record<string, unknown>): AcademyPricingFormat {
  return {
    key: String(row.key),
    label: String(row.label ?? ''),
    note: row.note == null ? null : String(row.note),
    sort_order: Number(row.sort_order ?? 0) || 0,
    is_active: row.is_active !== false,
    // numeric(12,2) arrives as a string from PostgREST on some drivers.
    default_price_ngn: Number(row.default_price_ngn ?? 0) || 0,
  };
}

/**
 * The managed formats, in the operator's order, plus whether the answer came
 * from the table or from the launch structure.
 *
 * `degraded: true` is the honest version of "the database would not answer":
 * the surfaces that quote tuition (the marketing catalogue) can then say the
 * format list is unconfirmed instead of presenting seeded copy as the
 * operator's wording.
 */
export async function tryGetTrainingFormats(
  opts: { includeInactive?: boolean } = {},
): Promise<{ formats: AcademyPricingFormat[]; degraded: boolean }> {
  const supabase = createAdminClient();
  try {
    const result = await supabase
      .from('academy_pricing_formats')
      .select('key, label, note, sort_order, is_active, default_price_ngn')
      .order('sort_order', { ascending: true });
    if (result.error) {
      console.warn('[academy/formats] catalogue unavailable, using the launch structure:', result.error.code ?? result.error.message);
      return { formats: fallbackFormats(opts), degraded: true };
    }
    const formats = orderFormats(((result.data ?? []) as Array<Record<string, unknown>>).map(rowToFormat));
    if (formats.length === 0) return { formats: fallbackFormats(opts), degraded: true };
    return {
      formats: opts.includeInactive ? formats : formats.filter((f) => f.is_active),
      degraded: false,
    };
  } catch (error) {
    console.warn('[academy/formats] catalogue read threw:', error);
    return { formats: fallbackFormats(opts), degraded: true };
  }
}

/**
 * The managed formats, in the operator's order.
 *
 * `includeInactive` adds the withdrawn ones — retired formats are never offered
 * to a new applicant but stay editable (and are what a past application's
 * wording resolves against).
 *
 * A database that has not run the migration yet, or whose read fails, returns
 * the launch structure rather than an empty list: an empty catalogue would
 * render an apply form with no tuition at all, and the pricing helpers would
 * then have nothing to price in. This is also what makes the deploy order
 * irrelevant — code may arrive before the migration does.
 */
export async function getTrainingFormats(
  opts: { includeInactive?: boolean } = {},
): Promise<AcademyPricingFormat[]> {
  return (await tryGetTrainingFormats(opts)).formats;
}

function fallbackFormats(opts: { includeInactive?: boolean }): AcademyPricingFormat[] {
  const launch = orderFormats(ACADEMY_LAUNCH_FORMATS);
  return opts.includeInactive ? launch : launch.filter((f) => f.is_active);
}

/**
 * Every stored price row for one format, per training — what a rename or a
 * re-order has to re-sync so the per-application read in
 * GET /api/academy/application still shows the wording that was charged.
 */
export async function syncFormatCopies(format: AcademyPricingFormat): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('academy_area_pricing_options')
    .update({
      label: format.label,
      note: format.note,
      sort_order: format.sort_order,
      updated_at: new Date().toISOString(),
    })
    .eq('key', format.key);
  if (error) {
    console.error('[academy/formats] label sync failed', { code: error.code, message: error.message, key: format.key });
    throw error;
  }
}

/**
 * Give every active training a price row for a newly created format, at that
 * format's default price. Idempotent against the (area_id, key) unique, so a
 * retry after a partial write cannot duplicate a price.
 */
export async function priceNewFormatEverywhere(format: AcademyPricingFormat): Promise<void> {
  const supabase = createAdminClient();
  const { data: areas, error: areasError } = await supabase
    .from('academy_interest_areas')
    .select('id')
    .eq('is_active', true);
  if (areasError) throw areasError;
  const rows = ((areas ?? []) as Array<{ id: string }>).map((area) => ({
    area_id: area.id,
    key: format.key,
    label: format.label,
    note: format.note,
    price_ngn: format.default_price_ngn,
    sort_order: format.sort_order,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('academy_area_pricing_options')
    .upsert(rows, { onConflict: 'area_id,key' });
  if (error) throw error;
}

/**
 * One format by key, exactly as stored (a retired one included — the delete
 * path has to see what it is about to remove). Null for an unknown key and
 * when the read failed, which callers must NOT read as "safe to change": the
 * writers distinguish the two with FormatReadError.
 */
export async function readFormat(key: string): Promise<AcademyPricingFormat | null> {
  const { row, error } = await readFormatRow(key);
  return error ? null : row;
}

class FormatReadFailure extends Error {}

/**
 * The same read, but a failed read THROWS instead of returning null: "I could
 * not check" and "there is nothing to check" must not reach the caller through
 * the same channel, because one of them means an irreversible delete is about
 * to be allowed on an unverified assumption.
 */
export async function readFormatForWrite(key: string): Promise<AcademyPricingFormat | null> {
  const { row, error } = await readFormatRow(key);
  if (error) throw new FormatReadFailure(error.message ?? 'format read failed');
  return row;
}

export function isFormatReadFailure(error: unknown): boolean {
  return error instanceof FormatReadFailure;
}

async function readFormatRow(
  key: string,
): Promise<{ row: AcademyPricingFormat | null; error: { message?: string; code?: string } | null }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_pricing_formats')
    .select('key, label, note, sort_order, is_active, default_price_ngn')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.warn('[academy/formats] single-format read failed', { key, code: error.code, message: error.message });
    return { row: null, error };
  }
  return { row: data ? rowToFormat(data as Record<string, unknown>) : null, error: null };
}

/** The Postgres error code, for the caller's 23505 / 23503 translations. */
export class FormatWriteError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Create a format row. `sort_order` is assigned by the caller (the route puts a
 * new format last) so this stays a plain write with the Postgres error passed
 * through rather than swallowed: a collision is the operator's to see.
 */
export async function insertFormat(format: AcademyPricingFormat): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('academy_pricing_formats').insert({
    key: format.key,
    label: format.label,
    note: format.note,
    sort_order: format.sort_order,
    is_active: format.is_active,
    default_price_ngn: format.default_price_ngn,
  });
  if (error) throw new FormatWriteError(error.message ?? 'insert failed', error.code);
}

/** Partial write: only the fields the caller sent. Key is addressed, not sent. */
export async function updateFormat(
  key: string,
  patch: Partial<Omit<AcademyPricingFormat, 'key'>>,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('academy_pricing_formats')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('key', key);
  if (error) throw new FormatWriteError(error.message ?? 'update failed', error.code);
}

export async function deleteFormatRow(key: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('academy_pricing_formats').delete().eq('key', key);
  if (error) throw new FormatWriteError(error.message ?? 'delete failed', error.code);
}

/** How many trainings carry a price row for this format (the FK restrictor). */
export async function countPricedTrainings(key: string): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from('academy_area_pricing_options')
    .select('area_id', { count: 'exact', head: true })
    .eq('key', key);
  if (error) throw new FormatWriteError(error.message ?? 'count failed', error.code);
  return Number(count ?? 0);
}

/**
 * How many applications were priced in this format — the number that decides
 * whether it may be deleted at all. academy_applications stores the key in
 * pricing_option_key and, for a multi-area application, in the
 * pricing_selections map, and the status screen resolves the wording a learner
 * was charged under from those rows.
 *
 * Both are matched in ONE query (an OR) so an application that names the format
 * twice is counted once, and the jsonb side is expanded per TRAINING SLUG rather
 * than scanned: the number of queries is bounded by the catalogue, not by the
 * application table. The containment object holds exactly one pair, which is
 * what lets it live inside an OR clause (the comma is the OR's separator), and
 * both slug and key are pattern-checked before they are interpolated.
 */
export async function countApplicationsUsingFormat(key: string): Promise<number | null> {
  if (!isValidFormatKey(key)) return null;
  const supabase = createAdminClient();
  const { data: areas, error: areasError } = await supabase
    .from('academy_interest_areas')
    .select('slug');
  if (areasError) {
    console.warn('[academy/formats] trainings unreadable, history unknown', areasError.code ?? areasError.message);
    return null;
  }
  const slugs = ((areas ?? []) as Array<{ slug: string }>)
    .map((a) => String(a.slug ?? ''))
    .filter((s) => /^[a-z0-9_]{1,64}$/.test(s));
  const conditions = [`pricing_option_key.eq.${key}`];
  for (const slug of slugs) conditions.push(`pricing_selections.cs.{"${slug}":"${key}"}`);
  const { count, error } = await supabase
    .from('academy_applications')
    .select('id', { count: 'exact', head: true })
    .or(conditions.join(','));
  if (error) {
    console.warn('[academy/formats] application-history read failed', error.code ?? error.message);
    return null;
  }
  return Number(count ?? 0);
}
