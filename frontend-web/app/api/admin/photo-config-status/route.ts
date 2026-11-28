/**
 * `GET /api/admin/photo-config-status` — what an operator needs to know before
 * the first job can succeed, in the shape spec §7 fixes.
 *
 * This payload is names and verdicts. It never contains an environment value:
 * `provider.missingEnv` is a list of variable NAMES from the same array the
 * Cloudinary client checks, the queue figures come from counts, and every blocker
 * is a derived sentence rather than free text. An admin-role caller reading this
 * must not be able to use it as a secret dump.
 *
 * The reason it exists at all is defect-shaped: "the add-on is enabled on this
 * account" is not something an env var can prove, and until the feature was built
 * a missing prerequisite surfaced as a job that failed six times. So the surface
 * says which of the four things it can actually see are missing, and says
 * plainly which two it cannot see.
 *
 * `applications:review` is the permission this console already uses for the
 * registration review surface — the same operator who approves a contestant is
 * the one who needs to know why their portrait is not appearing. A narrower
 * permission would be a new entry in the RBAC seed and a grant on three roles,
 * which is a decision for the owner, not for this route.
 *
 * Task 12 added the two things P3 made knowable. `templates` censuses the stored
 * frame URLs through `templateImagePlan`, which is the same predicate the
 * compositor runs before it spends a fetch, and a census that fails is a blocker
 * rather than a 500, because this page exists to explain broken state. The read
 * arrives through the service-role client like every other admin route here, and
 * that matters for one field: the table's public SELECT policy only answers
 * `status = 'active'` rows, so `draftCount` is something only an admin read can
 * report. `blend` hands the console the renderer's own preset list, numeric
 * bounds and enums instead of letting the studio restate them in another package.
 */
import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { photoProviderConfig } from '@/src/lib/media/provider';
import { templateImagePlan } from '@/src/lib/media/template-image';
import { hasR2Config } from '@/src/lib/storage/r2';
import { BOUNDS, PRESETS, SHADOW_MODES } from '@/src/lib/rendering/blend/params';
import { createAdminClient } from '@/src/lib/supabase/server';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { photoJobSummary } from '@/src/server/photo-jobs/job-store';
import { PHOTO_MODES, SLOT_ANCHORS } from '@/src/server/template-studio/authoring';

export const dynamic = 'force-dynamic';

/**
 * How many rows the census looks at, and why the number is in the route rather
 * than left to Postgres: this read runs on every view of a diagnostics page, and
 * an unbounded `select` over a table an admin can add rows to without limit is a
 * page that gets slower on its own. `truncated` says when the cap was reached
 * instead of letting the counts quietly become "the first 500".
 */
const TEMPLATE_CENSUS_LIMIT = 500;

/** Refused rows are listed for the operator; the counts stay exact either way. */
const REFUSED_LIST_LIMIT = 20;

interface TemplateCensus {
  counted: boolean;
  activeCount: number;
  readableCount: number;
  draftCount: number;
  refused: { id: string; name: string; reason: string; host: string | null }[];
  /** Exact, unlike `refused`, which is the list a banner can render. */
  refusedCount: number;
  truncated: boolean;
  code?: string;
}

/**
 * Classify the stored template URLs without fetching any of them.
 *
 * `templateImagePlan` is the same predicate `readTemplateImage` runs before it
 * spends a request, so a row this reports as refused is a row the compositor will
 * refuse too — which is the whole P3 reason the census exists (P2's defect was a
 * URL shape no test had ever put through the real guard). Two failures it cannot
 * see — `http-status` and `not-fetchable` — are named in the payload's `note`
 * rather than guessed at, because the preview route is the surface that pays a
 * fetch and reports them.
 */
async function censusTemplates(supabase: ReturnType<typeof createAdminClient>): Promise<TemplateCensus> {
  const { data, error } = await supabase
    .from('contest_templates')
    .select('id, name, status, template_url')
    .in('status', ['active', 'draft'])
    .limit(TEMPLATE_CENSUS_LIMIT);

  if (error) {
    // A census that could not run is a blocker with a code, not a 500: this page is
    // how an operator finds out the feature is broken, and turning it into an error
    // page loses the provider and job verdicts it already had. `code` is the
    // Postgres SQLSTATE (`42P01` = the migration is not applied here), never the
    // message — the payload's rule is names and verdicts, not values.
    return {
      counted: false,
      activeCount: 0,
      readableCount: 0,
      draftCount: 0,
      refused: [],
      refusedCount: 0,
      truncated: false,
      code: error.code ?? 'unknown',
    };
  }

  const rows = data ?? [];
  const active = rows.filter((r) => r.status === 'active');
  const refused: TemplateCensus['refused'] = [];
  let readable = 0;
  let refusedCount = 0;

  for (const row of active) {
    const plan = templateImagePlan(row.template_url);
    if (plan.kind === 'refused') {
      refusedCount += 1;
      let host: string | null = null;
      try {
        host = new URL(String(row.template_url)).host;
      } catch {
        host = null;
      }
      if (refused.length < REFUSED_LIST_LIMIT) {
        refused.push({ id: row.id, name: row.name, reason: plan.reason, host });
      }
      continue;
    }
    readable += 1;
  }

  return {
    counted: true,
    activeCount: active.length,
    readableCount: readable,
    draftCount: rows.length - active.length,
    refused,
    refusedCount,
    truncated: rows.length === TEMPLATE_CENSUS_LIMIT,
  };
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');

    const provider = photoProviderConfig();
    const summary = await photoJobSummary();
    const templates = await censusTemplates(createAdminClient());
    const r2Configured = hasR2Config();
    const publicBaseUrlConfigured = Boolean(process.env.R2_PUBLIC_BASE_URL);
    const paused = summary.paused ?? 0;

    const blockers: string[] = [];
    if (!provider.configured) {
      blockers.push(`Photo provider credentials missing: ${provider.missing.join(', ')}`);
    }
    if (!r2Configured) {
      // The one blocker that stops the feature rather than degrading it: the
      // runner refuses to write a composite with no bucket, so every job would
      // fail at the store step and land on the retry ladder.
      blockers.push('R2 is not configured — composited output cannot be stored or presigned for the provider');
    }
    if (r2Configured && !publicBaseUrlConfigured) {
      blockers.push(
        'R2_PUBLIC_BASE_URL is empty — composited output is published through a signed URL that expires, so a cached page can outlive it',
      );
    }
    if (paused > 0) {
      blockers.push(`${paused} paused job(s) exhausted their retries and need operator review`);
    }
    if (!templates.counted) {
      blockers.push(
        `Stored templates could not be counted — the template read failed (code ${templates.code}). Apply the contest-photo migrations, then reload this page.`,
      );
    } else if (templates.refusedCount > 0) {
      // The blocker P2 could not raise: every job for these contests pastes the
      // portrait instead of compositing it, and nothing but this page says so
      // before a contestant notices. Reasons are deduplicated because the common
      // shape of this failure is one policy mistake repeated across every row, and they
      // are the reasons of the listed page — an exhaustive set would need the uncapped
      // array this cap exists to avoid.
      const reasons = [...new Set(templates.refused.map((r) => r.reason))].join(', ');
      const n = templates.refusedCount;
      blockers.push(
        `${n} active template${n === 1 ? ' has' : 's have'} a frame the image reader refuses (${reasons}), ` +
          `so ${n === 1 ? 'its contest' : 'their contests'} paste the portrait instead of compositing ` +
          `it — re-upload each frame into the contest-templates bucket, or edit the template URL to a ` +
          `public object on this project's own Supabase origin.`,
      );
    }

    return successResponse({
      provider: {
        configured: provider.configured,
        name: provider.name,
        // A cloud name is a public identifier: it is inside every delivery URL
        // the app already hands to anonymous voters. Naming it here tells an
        // operator which account the feature will actually call.
        cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? null,
        cloudNamePresent: !provider.missing.includes('CLOUDINARY_CLOUD_NAME'),
        missingEnv: provider.missing,
        extractionProbe: 'not_attempted',
        moderationProbe: 'not_attempted',
        probeNote:
          "The two vendor probes need a test asset the operator chooses. They are not run from this page: a diagnostic must not spend a paid call on a photograph nobody queued, and an add-on that is not enabled answers unknown rather than ok.",
      },
      storage: {
        r2Configured,
        publicBaseUrlConfigured,
        // What the runner's own first step needs: a URL the vendor can fetch for
        // an object that lives in a private bucket.
        presignForProvider: r2Configured ? 'available' : 'unavailable',
      },
      jobs: {
        queued: summary.queued ?? 0,
        processing: summary.processing ?? 0,
        paused,
        // Rows currently sitting on the retry ladder, not a time window: the
        // migration's summary function counts statuses, and inventing
        // `failedRecently` here would mean a number nothing computes.
        failed: summary.failed ?? 0,
      },
      templates: {
        ...templates,
        // Spec §7 asked this surface to say where its verdict came from, and the
        // honest answer is "the stored shape". `http-status` and `not-fetchable` —
        // an object deleted from the bucket, or a storage service that is down —
        // need the bytes read, which is what the studio's preview route pays for.
        source: 'url-shape',
        note:
          'Every verdict here is derived from the URL stored on the row, with no fetch: it is the same predicate the compositor runs before it spends a request. A frame that passes can still fail to download; the studio preview is where that answer comes from.',
      },
      blend: {
        // The renderer's own tables, passed through rather than restated, so the
        // console's selects and sliders cannot drift from what the compositor will
        // clamp to. `bounds` is the parity the studio depends on: a slider whose
        // max disagrees with `BOUNDS` lets an admin save a number that silently
        // renders as something else.
        presets: Object.keys(PRESETS),
        bounds: BOUNDS,
        modes: [...PHOTO_MODES],
        anchors: [...SLOT_ANCHORS],
        shadowModes: [...SHADOW_MODES],
      },
      blockers,
    });
  } catch (error) {
    // No special cases here: `handleApiError` already turns the FORBIDDEN and
    // UNAUTHORIZED sentinel errors from the admin gate into 403 and 401, and a
    // local branch for one of them would be a second policy for the same answer.
    return handleApiError(error, 'Failed to read photo configuration');
  }
}
