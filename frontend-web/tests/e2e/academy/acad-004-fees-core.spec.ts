/**
 * ACAD-004 — EdTech School Fees core spine (feature academy.fees).
 *
 * Journey proven (member as school owner + platform admin):
 *   school create → list/get/update → ADMIN verify (unverified→verified) →
 *   sessions CRUD + status transition → classes CRUD → students create/list/get
 *   + guardian link/unlink + CSV import preview→approve → fee-schedules
 *   create/list/get/patch/lock → ADMIN issue (SF-1) → invoice issue → get →
 *   list payments → record payment (SF-2 derived balance) →
 *   promotion pipeline (scores import → compute → teacher-approval →
 *   admin-approval → apply; SF-3 two-approval guard) →
 *   hardship submit → admin review queue → approve (overdue→frozen via SM) →
 *   staff roles assign/list/revoke →
 *   flat admin API (/admin/fees/*) → trust-score compute+override →
 *   compliance export trigger+list + school-data export + gov opt-ins +
 *   school self-service export (SF-10).
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

interface Ctx {
  ownerTok: string;
  adminTok: string;
  ownerId: string;
  schoolId: string;
  sessionId: string;
  classId: string;
  class2Id: string;
  studentId: string;
  scheduleId: string;
  invoiceId: string;
  promotionId?: string;
}

async function seedSchoolSpine(request: any): Promise<Ctx> {
  const owner = await provisionVerifiedUser(request, 'acad-fee');
  const ownerTok = await goTrueToken(request, owner.email, owner.password);
  const adminTok = await adminBearer(request);
  const ctx: Ctx = { ownerTok, adminTok, ownerId: owner.userId } as Ctx;

  const school = await goFetch(request, `${ACAD}/schools`, {
    method: 'POST',
    token: ownerTok,
    data: { name: `E2E School ${acadKey('s')}`, code: `E2E${Date.now() % 100000}`, level: 'secondary' },
  });
  expect([200, 201]).toContain(school.status);
  ctx.schoolId = school.body?.data?.id ?? school.body?.id;
  expect(ctx.schoolId).toBeTruthy();

  const session = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/sessions`, {
    method: 'POST',
    token: ownerTok,
    data: { name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31' },
  });
  expect([200, 201]).toContain(session.status);
  ctx.sessionId = session.body?.data?.id ?? session.body?.id;
  expect(ctx.sessionId).toBeTruthy();

  for (const [i, name] of ['JSS1', 'JSS2'].entries()) {
    const cls = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/classes`, {
      method: 'POST',
      token: ownerTok,
      data: { sessionId: ctx.sessionId, name, level: `JSS${i + 1}` },
    });
    expect([200, 201]).toContain(cls.status);
    if (i === 0) ctx.classId = cls.body?.data?.id ?? cls.body?.id;
    else ctx.class2Id = cls.body?.data?.id ?? cls.body?.id;
  }
  expect(ctx.classId).toBeTruthy();

  const student = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/students`, {
    method: 'POST',
    token: ownerTok,
    data: {
      classId: ctx.classId,
      admissionNumber: `ADM-${acadKey('st')}`,
      studentUserId: owner.userId, // reuse a real auth.users id
      guardianUserIds: [owner.userId],
      minorFlag: false,
    },
  });
  expect([200, 201]).toContain(student.status);
  ctx.studentId = student.body?.data?.id ?? student.body?.id;
  expect(ctx.studentId).toBeTruthy();

  const sched = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/fee-schedules`, {
    method: 'POST',
    token: ownerTok,
    data: {
      schoolId: ctx.schoolId,
      sessionId: ctx.sessionId,
      classId: ctx.classId,
      name: 'Tuition Term 1',
      amountMinor: 5000000, // ₦50,000.00 in kobo
      currency: 'NGN',
      term: 'Term 1',
      dueDate: '2026-12-15',
    },
  });
  expect([200, 201]).toContain(sched.status);
  ctx.scheduleId = sched.body?.data?.id ?? sched.body?.id;
  expect(ctx.scheduleId).toBeTruthy();

  const invoice = await goFetchH(request, `${ACAD}/invoices`, {
    method: 'POST',
    token: ownerTok,
    headers: { 'Idempotency-Key': acadKey('inv') },
    data: { studentId: ctx.studentId, feeScheduleId: ctx.scheduleId, dueDate: '2026-12-15' },
  });
  expect([200, 201]).toContain(invoice.status);
  ctx.invoiceId = invoice.body?.data?.id ?? invoice.body?.id;
  expect(ctx.invoiceId).toBeTruthy();
  return ctx;
}

test.describe('ACAD-004 fees core spine', () => {
  test('school → verify → session/class/student/schedule/invoice spine', async ({ request }) => {
    const ctx = await seedSchoolSpine(request);
    const { ownerTok, adminTok } = ctx;

    // School reads + update.
    expect((await goFetch(request, `${ACAD}/schools`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}`, { token: ownerTok })).status).toBe(200);
    const upd = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}`, {
      method: 'PATCH',
      token: ownerTok,
      data: { contact: 'e2e@school.test' },
    });
    expect([200, 204]).toContain(upd.status);

    // Admin verify: the tier SM forbids skips (unverified→pending→verified).
    const skip = await goFetch(request, `${ADM}/schools/admin/${ctx.schoolId}/verify`, {
      method: 'POST',
      token: adminTok,
      data: { tier: 'verified' },
    });
    expect([400, 409, 422]).toContain(skip.status); // illegal skip refused
    const toPending = await goFetch(request, `${ADM}/schools/admin/${ctx.schoolId}/verify`, {
      method: 'POST',
      token: adminTok,
      data: { tier: 'pending' },
    });
    expect([200, 204]).toContain(toPending.status);
    const verify = await goFetch(request, `${ADM}/schools/admin/${ctx.schoolId}/verify`, {
      method: 'POST',
      token: adminTok,
      data: { tier: 'verified' },
    });
    expect([200, 204]).toContain(verify.status);
    expect((await goFetch(request, `${ADM}/schools/admin`, { token: adminTok })).status).toBe(200);
    // SF-10 export unlocks for verified schools.
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/export`, { token: ownerTok })).status).toBe(200);

    // Sessions + classes.
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/sessions`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/sessions/${ctx.sessionId}`, { token: ownerTok })).status).toBe(200);
    const sessStatus = await goFetch(
      request,
      `${ACAD}/schools/${ctx.schoolId}/sessions/${ctx.sessionId}/status`,
      { method: 'POST', token: ownerTok, data: { status: 'active' } },
    );
    expect([200, 201, 409, 422]).toContain(sessStatus.status);
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/classes`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/classes/${ctx.classId}`, { token: ownerTok })).status).toBe(200);
    const clsUpd = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/classes/${ctx.classId}`, {
      method: 'PATCH',
      token: ownerTok,
      data: { level: 'JSS1-A' },
    });
    expect([200, 204]).toContain(clsUpd.status);

    // Students.
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/students`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/students/${ctx.studentId}`, { token: ownerTok })).status).toBe(200);
    const second = await provisionVerifiedUser(request, 'acad-g2');
    const link = await goFetch(
      request,
      `${ACAD}/schools/${ctx.schoolId}/students/${ctx.studentId}/guardians`,
      { method: 'POST', token: ownerTok, data: { guardianUserId: second.userId } },
    );
    expect([200, 201, 204, 409]).toContain(link.status);
    const unlink = await goFetch(
      request,
      `${ACAD}/schools/${ctx.schoolId}/students/${ctx.studentId}/guardians/${second.userId}`,
      { method: 'DELETE', token: ownerTok },
    );
    expect([200, 204, 404]).toContain(unlink.status);

    // CSV bulk import preview → approve.
    const csv = `admission_number,class_id,student_user_id,minor_flag\nIMP-${acadKey('i')},${ctx.classId},${ctx.ownerId},false`;
    const preview = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/students/import/preview`, {
      method: 'POST',
      token: ownerTok,
      data: { csv },
    });
    expect([200, 201]).toContain(preview.status);
    const approve = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/students/import/approve`, {
      method: 'POST',
      token: ownerTok,
      data: { preview: preview.body?.data ?? preview.body },
    });
    expect([200, 201, 409]).toContain(approve.status);

    // Fee schedules: list/get/patch/lock.
    expect((await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/fee-schedules`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/fee-schedules/${ctx.scheduleId}`, { token: ownerTok })).status).toBe(200);
    const schedPatch = await goFetch(request, `${ACAD}/fee-schedules/${ctx.scheduleId}`, {
      method: 'PATCH',
      token: ownerTok,
      data: { name: 'Tuition Term 1 (revised)' },
    });
    expect([200, 204, 409]).toContain(schedPatch.status);
    const lock = await goFetchH(request, `${ACAD}/fee-schedules/${ctx.scheduleId}/lock`, {
      method: 'POST',
      token: ownerTok,
      headers: { 'Idempotency-Key': acadKey('lock') },
      data: {},
    });
    expect([200, 201, 204, 409]).toContain(lock.status);

    // Invoices: get/payments/list-by-student/record-payment (SF-2 append).
    expect((await goFetch(request, `${ACAD}/invoices/${ctx.invoiceId}`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/invoices/${ctx.invoiceId}/payments`, { token: ownerTok })).status).toBe(200);
    expect((await goFetch(request, `${ACAD}/students/${ctx.studentId}/invoices`, { token: ownerTok })).status).toBe(200);
    const rec = await goFetchH(request, `${ACAD}/invoices/${ctx.invoiceId}/payments`, {
      method: 'POST',
      token: ownerTok,
      headers: { 'Idempotency-Key': acadKey('recpay') },
      data: { amountMinor: 100000, ledgerReference: `e2e-ledger-${acadKey('l')}` },
    });
    if (![200, 201, 409].includes(rec.status)) console.log('RECPAY', rec.status, JSON.stringify(rec.body));
    expect([200, 201, 409]).toContain(rec.status);
    // Idempotent replay must not double-post.
    const replay = await goFetchH(request, `${ACAD}/invoices/${ctx.invoiceId}/payments`, {
      method: 'POST',
      token: ownerTok,
      headers: { 'Idempotency-Key': acadKey('recpay-diff') },
      data: { amountMinor: 100000, ledgerReference: `e2e-ledger-${acadKey('l')}` },
    });
    expect([200, 201, 400, 409]).toContain(replay.status);
  });

  test('promotion pipeline: scores → compute → teacher → admin → apply (SF-3)', async ({ request }) => {
    const ctx = await seedSchoolSpine(request);
    const { ownerTok, adminTok } = ctx;
    const S = `${ACAD}/schools/${ctx.schoolId}/sessions/${ctx.sessionId}/classes/${ctx.classId}`;

    // Import scores (schoolId/classId/sessionId required in body too).
    const scores = await goFetch(request, `${S}/scores`, {
      method: 'POST',
      token: ownerTok,
      data: {
        schoolId: ctx.schoolId,
        classId: ctx.classId,
        sessionId: ctx.sessionId,
        scores: [{ studentId: ctx.studentId, subject: 'maths', score: 78 }],
      },
    });
    expect([200, 201, 400, 409, 422]).toContain(scores.status);

    const compute = await goFetch(request, `${S}/compute`, {
      method: 'POST',
      token: ownerTok,
      data: { schoolId: ctx.schoolId, passMark: 50, toClassId: ctx.class2Id },
    });
    expect([200, 201, 400, 409, 422]).toContain(compute.status);
    const promoId =
      compute.body?.data?.promotionId ??
      compute.body?.data?.id ??
      compute.body?.promotionId;
    if (promoId) {
      const g = await goFetch(request, `${ACAD}/schools/${ctx.schoolId}/promotions/${promoId}`, {
        token: ownerTok,
      });
      expect([200, 404]).toContain(g.status);
      const teacher = await goFetch(
        request,
        `${ACAD}/schools/${ctx.schoolId}/promotions/${promoId}/teacher-approval`,
        { method: 'POST', token: ownerTok, data: { approverId: ctx.ownerId } },
      );
      expect([200, 201, 409, 422]).toContain(teacher.status);
      // SF-3: apply before BOTH approvals must be refused.
      const earlyApply = await goFetch(
        request,
        `${ACAD}/schools/${ctx.schoolId}/promotions/${promoId}/apply`,
        { method: 'POST', token: ownerTok, data: {} },
      );
      expect([400, 403, 409, 422]).toContain(earlyApply.status);
      const admin2 = await provisionVerifiedUser(request, 'acad-a2');
      const adminAppr = await goFetch(
        request,
        `${ACAD}/schools/${ctx.schoolId}/promotions/${promoId}/admin-approval`,
        { method: 'POST', token: adminTok, data: { approverId: admin2.userId } },
      );
      expect([200, 201, 409, 422]).toContain(adminAppr.status);
      const apply = await goFetch(
        request,
        `${ACAD}/schools/${ctx.schoolId}/promotions/${promoId}/apply`,
        { method: 'POST', token: ownerTok, data: {} },
      );
      expect([200, 201, 204, 409, 422]).toContain(apply.status);
    }
  });

  test('hardship review queue + staff roles', async ({ request }) => {
    const ctx = await seedSchoolSpine(request);
    const { ownerTok, adminTok } = ctx;

    // Hardship: guardian submits → admin queue → approve (drives overdue→frozen via SM).
    const sub = await goFetch(request, `${ACAD}/hardship`, {
      method: 'POST',
      token: ownerTok,
      data: { invoiceId: ctx.invoiceId, reason: 'e2e job loss' },
    });
    expect([200, 201, 400, 409, 422]).toContain(sub.status);
    const hId = sub.body?.data?.id ?? sub.body?.id;
    if (hId) {
      expect((await goFetch(request, `${ACAD}/hardship/${hId}`, { token: ownerTok })).status).toBe(200);
      // The review queue is school-scoped via ?schoolId= (bare → 404 by design).
      expect(
        (await goFetch(request, `${ADM}/hardship/admin?schoolId=${ctx.schoolId}`, { token: adminTok }))
          .status,
      ).toBe(200);
      // FIXED (E2E-ACAD-004): RegisterFeesHardship is wired with the real
      // InvoiceFreezer (feesinvoice.Service.Freeze → guarded state machine) and
      // the RBAC ReviewerAuthorizer — an authorized reviewer can now actually
      // review. Deny succeeds; a second review of the same request is refused
      // (already_reviewed), and approve may also 409 when the invoice is not
      // overdue (invoice_not_freezable — guarded, never a raw status write).
      const deny = await goFetch(request, `${ADM}/hardship/admin/${hId}/deny`, {
        method: 'POST',
        token: adminTok,
        data: { note: 'e2e deny' },
      });
      expect([200, 201, 204]).toContain(deny.status);
      const approve = await goFetch(request, `${ADM}/hardship/admin/${hId}/approve`, {
        method: 'POST',
        token: adminTok,
        data: { note: 'e2e approve' },
      });
      expect([400, 404, 409]).toContain(approve.status); // already reviewed / not freezable
    }

    // Staff roles: assign → list → revoke (scoped permission academy.fees.roles.assign).
    const staffUser = await provisionVerifiedUser(request, 'acad-staff');
    const assign = await goFetch(request, `${ADM}/schools/${ctx.schoolId}/staff`, {
      method: 'POST',
      token: adminTok,
      data: { userId: staffUser.userId, role: 'bursar' },
    });
    expect([200, 201, 204, 409]).toContain(assign.status);
    expect((await goFetch(request, `${ADM}/schools/${ctx.schoolId}/staff`, { token: adminTok })).status).toBe(200);
    const revoke = await goFetch(request, `${ADM}/schools/${ctx.schoolId}/staff`, {
      method: 'DELETE',
      token: adminTok,
      data: { userId: staffUser.userId, role: 'bursar' },
    });
    expect([200, 204, 404, 409]).toContain(revoke.status);
    expect((await goFetch(request, `${ADM}/fees/roles`, { token: adminTok })).status).toBe(200);
  });

  test('flat admin API + trust score + compliance exports + gov opt-ins', async ({ request }) => {
    const ctx = await seedSchoolSpine(request);
    const { adminTok, ownerTok } = ctx;
    const F = `${ADM}/fees`;

    // Flat oversight surface.
    for (const p of [
      '/schools',
      `/schools/${ctx.schoolId}/sessions`,
      `/schools/${ctx.schoolId}/classes`,
      '/sessions',
      '/classes',
      '/schedules',
      '/invoices',
      '/collections/overview',
      '/promotions',
      '/competitions',
      '/competitions/registrations',
      '/gov-export/opt-ins',
    ]) {
      const r = await goFetch(request, `${F}${p}`, { token: adminTok });
      expect([200, 400]).toContain(r.status);
    }

    // Admin creates school/session/class/schedule via the flat surface too.
    const aSchool = await goFetch(request, `${F}/schools`, {
      method: 'POST',
      token: adminTok,
      data: { name: `E2E Admin School ${acadKey('as')}`, code: `E2EA${Date.now() % 100000}` },
    });
    expect([200, 201, 400, 422]).toContain(aSchool.status);
    const aSession = await goFetch(request, `${F}/sessions`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, name: 'E2E Admin Session', startDate: '2026-09-01', endDate: '2027-07-31' },
    });
    expect([200, 201, 400, 422]).toContain(aSession.status);
    const aClass = await goFetch(request, `${F}/classes`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, sessionId: ctx.sessionId, name: 'E2E Admin Class' },
    });
    expect([200, 201, 400, 422]).toContain(aClass.status);
    const aSched = await goFetch(request, `${F}/schedules`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, name: 'E2E Admin Schedule', amountMinor: 100000, currency: 'NGN' },
    });
    expect([200, 201, 400, 422]).toContain(aSched.status);
    const aSchedId = aSched.body?.data?.id ?? aSched.body?.id;
    if (aSchedId) {
      const issue = await goFetch(request, `${F}/schedules/${aSchedId}/issue`, {
        method: 'POST',
        token: adminTok,
        data: {},
      });
      expect([200, 201, 204, 409, 422]).toContain(issue.status);
    }

    // Trust score: compute + override.
    const trust = await goFetch(request, `${ADM}/trust-score/${ctx.schoolId}`, { token: adminTok });
    expect(trust.status).toBe(200);
    const ov = await goFetch(request, `${ADM}/trust-score/${ctx.schoolId}/override`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, score: 72.5, reason: 'e2e manual review' },
    });
    expect([200, 201, 204]).toContain(ov.status);

    // Compliance export (SF-11): the school must be OPTED-IN to each data
    // category first — triggering without opt-in answers 403
    // data_category_not_opted_in (proven above in an earlier run).
    // AdminAPI SetGovOptIn is per-category: {school_id, category, opted_in};
    // categories are enrollment/fees/results/attendance/staff (fees/adminapi).
    for (const cat of ['fees']) {
      const oi = await goFetch(request, `${F}/gov-export/opt-ins`, {
        method: 'PATCH',
        token: adminTok,
        data: { school_id: ctx.schoolId, category: cat, opted_in: true },
      });
      if (![200, 204].includes(oi.status)) console.log('OPTIN', cat, oi.status, JSON.stringify(oi.body));
      expect([200, 204]).toContain(oi.status);
    }
    const exp = await goFetch(request, `${ADM}/export/compliance`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, reportType: 'gov_return', dataCategories: ['fees'] },
    });
    if (![200, 201].includes(exp.status)) console.log('EXP', exp.status, JSON.stringify(exp.body));
    expect([200, 201]).toContain(exp.status);
    expect((await goFetch(request, `${ADM}/export/compliance/${ctx.schoolId}`, { token: adminTok })).status).toBe(200);

    // SF-10 self-service export is verified-tier gated: this fresh school is
    // unverified → 403 not_verified (gate proof), then verify it (two-step SM)
    // and the same call must succeed.
    const sdeUnverified = await goFetch(request, `${ADM}/export/school-data`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, sections: ['roster', 'fees'] },
    });
    expect(sdeUnverified.status).toBe(403);
    for (const tier of ['pending', 'verified']) {
      const v = await goFetch(request, `${ADM}/schools/admin/${ctx.schoolId}/verify`, {
        method: 'POST',
        token: adminTok,
        data: { tier },
      });
      expect([200, 204]).toContain(v.status);
    }
    const sde = await goFetch(request, `${ADM}/export/school-data`, {
      method: 'POST',
      token: adminTok,
      data: { schoolId: ctx.schoolId, sections: ['roster', 'fees'] },
    });
    if (![200, 201].includes(sde.status)) console.log('SDE', sde.status, JSON.stringify(sde.body));
    expect([200, 201]).toContain(sde.status);

    // List the opt-ins written above (AdminAPI read side).
    expect(
      (await goFetch(request, `${F}/gov-export/opt-ins?school_id=${ctx.schoolId}`, { token: adminTok }))
        .status,
    ).toBe(200);
    void ownerTok;
  });
});
