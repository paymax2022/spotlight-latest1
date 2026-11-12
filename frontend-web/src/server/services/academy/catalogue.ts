// The Film Academy catalogue as PUBLIC surfaces read it: the admin-managed areas
// of study, the five priced formats each area carries, and the intakes a visitor
// could still join.
//
// GET /api/academy/apply answers the same questions for someone mid-application;
// this answers them for a signed-out visitor, from the same rows with the same
// filters, and returns no applicant data at all. Keeping the reads here means a
// marketing page can never quote a price or an intake that the application
// endpoint would reject.
//
// The areas tables are deny-all to the browser by RLS, so this runs on the
// admin client server-side and hands the page plain, already-priced rows.

import { createAdminClient } from '@/lib/supabase/server';
import { getActiveAcademySettings } from '@/src/server/services/academy';
import {
  ACADEMY_DELIVERABLES,
  ACADEMY_FEE_EXCLUSIONS,
  ACADEMY_PRICING_STRUCTURE,
  MAX_INTEREST_AREAS_PER_APPLICATION,
  attachPricingOptions,
  type AcademyPricingOption,
  type AreaPricingOptionRow,
} from './pricing';

export interface AcademyCatalogueArea {
  slug: string;
  label: string;
  description: string | null;
  pricing_options: AcademyPricingOption[];
}

type IntakeRow = {
  id: string;
  batch_name: string;
  start_date: string | null;
  training_schedule: string | null;
  duration_weeks: number | null;
  status: string | null;
  description: string | null;
};

export interface AcademyIntake extends IntakeRow {
  /**
   * The trainings this batch actually offers — possibly empty, which is real
   * information: a batch with no areas linked accepts no application.
   */
  areaSlugs: string[];
}

export interface AcademyCatalogue {
  areas: AcademyCatalogueArea[];
  intakes: AcademyIntake[];
  /** Format identity only; each area's own pricing_options carry the money. */
  pricingStructure: Array<Omit<AcademyPricingOption, 'price_ngn'>>;
  deliverables: string[];
  feeExclusions: string[];
  maxAreas: number;
  /** Null when the settings row could not be read — never assumed to be free. */
  settings: Awaited<ReturnType<typeof getActiveAcademySettings>> | null;
  /**
   * Fixed names of the reads that failed, so the page can say which part of the
   * catalogue is unconfirmed. Raw provider errors stay out of the response.
   */
  loadErrors: string[];
}

/**
 * An intake a visitor could still join: not completed, not cancelled, and not one
 * whose last scheduled week has already passed. A row with no dates is kept — the
 * admin may not have filled them in yet, and an undated intake is not evidence of
 * a finished one.
 */
export function isIntakeOpen(
  batch: Pick<IntakeRow, 'start_date' | 'duration_weeks' | 'status'>,
  today = new Date(),
): boolean {
  const status = String(batch.status ?? '').toLowerCase();
  if (status === 'completed' || status === 'cancelled') return false;

  if (!batch.start_date || !batch.duration_weeks || batch.duration_weeks <= 0) {
    return true;
  }

  const endDate = new Date(batch.start_date);
  endDate.setDate(endDate.getDate() + Number(batch.duration_weeks) * 7);
  endDate.setHours(23, 59, 59, 999);

  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  return endDate >= startOfToday;
}

export async function getAcademyCatalogue(): Promise<AcademyCatalogue> {
  const supabase = createAdminClient();
  const loadErrors: string[] = [];

  const { data: batchRows, error: batchError } = await supabase
    .from('academy_batches')
    .select('id, batch_name, start_date, training_schedule, duration_weeks, status, description')
    .order('start_date', { ascending: true });
  if (batchError) loadErrors.push('intakes');

  const openIntakes = ((batchRows ?? []) as IntakeRow[]).filter((batch) => isIntakeOpen(batch));

  const { data: areaRows, error: areaError } = await supabase
    .from('academy_interest_areas')
    .select('id, slug, label, description')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (areaError) loadErrors.push('areas');

  const { data: optionRows, error: optionError } = await supabase
    .from('academy_area_pricing_options')
    .select('area_id, key, label, note, price_ngn, sort_order');
  if (optionError) loadErrors.push('tuition');

  // A batch offers EXACTLY the trainings linked to it. An empty entry is that
  // batch offering nothing yet — not a query that failed.
  const areaSlugsByBatch: Record<string, string[]> = {};
  for (const intake of openIntakes) areaSlugsByBatch[intake.id] = [];
  if (openIntakes.length > 0) {
    const { data: linkRows, error: linkError } = await supabase
      .from('academy_batch_interest_areas')
      .select('batch_id, area_slug')
      .in('batch_id', openIntakes.map((intake) => intake.id));
    if (linkError) loadErrors.push('intake trainings');
    for (const row of (linkRows ?? []) as Array<{ batch_id: string; area_slug: string }>) {
      (areaSlugsByBatch[row.batch_id] ??= []).push(row.area_slug);
    }
  }

  const pricedAreas = attachPricingOptions(
    ((areaRows ?? []) as Array<{ id: string; slug: string; label: string; description: string | null }>).map(
      (area) => ({
        id: area.id,
        slug: String(area.slug),
        label: String(area.label),
        description: area.description ?? null,
      }),
    ),
    (optionRows ?? []) as AreaPricingOptionRow[],
  );
  // The uuid keyed the pricing rows — it is not part of any public contract.
  const areas = pricedAreas.map(({ id: _id, ...area }) => area);

  let settings: AcademyCatalogue['settings'] = null;
  try {
    settings = await getActiveAcademySettings();
  } catch (error) {
    console.warn('[academy/catalogue] settings unavailable:', error);
    loadErrors.push('fees');
  }

  return {
    areas,
    intakes: openIntakes.map((intake) => ({ ...intake, areaSlugs: areaSlugsByBatch[intake.id] ?? [] })),
    pricingStructure: ACADEMY_PRICING_STRUCTURE.map(({ key, label, note, sort_order }) => ({
      key,
      label,
      note,
      sort_order,
    })),
    deliverables: ACADEMY_DELIVERABLES,
    feeExclusions: ACADEMY_FEE_EXCLUSIONS,
    maxAreas: MAX_INTEREST_AREAS_PER_APPLICATION,
    settings,
    loadErrors,
  };
}
