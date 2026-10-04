/**
 * HLT-001 — shared health platform surface (app:health).
 *
 * The web product has no health UI, so the shared platform journeys are
 * exercised at the real Go API surface — member /api/finance/health/* and the
 * RBAC-gated admin /api/health/admin/* — exactly what the mobile clients call.
 *
 * Journeys:
 *   - provider onboarding KYB: create application → credential → submit →
 *     admin decision approve (capability row minted) / reject on a second app
 *   - records vault: create → read (access-logged) → docs → access-log → erase
 *   - consent: grant → list → revoke
 *   - intake: admin publishes a schema → member fetches → submits a response
 *   - scheduling: request appointment → transition → reschedule → cancel
 *   - e-prescriptions: issue → send → begin-verify → verify → dispense
 *
 * Fixture-only: psql is used ONLY for read assertions (provider row status).
 */

import { expect, test } from '@playwright/test';

import {
  goFetch,
  goTrueToken,
  healthAdminToken,
  onboardProvider,
  providerStatus,
  provisionVerifiedUser,
} from './helpers';

const FUTURE = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

test.describe('HLT-001 shared health platform', () => {
  test('provider onboarding KYB: application → credential → submit → admin approve + reject', async ({ request }) => {
    const owner = await provisionVerifiedUser(request, 'hlt001-prov');
    const ownerToken = await goTrueToken(request, owner.email, owner.password);

    // Create DRAFT application (PHARMACY/pharmacist).
    const created = await goFetch(request, '/api/finance/health/providers/applications', {
      method: 'POST',
      token: ownerToken,
      data: { domain: 'PHARMACY', provider_type: 'pharmacist', display_name: 'E2E Shared Pharmacy' },
    });
    expect(created.status).toBe(201);
    const appId = created.body.application.id as string;
    expect(created.body.application.state).toBe('DRAFT');

    // List + read back (owner-scoped).
    const list = await goFetch(request, '/api/finance/health/providers/applications', { token: ownerToken });
    expect(list.status).toBe(200);
    expect((list.body.applications ?? []).map((a: any) => a.id)).toContain(appId);
    const got = await goFetch(request, `/api/finance/health/providers/applications/${appId}`, { token: ownerToken });
    expect(got.status).toBe(200);
    expect(got.body.application.display_name).toBe('E2E Shared Pharmacy');

    // Credential vault (storage_key ref — blob presign is separately covered).
    const cred = await goFetch(request, `/api/finance/health/providers/applications/${appId}/credentials`, {
      method: 'POST',
      token: ownerToken,
      data: { cred_type: 'PCN', reference_no: 'PCN-E2E-001', storage_key: `health/credentials/${appId}.pdf` },
    });
    expect(cred.status).toBe(201);

    // Submit DRAFT → SUBMITTED.
    const submitted = await goFetch(request, `/api/finance/health/providers/applications/${appId}/submit`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.application.state).toBe('SUBMITTED');

    // Admin: start_review → approve mints the APPROVED capability row.
    const admin = await healthAdminToken(request);
    const review = await goFetch(request, `/api/health/admin/providers/applications/${appId}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'start_review', note: 'E2E review' },
    });
    expect(review.status).toBe(200);
    expect(review.body.application.state).toBe('UNDER_REVIEW');

    const approved = await goFetch(request, `/api/health/admin/providers/applications/${appId}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'approve', note: 'E2E approve' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.application.state).toBe('APPROVED');
    const providerId = approved.body.application.provider_id as string;
    expect(providerId).toBeTruthy();
    expect(providerStatus(providerId).split('|')[0]).toBe('APPROVED');

    // A second application rejected by admin → no capability minted.
    const app2 = await goFetch(request, '/api/finance/health/providers/applications', {
      method: 'POST',
      token: ownerToken,
      data: { domain: 'VET', provider_type: 'vet', display_name: 'E2E Reject Vet' },
    });
    expect(app2.status).toBe(201);
    const app2Id = app2.body.application.id as string;
    const sub2 = await goFetch(request, `/api/finance/health/providers/applications/${app2Id}/submit`, {
      method: 'POST',
      token: ownerToken,
    });
    expect(sub2.status).toBe(200);
    const review2 = await goFetch(request, `/api/health/admin/providers/applications/${app2Id}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'start_review', note: 'E2E review' },
    });
    expect(review2.status).toBe(200);
    const rejected = await goFetch(request, `/api/health/admin/providers/applications/${app2Id}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'reject', note: 'E2E reject — insufficient docs' },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.application.state).toBe('REJECTED');
  });

  test('records vault: create → read → docs → access-log → erase, consent gate enforced', async ({ request }) => {
    const patient = await provisionVerifiedUser(request, 'hlt001-pat');
    const patientToken = await goTrueToken(request, patient.email, patient.password);
    const other = await provisionVerifiedUser(request, 'hlt001-oth');
    const otherToken = await goTrueToken(request, other.email, other.password);

    const created = await goFetch(request, '/api/finance/health/records', {
      method: 'POST',
      token: patientToken,
      data: { subject_type: 'PATIENT', record_type: 'NOTE', title: 'E2E record', body: 'e2e body' },
    });
    expect(created.status).toBe(201);
    const recordId = created.body.record.id as string;

    // Stranger is consent-blocked (HL-8); owner read succeeds + is access-logged.
    const forbidden = await goFetch(request, `/api/finance/health/records/${recordId}`, { token: otherToken });
    expect([401, 403, 404]).toContain(forbidden.status);
    const got = await goFetch(request, `/api/finance/health/records/${recordId}`, { token: patientToken });
    expect(got.status).toBe(200);
    expect(got.body.record.title).toBe('E2E record');

    const doc = await goFetch(request, `/api/finance/health/records/${recordId}/docs`, {
      method: 'POST',
      token: patientToken,
      data: { storage_key: `health/records/${recordId}.pdf`, content_type: 'application/pdf', label: 'scan' },
    });
    expect(doc.status).toBe(201);

    const log = await goFetch(request, `/api/finance/health/records/${recordId}/access-log`, { token: patientToken });
    expect(log.status).toBe(200);

    // Consent grant → the stranger can now read (consent-checked path).
    const grant = await goFetch(request, '/api/finance/health/consent', {
      method: 'POST',
      token: patientToken,
      data: { action: 'grant', grantee_id: other.userId, subject_owner_id: patient.userId, scope: 'RECORDS' },
    });
    expect(grant.status).toBe(201);
    const consentId = grant.body.consent.id as string;
    const consents = await goFetch(request, '/api/finance/health/consent', { token: patientToken });
    expect(consents.status).toBe(200);
    expect((consents.body.consents ?? []).map((c: any) => c.id)).toContain(consentId);
    const granted = await goFetch(request, `/api/finance/health/records/${recordId}`, { token: otherToken });
    expect(granted.status).toBe(200);

    // Revoke → consent gate closed again.
    const revoke = await goFetch(request, '/api/finance/health/consent', {
      method: 'POST',
      token: patientToken,
      data: { action: 'revoke', consent_id: consentId },
    });
    expect(revoke.status).toBe(200);
    const blocked = await goFetch(request, `/api/finance/health/records/${recordId}`, { token: otherToken });
    expect([403, 404]).toContain(blocked.status);

    // Right-to-erasure (owner only).
    const erased = await goFetch(request, `/api/finance/health/records/${recordId}`, {
      method: 'DELETE',
      token: patientToken,
    });
    expect(erased.status).toBe(200);
    const afterErase = await goFetch(request, `/api/finance/health/records/${recordId}`, { token: patientToken });
    expect([403, 404]).toContain(afterErase.status);
  });

  test('intake: admin publishes schema → member fetches + submits a validated response', async ({ request }) => {
    const member = await provisionVerifiedUser(request, 'hlt001-int');
    const token = await goTrueToken(request, member.email, member.password);
    const admin = await healthAdminToken(request);
    const slug = `e2e-intake-${Date.now()}`;

    const schema = await goFetch(request, '/api/health/admin/intake/schemas', {
      method: 'POST',
      token: admin,
      data: {
        slug,
        version: 1,
        kind: 'SYMPTOM',
        fields: [
          { name: 'complaint', type: 'text', required: true },
          { name: 'duration_days', type: 'number', required: false },
        ],
      },
    });
    expect(schema.status).toBe(201);
    const schemaId = schema.body.schema.id as string;

    const fetched = await goFetch(request, `/api/finance/health/intake/${schemaId}`, { token });
    expect(fetched.status).toBe(200);
    expect(fetched.body.schema.slug).toBe(slug);

    // Unknown field is rejected by the exact-version validator.
    const bad = await goFetch(request, `/api/finance/health/intake/${schemaId}/responses`, {
      method: 'POST',
      token,
      data: { answers: { complaint: 'fever', smuggled: 'x' } },
    });
    expect(bad.status).toBe(400);

    const ok = await goFetch(request, `/api/finance/health/intake/${schemaId}/responses`, {
      method: 'POST',
      token,
      data: { answers: { complaint: 'fever', duration_days: 3 } },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.response.schema_version).toBe(1);
  });

  test('scheduling: request → transition → reschedule → cancel lifecycle', async ({ request }) => {
    const owner = await provisionVerifiedUser(request, 'hlt001-own');
    const ownerToken = await goTrueToken(request, owner.email, owner.password);
    const { providerId } = await onboardProvider(request, ownerToken, {
      domain: 'PHARMACY',
      providerType: 'pharmacy',
      displayName: 'E2E Sched Provider',
    });
    const patient = await provisionVerifiedUser(request, 'hlt001-sch');
    const token = await goTrueToken(request, patient.email, patient.password);

    const slotStart = FUTURE(48);
    const slotEnd = FUTURE(49);
    const booked = await goFetch(request, '/api/finance/health/appointments', {
      method: 'POST',
      token,
      data: {
        provider_id: providerId,
        subject_type: 'PATIENT',
        visit_type: 'TELE',
        slot_start: slotStart,
        slot_end: slotEnd,
      },
    });
    expect(booked.status).toBe(201);
    const apptId = booked.body.appointment.id as string;
    expect(booked.body.appointment.state).toBe('REQUESTED');

    const mine = await goFetch(request, '/api/finance/health/appointments', { token });
    expect(mine.status).toBe(200);
    expect((mine.body.appointments ?? []).map((a: any) => a.id)).toContain(apptId);

    // REQUESTED → ACCEPTED.
    const accepted = await goFetch(request, `/api/finance/health/appointments/${apptId}/transition`, {
      method: 'POST',
      token,
      data: { state: 'ACCEPTED' },
    });
    expect(accepted.status).toBe(200);
    // ACCEPTED → CONFIRMED.
    const confirmed = await goFetch(request, `/api/finance/health/appointments/${apptId}/transition`, {
      method: 'POST',
      token,
      data: { state: 'CONFIRMED' },
    });
    expect(confirmed.status).toBe(200);

    // CONFIRMED → RESCHEDULED → CONFIRMED: the dedicated reschedule edge moves
    // the slot and re-confirms atomically, landing back on CONFIRMED.
    const newStart = FUTURE(72);
    const newEnd = FUTURE(73);
    const resched = await goFetch(request, `/api/finance/health/appointments/${apptId}/reschedule`, {
      method: 'POST',
      token,
      data: { slot_start: newStart, slot_end: newEnd },
    });
    expect(resched.status).toBe(200);
    expect(resched.body.appointment.state).toBe('CONFIRMED');
    expect(new Date(resched.body.appointment.slot_start).getTime()).toBe(new Date(newStart).getTime());

    // CONFIRMED → CANCELLED.
    const cancelled = await goFetch(request, `/api/finance/health/appointments/${apptId}/transition`, {
      method: 'POST',
      token,
      data: { state: 'CANCELLED' },
    });
    expect(cancelled.status).toBe(200);
  });

  test('e-prescriptions: issue → send → begin-verify → verify → dispense lifecycle', async ({ request }) => {
    const prescriber = await provisionVerifiedUser(request, 'hlt001-doc');
    const prescriberToken = await goTrueToken(request, prescriber.email, prescriber.password);
    const patient = await provisionVerifiedUser(request, 'hlt001-rx');
    const pharmacist = await provisionVerifiedUser(request, 'hlt001-pharm');
    const pharmacistToken = await goTrueToken(request, pharmacist.email, pharmacist.password);
    // The send edge pins a real pharmacy provider (FK) — onboard one.
    const { providerId: rxPharmacyId } = await onboardProvider(request, pharmacistToken, {
      domain: 'PHARMACY',
      providerType: 'pharmacy',
      displayName: 'E2E Rx Pharmacy',
    });

    const issued = await goFetch(request, '/api/finance/health/prescriptions', {
      method: 'POST',
      token: prescriberToken,
      data: {
        patient_id: patient.userId,
        items: [{ drug_name: 'Amoxicillin 500mg', nafdac_ref: 'NAF-E2E-1', dosage: '500mg TID', quantity: 21 }],
      },
    });
    expect(issued.status).toBe(201);
    const rxId = issued.body.prescription.id as string;
    expect(issued.body.prescription.state).toBe('ISSUED');

    // Controlled items are refused at write (HL-4).
    const controlled = await goFetch(request, '/api/finance/health/prescriptions', {
      method: 'POST',
      token: prescriberToken,
      data: {
        patient_id: patient.userId,
        items: [{ drug_name: 'Tramadol 100mg', nafdac_ref: 'NAF-CTL', is_controlled: true, quantity: 10 }],
      },
    });
    expect(controlled.status).toBe(400);

    const read = await goFetch(request, `/api/finance/health/prescriptions/${rxId}`, { token: prescriberToken });
    expect(read.status).toBe(200);

    const sent = await goFetch(request, `/api/finance/health/prescriptions/${rxId}/send`, {
      method: 'POST',
      token: prescriberToken,
      data: { pharmacy_provider_id: rxPharmacyId },
    });
    expect(sent.status).toBe(200);
    expect(sent.body.prescription.state).toBe('SENT_TO_PHARMACY');

    // begin+decision is ONE call: begin moves SENT→VERIFYING, then approve lands
    // the pharmacist verdict VERIFYING→VERIFIED (HL-3).
    const verified = await goFetch(request, `/api/finance/health/prescriptions/${rxId}/verify`, {
      method: 'POST',
      token: pharmacistToken,
      data: { begin: true, approve: true },
    });
    expect(verified.status).toBe(200);
    expect(verified.body.prescription.state).toBe('VERIFIED');

    // Reject path on a second Rx: begin + approve=false → REJECTED with reason.
    const issued2 = await goFetch(request, '/api/finance/health/prescriptions', {
      method: 'POST',
      token: prescriberToken,
      data: {
        patient_id: patient.userId,
        items: [{ drug_name: 'Cetirizine 10mg', nafdac_ref: 'NAF-E2E-2', quantity: 10 }],
      },
    });
    expect(issued2.status).toBe(201);
    const rx2 = issued2.body.prescription.id as string;
    await goFetch(request, `/api/finance/health/prescriptions/${rx2}/send`, {
      method: 'POST',
      token: prescriberToken,
      data: { pharmacy_provider_id: rxPharmacyId },
    });
    const rejected = await goFetch(request, `/api/finance/health/prescriptions/${rx2}/verify`, {
      method: 'POST',
      token: pharmacistToken,
      data: { begin: true, approve: false, reason: 'E2E interaction concern' },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.prescription.state).toBe('REJECTED');

    const dispensed = await goFetch(request, `/api/finance/health/prescriptions/${rxId}/dispense`, {
      method: 'POST',
      token: pharmacistToken,
    });
    expect(dispensed.status).toBe(200);
    expect(dispensed.body.prescription.state).toBe('DISPENSED');

    // Dispense-once is an idempotent edge (HL-3): a second call hits the
    // same-state short-circuit and returns the already-dispensed Rx unchanged —
    // never a second fill (dispensed_at is set once; the partial UNIQUE index
    // is the DB backstop).
    const twice = await goFetch(request, `/api/finance/health/prescriptions/${rxId}/dispense`, {
      method: 'POST',
      token: pharmacistToken,
    });
    expect(twice.status).toBe(200);
    expect(twice.body.prescription.state).toBe('DISPENSED');
  });
});
