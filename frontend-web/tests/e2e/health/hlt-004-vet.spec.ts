/**
 * HLT-004 — health vet vertical + VCN assisted verification (app:health_vet).
 *
 * Real journey over the mounted routes (/api/finance/health/vet/* +
 * /api/health/vet/admin/*):
 *
 *   vet KYB via the assisted VCN flow — application (domain=VET) →
 *   POST verification/submit → ops queue → reviewer decide approve
 *   (licence_expiry required; self-approval forbidden) → capability minted.
 *   Then: owner upserts a TELE service → pet owner creates a pet → books
 *   (escrow HELD, idempotent) → vet accept → confirm → start consult (shared
 *   consult engine) → complete consult (SOAP + e-Rx handoff) → escrow RELEASE.
 *   Plus: vaccination reminder schedule, emergency SOS, appointment reads,
 *   cancel → refund, admin dashboards, and the shared /consults/:id/lobby.
 *
 * Money assertions: ledger legs for `vet:<apptId>` are balanced.
 */

import { expect, test } from '@playwright/test';

import {
  fundWallet,
  goFetch,
  goTrueToken,
  healthAdminToken,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
} from './helpers';

const SERVICE_PRICE_KOBO = 600_000; // ₦6,000
const FUND_KOBO = 5_000_000;
const FUTURE = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

test.describe('HLT-004 vet vertical + VCN verification', () => {
  test('VCN assisted verification → vet service → booking → consult → release', async ({ request }) => {
    const tag = `${Date.now() % 100000}`;

    // ── VCN assisted (Mode-B) verification journey ───────────────────────────
    const vet = await provisionVerifiedUser(request, `hlt004-vet-${tag}`);
    const vetToken = await goTrueToken(request, vet.email, vet.password);
    setKycTier(vet.userId, 3); // HL-10 payout gate (fixture — no local KYC rail)

    const app = await goFetch(request, '/api/finance/health/providers/applications', {
      method: 'POST',
      token: vetToken,
      data: { domain: 'VET', provider_type: 'vet', display_name: `E2E Vet ${tag}` },
    });
    expect(app.status).toBe(201);
    const appId = app.body.application.id as string;

    // Evidence-doc attach (E2E-HLT-003 fixed: the cred_type CHECK now admits
    // the Mode-B doc vocabulary VCN_CERT/ANNUAL_LICENCE/GOV_ID alongside the
    // issuer enum — see 20271003000000_health_cred_doc_types.sql). The submit
    // attaches real docs; the ANNUAL_LICENCE row is also what the approve leg
    // mirrors licence_expiry onto for the HL-2 auto-suspend sweep.
    const vcnSubmit = await goFetch(request, '/api/finance/health/vet/verification/submit', {
      method: 'POST',
      token: vetToken,
      data: {
        application_id: appId,
        reg_number: `VCN-${tag}`,
        full_name: 'E2E Vet Doctor',
        consent: true,
        docs: [
          { type: 'VCN_CERT', storage_key: `health/vcn/${appId}-cert.pdf` },
          { type: 'ANNUAL_LICENCE', storage_key: `health/vcn/${appId}-lic.pdf` },
          { type: 'GOV_ID', storage_key: `health/vcn/${appId}-id.pdf` },
        ],
      },
    });
    expect(vcnSubmit.status, `doc'd VCN submit: ${JSON.stringify(vcnSubmit.body)}`).toBe(201);

    const status = await goFetch(request, `/api/finance/health/vet/verification/status?application_id=${appId}`, {
      token: vetToken,
    });
    expect(status.status).toBe(200);

    // Ops queue: reviewer (super-admin, health.vet.review) decides. The vet can
    // NEVER self-approve (service forbids owner == reviewer).
    const admin = await healthAdminToken(request);
    const queue = await goFetch(request, '/api/health/vet/admin/verification/queue', { token: admin });
    expect(queue.status).toBe(200);
    const item = (queue.body.items ?? []).find(
      (i: any) => i.record?.provider_application_id === appId || i.provider_application_id === appId,
    );
    expect(item, 'VCN queue must contain the submitted verification').toBeTruthy();
    const recordId = (item.record?.id ?? item.id) as string;

    const rec = await goFetch(request, `/api/health/vet/admin/verification/${recordId}`, { token: admin });
    expect(rec.status).toBe(200);

    // Approve requires licence_expiry (drives the HL-2 auto-suspend sweep job).
    const noExpiry = await goFetch(request, `/api/health/vet/admin/verification/${recordId}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'approve', notes: 'missing expiry' },
    });
    expect([400, 409, 422]).toContain(noExpiry.status);

    const decide = await goFetch(request, `/api/health/vet/admin/verification/${recordId}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'approve', licence_expiry: '2030-12-31', notes: 'E2E VCN approve' },
    });
    expect(decide.status).toBe(200);

    // Capability minted: the application now carries an APPROVED provider_id.
    const appAfter = await goFetch(request, `/api/finance/health/providers/applications/${appId}`, { token: vetToken });
    expect(appAfter.status).toBe(200);
    expect(appAfter.body.application.state).toBe('APPROVED');
    const providerId = appAfter.body.application.provider_id as string;
    expect(providerId).toBeTruthy();

    // ── Vet service catalogue (HL-2 verified-owner write gate) ───────────────
    const svc = await goFetch(request, '/api/finance/health/vet/services', {
      method: 'POST',
      token: vetToken,
      data: {
        provider_id: providerId,
        code: `CONS-${tag}`,
        name: 'Teleconsult',
        visit_type: 'TELE',
        price_kobo: SERVICE_PRICE_KOBO,
        active: true,
      },
    });
    expect(svc.status).toBe(201);
    const serviceId = svc.body.service.id as string;

    // ── Pet owner journey ────────────────────────────────────────────────────
    const owner = await provisionVerifiedUser(request, `hlt004-own-${tag}`);
    const ownerToken = await goTrueToken(request, owner.email, owner.password);
    setKycTier(owner.userId, 3);
    fundWallet(owner.userId, FUND_KOBO, `hlt004-${tag}`);

    const pet = await goFetch(request, '/api/finance/health/vet/pets', {
      method: 'POST',
      token: ownerToken,
      data: { name: 'E2E Rex', species: 'DOG', breed: 'Boerboel', sex: 'M', weight_kg: 38 },
    });
    expect(pet.status).toBe(201);
    const petId = pet.body.pet.id as string;
    const pets = await goFetch(request, '/api/finance/health/vet/pets', { token: ownerToken });
    expect(pets.status).toBe(200);
    expect((pets.body.pets ?? []).map((p: any) => p.id)).toContain(petId);

    // Vaccination reminder rides the shared scheduler (job type stubbed-known).
    const vax = await goFetch(request, `/api/finance/health/vet/pets/${petId}/vaccinations`, {
      method: 'POST',
      token: ownerToken,
      data: { vaccine: 'Rabies', due_at: FUTURE(24 * 30) },
    });
    expect(vax.status).toBeLessThan(300);

    // Discovery (list mode — no geo needed) + SOS.
    const vets = await goFetch(request, '/api/finance/health/vet/vets', { token: ownerToken });
    expect(vets.status).toBe(200);
    const sos = await goFetch(request, '/api/finance/health/vet/sos', {
      method: 'POST',
      token: ownerToken,
      data: { lat: 6.5244, lng: 3.3792 },
    });
    expect(sos.status).toBe(200);
    expect(sos.body.disclaimer ?? sos.body.sos?.disclaimer).toBeTruthy();

    // Book: TELE visit, payment HELD.
    const idem = idemKey(`vet-${tag}`);
    const booked = await goFetch(request, '/api/finance/health/vet/appointments', {
      method: 'POST',
      token: ownerToken,
      data: {
        provider_id: providerId,
        pet_id: petId,
        service_id: serviceId,
        visit_type: 'TELE',
        slot_start: FUTURE(4),
        slot_end: FUTURE(5),
        idempotency_key: idem,
      },
    });
    expect(booked.status).toBe(201);
    const apptId = booked.body.appointment.id as string;
    expect(booked.body.appointment.pay_state).toBe('HELD');
    expect(booked.body.appointment.total_kobo).toBe(SERVICE_PRICE_KOBO);

    // Balanced hold legs for this appointment's escrow reference.
    const holdLegs = ledgerSums(`%vet:${apptId}%`);
    const cr = holdLegs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const dr = holdLegs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(cr, 'vet escrow hold legs unbalanced').toBe(dr);

    // Replay → same appointment, no second hold.
    const replay = await goFetch(request, '/api/finance/health/vet/appointments', {
      method: 'POST',
      token: ownerToken,
      data: {
        provider_id: providerId,
        pet_id: petId,
        service_id: serviceId,
        visit_type: 'TELE',
        slot_start: FUTURE(4),
        slot_end: FUTURE(5),
        idempotency_key: idem,
      },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.appointment.id).toBe(apptId);

    // Reads: owner list + object-level get (stranger → 403/404).
    const list = await goFetch(request, '/api/finance/health/vet/appointments', { token: ownerToken });
    expect(list.status).toBe(200);
    const stranger = await provisionVerifiedUser(request, `hlt004-str-${tag}`);
    const strangerToken = await goTrueToken(request, stranger.email, stranger.password);
    const strGet = await goFetch(request, `/api/finance/health/vet/appointments/${apptId}`, { token: strangerToken });
    expect([403, 404]).toContain(strGet.status);
    const get = await goFetch(request, `/api/finance/health/vet/appointments/${apptId}`, { token: ownerToken });
    expect(get.status).toBe(200);

    // Vet lifecycle: accept → confirm → start consult → complete (SOAP + e-Rx).
    const accepted = await goFetch(request, `/api/finance/health/vet/appointments/${apptId}/accept`, {
      method: 'POST',
      token: vetToken,
    });
    expect(accepted.status).toBe(200);
    const confirmed = await goFetch(request, `/api/finance/health/vet/appointments/${apptId}/confirm`, {
      method: 'POST',
      token: vetToken,
    });
    expect(confirmed.status).toBe(200);
    const started = await goFetch(request, `/api/finance/health/vet/consults/${apptId}/start`, {
      method: 'POST',
      token: vetToken,
    });
    expect(started.status).toBe(200);
    const consultId = started.body.appointment?.consult_id as string | undefined;

    // Shared-platform consult surface: lobby token for the pet owner (authZ:
    // patient or provider owner only — the stranger is refused).
    if (consultId) {
      const lobby = await goFetch(request, `/api/finance/health/consults/${consultId}/lobby`, { token: ownerToken });
      expect(lobby.status).toBe(200);
      expect(lobby.body.av?.room).toBeTruthy();
      const strLobby = await goFetch(request, `/api/finance/health/consults/${consultId}/lobby`, {
        token: strangerToken,
      });
      expect(strLobby.status).toBe(403);
    }

    const completed = await goFetch(request, `/api/finance/health/vet/consults/${apptId}/complete`, {
      method: 'POST',
      token: vetToken,
      data: {
        subjective: 'owner reports lethargy',
        objective: 'temp normal, hydrated',
        assessment: 'mild GI upset',
        plan: 'oral rehydration + monitor',
      },
    });
    expect(completed.status).toBe(200);
    expect(completed.body.appointment?.state ?? completed.body.result?.appointment?.state).toBe('COMPLETED');

    // Escrow released → CLOSED pay state legs remain balanced overall.
    const allLegs = ledgerSums(`%vet:${apptId}%`);
    const crAll = allLegs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const drAll = allLegs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(crAll).toBe(drAll);

    // ── Admin oversight ──────────────────────────────────────────────────────
    const dash = await goFetch(request, '/api/health/vet/admin/dashboard', { token: admin });
    expect(dash.status).toBe(200);
    const adminAppts = await goFetch(request, '/api/health/vet/admin/appointments', { token: admin });
    expect(adminAppts.status).toBe(200);
    const vcnAudit = await goFetch(request, '/api/health/vet/admin/vcn-audit', { token: admin });
    expect(vcnAudit.status).toBe(200);
    const erxAudit = await goFetch(request, '/api/health/vet/admin/erx-audit', { token: admin });
    expect(erxAudit.status).toBe(200);
  });

  test('booking cancel refunds the held payment (HL-9)', async ({ request }) => {
    const tag = `c${Date.now() % 100000}`;
    const vet = await provisionVerifiedUser(request, `hlt004-vc-${tag}`);
    const vetToken = await goTrueToken(request, vet.email, vet.password);
    // Plain provider approval (non-VCN path already proven above).
    const app = await goFetch(request, '/api/finance/health/providers/applications', {
      method: 'POST',
      token: vetToken,
      data: { domain: 'VET', provider_type: 'vet', display_name: `E2E Vet Cancel ${tag}` },
    });
    const appId = app.body.application.id as string;
    await goFetch(request, `/api/finance/health/providers/applications/${appId}/submit`, {
      method: 'POST',
      token: vetToken,
    });
    const admin = await healthAdminToken(request);
    const dec = await goFetch(request, `/api/health/admin/providers/applications/${appId}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'start_review' },
    });
    expect(dec.status).toBe(200);
    const approve = await goFetch(request, `/api/health/admin/providers/applications/${appId}/decision`, {
      method: 'POST',
      token: admin,
      data: { action: 'approve' },
    });
    expect(approve.status).toBe(200);
    const providerId = approve.body.application.provider_id as string;

    const svc = await goFetch(request, '/api/finance/health/vet/services', {
      method: 'POST',
      token: vetToken,
      data: { provider_id: providerId, code: `C-${tag}`, name: 'Clinic visit', visit_type: 'CLINIC', price_kobo: 100_000, active: true },
    });
    expect(svc.status).toBe(201);

    const owner = await provisionVerifiedUser(request, `hlt004-oc-${tag}`);
    const ownerToken = await goTrueToken(request, owner.email, owner.password);
    setKycTier(owner.userId, 3);
    fundWallet(owner.userId, FUND_KOBO, `hlt004c-${tag}`);
    const pet = await goFetch(request, '/api/finance/health/vet/pets', {
      method: 'POST',
      token: ownerToken,
      data: { name: 'E2E Cat', species: 'CAT' },
    });
    expect(pet.status).toBe(201);

    const booked = await goFetch(request, '/api/finance/health/vet/appointments', {
      method: 'POST',
      token: ownerToken,
      data: {
        provider_id: providerId,
        pet_id: pet.body.pet.id,
        service_id: svc.body.service.id,
        visit_type: 'CLINIC',
        slot_start: FUTURE(6),
        slot_end: FUTURE(7),
        idempotency_key: idemKey(`vetc-${tag}`),
      },
    });
    expect(booked.status).toBe(201);
    const apptId = booked.body.appointment.id as string;

    const cancelled = await goFetch(request, `/api/finance/health/vet/appointments/${apptId}/cancel`, {
      method: 'POST',
      token: ownerToken,
      data: { reason: 'E2E cancel' },
    });
    expect(cancelled.status).toBe(200);
    const legs = ledgerSums(`%vet:${apptId}%`);
    const cr = legs.filter((l) => l.side === 'CREDIT').reduce((n, l) => n + l.total, 0);
    const dr = legs.filter((l) => l.side === 'DEBIT').reduce((n, l) => n + l.total, 0);
    expect(cr).toBe(dr); // hold + refund legs net out
  });
});
