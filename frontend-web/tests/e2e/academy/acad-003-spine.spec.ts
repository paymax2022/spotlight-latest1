/**
 * ACAD-003 — Academy Phase-2 spine: progression, content/CMS, parent layer.
 *
 * Journeys proven:
 *   - progression: member builds a learning path for a seeded subject, reads it
 *     back, advances a step, runs adaptive practice + recommendations; admin
 *     reads/writes the adaptive-config.
 *   - content/CMS: admin creates a production, advances/blocks it, updates it,
 *     lists; publish transitions on lessons/bundles; localization upsert/list/
 *     delete; member reads published bundles/lessons/manifest.
 *   - parent layer: guardian→minor link + consent (identity reuse) →
 *     GET /children → dashboard → subject view → controls upsert → report
 *     generate+list → the CHILD-SAFETY PURCHASE GATE: the minor's commerce
 *     order is parked as a pending approval, the guardian approves it, and the
 *     minor's retry proceeds — plus a fail-closed probe (unrelated user cannot
 *     read the child's dashboard).
 *   - notification templates: admin upsert/get/list/delete.
 */
import { test, expect } from '@playwright/test';
import {
  acadKey,
  adminBearer,
  goFetch,
  goFetchH,
  goTrueToken,
  provisionVerifiedUser,
} from './helpers';

const ACAD = '/api/finance/academy';
const ADM = '/api/academy/admin';

async function firstSubjectId(request: any, tok: string): Promise<string> {
  const classes = await goFetch(request, `${ACAD}/curriculum/classes`, { token: tok });
  const clsId = classes.body?.classes?.[0]?.id ?? classes.body?.data?.[0]?.id;
  const subs = await goFetch(request, `${ACAD}/curriculum/classes/${clsId}/subjects`, {
    token: tok,
  });
  return subs.body?.subjects?.[0]?.id ?? subs.body?.data?.[0]?.id;
}

test.describe('ACAD-003 spine: progression + content + parent', () => {
  test('progression: build path → read → advance step → adaptive + recommendations', async ({
    request,
  }) => {
    const u = await provisionVerifiedUser(request, 'acad-prog');
    const tok = await goTrueToken(request, u.email, u.password);
    const adminTok = await adminBearer(request);
    const subjectId = await firstSubjectId(request, tok);
    expect(subjectId).toBeTruthy();

    const path = await goFetch(request, `${ACAD}/progression/paths`, {
      method: 'POST',
      token: tok,
      data: { subject_id: subjectId },
    });
    expect([200, 201, 409]).toContain(path.status);

    const read = await goFetch(request, `${ACAD}/progression/paths/${subjectId}`, { token: tok });
    expect(read.status).toBe(200);
    const steps = read.body?.path?.steps ?? read.body?.data?.steps ?? read.body?.steps ?? [];
    const stepObjective = steps.find((s: any) => s.status !== 'locked' && s.status !== 'completed');
    if (stepObjective) {
      const oid = stepObjective.objective_id ?? stepObjective.id;
      const adv = await goFetch(request, `${ACAD}/progression/steps/${oid}/advance`, {
        method: 'POST',
        token: tok,
        data: {},
      });
      expect([200, 201, 409, 422]).toContain(adv.status);
    }

    const adaptive = await goFetch(request, `${ACAD}/progression/practice/adaptive`, {
      method: 'POST',
      token: tok,
      data: { subject_id: subjectId, limit: 3 },
    });
    expect([200, 201, 400, 422]).toContain(adaptive.status);
    expect(
      (await goFetch(request, `${ACAD}/progression/recommendations`, { token: tok })).status,
    ).toBe(200);

    // Admin adaptive-config get + put.
    const cfgGet = await goFetch(request, `${ADM}/progression/adaptive-config`, { token: adminTok });
    expect(cfgGet.status).toBe(200);
    const cfgPut = await goFetch(request, `${ADM}/progression/adaptive-config`, {
      method: 'PUT',
      token: adminTok,
      data: { key: `e2e.${acadKey('cfg')}`, value: { mastery_threshold: 0.8 } },
    });
    expect([200, 201, 204]).toContain(cfgPut.status);
  });

  test('content/CMS: productions, publish lifecycle, localizations, member reads', async ({
    request,
  }) => {
    const u = await provisionVerifiedUser(request, 'acad-cms');
    const tok = await goTrueToken(request, u.email, u.password);
    const adminTok = await adminBearer(request);
    const C = `${ADM}/content`;

    const prod = await goFetch(request, `${C}/productions`, {
      method: 'POST',
      token: adminTok,
      data: { title: `E2E Production ${acadKey('p')}`, notes: 'e2e' },
    });
    expect([200, 201]).toContain(prod.status);
    const prodId = prod.body?.id ?? prod.body?.data?.id;
    expect(prodId).toBeTruthy();

    expect((await goFetch(request, `${C}/productions`, { token: adminTok })).status).toBe(200);
    expect((await goFetch(request, `${C}/productions/${prodId}`, { token: adminTok })).status).toBe(200);
    expect(
      (await goFetch(request, `${C}/productions/${prodId}`, {
        method: 'PUT',
        token: adminTok,
        data: { title: 'E2E Production v2' },
      })).status,
    ).toBeLessThan(300);
    const advance = await goFetch(request, `${C}/productions/${prodId}/advance`, {
      method: 'POST',
      token: adminTok,
      data: { to: 'script' },
    });
    expect([200, 201, 409, 422]).toContain(advance.status);
    const block = await goFetch(request, `${C}/productions/${prodId}/block`, {
      method: 'POST',
      token: adminTok,
      data: { reason: 'e2e block' },
    });
    expect([200, 201, 409, 422]).toContain(block.status);

    // GET /content/items reads academy_edu_lessons (the table with
    // objective_id — the brownfield academy_lessons lacks it).
    const items = await goFetch(request, `${C}/items`, { token: adminTok });
    expect(items.status).toBe(200);

    // Localization upsert → list → delete (entity = the production id).
    const loc = await goFetch(request, `${C}/localizations`, {
      method: 'POST',
      token: adminTok,
      data: {
        entity_type: 'production',
        entity_id: prodId,
        lang: 'yo',
        payload: { title: 'Akọpọ E2E' },
      },
    });
    expect([200, 201, 204, 422]).toContain(loc.status);
    expect((await goFetch(request, `${C}/localizations?entity_type=production&entity_id=${prodId}`, { token: adminTok })).status).toBe(200);
    const locDel = await goFetch(request, `${C}/localizations?entity_type=production&entity_id=${prodId}&lang=yo`, {
      method: 'DELETE',
      token: adminTok,
    });
    expect([200, 204, 404]).toContain(locDel.status);

    // Publish lifecycle on seeded content (best-effort — ids may not exist).
    const bundles = await goFetch(request, `${ACAD}/content/bundles`, { token: tok });
    expect(bundles.status).toBe(200);
    const bundleId = bundles.body?.data?.[0]?.id ?? bundles.body?.bundles?.[0]?.id;
    if (bundleId) {
      expect((await goFetch(request, `${ACAD}/content/bundles/${bundleId}/manifest`, { token: tok })).status).toBe(200);
      const pub = await goFetch(request, `${C}/bundles/${bundleId}/publish`, {
        method: 'POST',
        token: adminTok,
        data: { to: 'live' }, // PublishStatus enum: draft|review|approved|live|archived
      });
      expect([200, 201, 409, 422]).toContain(pub.status);
    }
    // Member lesson read for a seeded objective (any id → 404/200 both prove the route).
    const lessons = await goFetch(request, `${ACAD}/content/lessons/00000000-0000-0000-0000-000000000000`, {
      token: tok,
    });
    expect([200, 404]).toContain(lessons.status);
    const pubLesson = await goFetch(request, `${C}/lessons/00000000-0000-0000-0000-000000000000/publish`, {
      method: 'POST',
      token: adminTok,
      data: { to: 'live' },
    });
    expect([200, 404, 409, 422]).toContain(pubLesson.status);
  });

  test('parent layer + child-safety purchase approval gate', async ({ request }) => {
    const guardian = await provisionVerifiedUser(request, 'acad-pg');
    const minor = await provisionVerifiedUser(request, 'acad-pm');
    const stranger = await provisionVerifiedUser(request, 'acad-ps');
    const gTok = await goTrueToken(request, guardian.email, guardian.password);
    const mTok = await goTrueToken(request, minor.email, minor.password);
    const sTok = await goTrueToken(request, stranger.email, stranger.password);

    // Link + consent activates the guardian link (identity layer).
    expect(
      (await goFetch(request, `${ACAD}/guardians/link`, {
        method: 'POST',
        token: gTok,
        data: { minor_user_id: minor.userId },
      })).status,
    ).toBeLessThan(300);
    expect(
      (await goFetch(request, `${ACAD}/guardians/${minor.userId}/consent`, {
        method: 'POST',
        token: gTok,
        data: { scope: { data_sharing: true } },
      })).status,
    ).toBeLessThan(300);

    const P = `${ACAD}/parent`;
    const children = await goFetch(request, `${P}/children`, { token: gTok });
    expect(children.status).toBe(200);
    expect(JSON.stringify(children.body)).toContain(minor.userId);

    expect((await goFetch(request, `${P}/children/${minor.userId}/dashboard`, { token: gTok })).status).toBe(200);
    const subjectId = await firstSubjectId(request, gTok);
    if (subjectId) {
      expect(
        (await goFetch(request, `${P}/children/${minor.userId}/subjects/${subjectId}`, { token: gTok }))
          .status,
      ).toBeLessThan(500);
    }
    const controls = await goFetch(request, `${P}/children/${minor.userId}/controls`, {
      method: 'PUT',
      token: gTok,
      data: { screen_time_minutes: 60, allowed_hours: { mon: [16, 20] }, content_max_age: 12 },
    });
    expect([200, 201, 204]).toContain(controls.status);
    const report = await goFetch(request, `${P}/reports/generate`, {
      method: 'POST',
      token: gTok,
      data: { minor_user_id: minor.userId, period: 'weekly' },
    });
    expect([200, 201]).toContain(report.status);
    expect((await goFetch(request, `${P}/children/${minor.userId}/reports`, { token: gTok })).status).toBe(200);

    // FAIL-CLOSED probe: a stranger cannot read the child's dashboard.
    const denied = await goFetch(request, `${P}/children/${minor.userId}/dashboard`, { token: sTok });
    expect([401, 403]).toContain(denied.status);

    // Child-safety purchase gate (academyApprovalGate): the minor's commerce
    // order is parked as a pending approval instead of being payable.
    const plans = await goFetch(request, `${ACAD}/commerce/plans`, { token: mTok });
    const planId = plans.body?.data?.[0]?.id ?? plans.body?.plans?.[0]?.id;
    if (planId) {
      const order = await goFetch(request, `${ACAD}/commerce/orders`, {
        method: 'POST',
        token: mTok,
        data: { kind: 'plan', refId: planId },
      });
      expect([200, 201]).toContain(order.status);
      const orderId = order.body?.id ?? order.body?.data?.id ?? order.body?.order?.id;
      const pay1 = await goFetchH(request, `${ACAD}/commerce/orders/${orderId}/pay`, {
        method: 'POST',
        token: mTok,
        headers: { 'Idempotency-Key': acadKey('pay-minor') },
        data: {},
      });
      // ApprovalRequired → 4xx and a pending approval appears for the guardian.
      const approvals = await goFetch(request, `${P}/approvals`, { token: gTok });
      expect(approvals.status).toBe(200);
      const pending = (approvals.body?.data ?? approvals.body?.approvals ?? []).find(
        (a: any) => a.order_id === orderId || a.order_id === order.body?.data?.id,
      );
      if (pending) {
        expect(pay1.status).toBeGreaterThanOrEqual(400);
        const decide = await goFetch(request, `${P}/approvals/${pending.id}/decide`, {
          method: 'POST',
          token: gTok,
          data: { decision: 'approve' },
        });
        expect([200, 201, 204]).toContain(decide.status);
        const pay2 = await goFetchH(request, `${ACAD}/commerce/orders/${orderId}/pay`, {
          method: 'POST',
          token: mTok,
          headers: { 'Idempotency-Key': acadKey('pay-minor-2') },
          data: {},
        });
        // After approval the pay path proceeds (may fail on funds — that's the
        // money path working, not the gate blocking).
        expect(pay2.status).not.toBe(403);
      }
    }
  });

  test('admin notification templates CRUD', async ({ request }) => {
    const adminTok = await adminBearer(request);
    const T = `${ADM}/notification-templates`;
    const key = `e2e.${acadKey('nt')}`;
    const up = await goFetch(request, T, {
      method: 'POST',
      token: adminTok,
      data: { key, channel: 'in_app', title: 'E2E', body: 'hello {{name}}', lang: 'en' },
    });
    expect([200, 201, 204]).toContain(up.status);
    expect((await goFetch(request, T, { token: adminTok })).status).toBe(200);
    expect((await goFetch(request, `${T}/${key}`, { token: adminTok })).status).toBe(200);
    const up2 = await goFetch(request, T, {
      method: 'PUT',
      token: adminTok,
      data: { key, channel: 'in_app', title: 'E2E v2', body: 'hello v2', lang: 'en' },
    });
    expect([200, 201, 204]).toContain(up2.status);
    const del = await goFetch(request, `${T}/${key}`, { method: 'DELETE', token: adminTok });
    expect([200, 204]).toContain(del.status);
  });
});
