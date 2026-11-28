/**
 * POST /api/admin/voting/contest-templates/[templateId]/preview
 *
 * The transport for `buildPreview` (spec §5, D3, D4). Everything that can go wrong
 * with *pixels* is decided in `src/server/template-studio/preview.ts`; this file
 * owns only the three things a route owns:
 *
 * - **auth before anything else** — `votes:manage`, asserted before a client is
 *   created, so an unauthorised caller cannot make this endpoint read a row, fetch
 *   a template object, or burn CPU on a sample upload.
 * - **multipart parsing** — a preview is a file upload, so it gets the same
 *   boundary/truncation classification as the template create route
 *   (`classifyFormDataParseFailure`): a dropped connection answers 413 with the
 *   ceiling, not 500 with a parser stack.
 * - **the refusal → response mapping** — a refusal is JSON with `code` and a human
 *   sentence; a success is the image itself, with the blend outcome in two headers
 *   so the console can say "the light match did not run" without parsing pixels.
 *
 * It never writes: no asset row, no stored object, no job (D3). The response *is*
 * the product, which is also why `Cache-Control: no-store` — a studio that shows a
 * stale composite is showing an answer to a question nobody asked.
 */
import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { classifyFormDataParseFailure } from '@/src/lib/api/multipart-request';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { SLOT_COLUMNS, TEMPLATE_COLUMNS } from '@/src/server/registration/template-resolver';
import {
  MAX_SAMPLE_BYTES,
  buildPreview,
  type PreviewOverrides,
  type PreviewTemplateRow,
} from '@/src/server/template-studio/preview';

type RouteContext = { params: Promise<{ templateId: string }> };

/** Sharp needs the Node runtime, and a preview must never be a cached route. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Empty text and an absent field mean the same thing to the preview: "row decides". */
function text(form: FormData, name: string): string | null {
  const raw = form.get(name);
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/**
 * A nudge becomes a number or `NaN` — and `NaN` is deliberately *not* filtered out
 * here, because `buildPreview` refuses it as `override_not_a_number`. Treating a
 * typo as "no nudge" would silently move the portrait back to the template's own
 * placement, which is the kind of disagreement between form and render that D5
 * exists to prevent.
 */
function number(form: FormData, name: string): number | undefined {
  const raw = text(form, name);
  return raw === null ? undefined : Number(raw);
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;

    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      const verdict = classifyFormDataParseFailure(request.headers.get('content-type'), error, MAX_SAMPLE_BYTES);
      return errorResponse(verdict.message, verdict.status);
    }

    const sample = form.get('sample');
    const sampleBytes = sample instanceof Blob ? Buffer.from(await sample.arrayBuffer()) : null;

    const overrides: PreviewOverrides = {
      photoMode: text(form, 'photoMode'),
      blendPreset: text(form, 'blendPreset'),
      blendSettings: text(form, 'blendSettings'),
      xOffset: number(form, 'xOffset'),
      yOffset: number(form, 'yOffset'),
      scale: number(form, 'scale'),
    };

    const supabase = createAdminClient();
    const { data: template, error: templateError } = await supabase
      .from('contest_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('id', templateId)
      .maybeSingle();

    if (templateError) {
      console.error('[admin/voting/contest-templates/preview POST] template:', templateError.message);
      return errorResponse('Failed to load template', 500);
    }

    // A missing row still goes through `buildPreview`, which owns the sentence and
    // the code; only the slot read is skipped, because there is no template id to
    // read slots for.
    let slotRows: Record<string, unknown>[] = [];
    if (template) {
      const { data: rows, error: slotsError } = await supabase
        .from('template_slots')
        .select(SLOT_COLUMNS)
        .eq('template_id', templateId)
        .order('slot_order', { ascending: true });

      if (slotsError) {
        console.error('[admin/voting/contest-templates/preview POST] slots:', slotsError.message);
        return errorResponse('Failed to load template slots', 500);
      }
      slotRows = rows ?? [];
    }

    const result = await buildPreview({
      template: (template ?? null) as PreviewTemplateRow | null,
      slotRows,
      sampleBytes,
      overrides,
    });

    if (!result.ok) return errorResponse(result.error, result.status, result.code);

    return new NextResponse(Buffer.from(result.buffer) as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Cache-Control': 'no-store',
        'X-Blend-Applied': String(result.decisions.applied === true),
        // Percent-encoded so the header stays ASCII-safe: the record carries reason
        // strings an operator reads verbatim.
        'X-Render-Decisions': encodeURIComponent(JSON.stringify(result.decisions)),
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to render template preview');
  }
}
