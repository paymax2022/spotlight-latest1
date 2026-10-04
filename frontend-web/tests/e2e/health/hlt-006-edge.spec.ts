/**
 * HLT-006 — edge surface: auth gates + flag-gated modules.
 *
 * (a) Anonymous probes on the mounted health surfaces → 401 before any
 *     handler runs (the finance group carries mapsAuth + requireUserID; the
 *     admin groups carry RequireAuthContext + per-route RBAC).
 * (b) Flag-gated modules — the running container has these flags OFF, so the
 *     routes are NOT mounted: every probe must 404 (route absent), never
 *     a 5xx or a misleading 401 that would mean a mounted-but-broken chain:
 *       FEATURE_HEALTH_TRIAGE_ENABLED          → /api/finance/health/triage/*
 *       FEATURE_HEALTH_INTAKE_ENABLED          → pre-consult /intake/appointments/*
 *       FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED→ /health/pharmacy/symptom-search
 *       FEATURE_NUTRITION_ENABLED              → /api/finance/nutrition/*
 *       FEATURE_DOCTOR_ENABLED                 → /api/v1/doctor/*
 *       FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED → emergency dispatch trio
 * (c) AuthZ probe: a non-admin member token on the admin RBAC surfaces → 403.
 */

import { expect, test } from '@playwright/test';

import { goFetch, goTrueToken, provisionVerifiedUser } from './helpers';

const MEMBER_PROBES: Array<[string, string]> = [
  ['GET', '/api/finance/health/providers/applications'],
  ['POST', '/api/finance/health/records'],
  ['GET', '/api/finance/health/consent'],
  ['POST', '/api/finance/health/appointments'],
  ['GET', '/api/finance/health/pharmacy/products'],
  ['POST', '/api/finance/health/pharmacy/orders'],
  ['GET', '/api/finance/health/lab/tests'],
  ['POST', '/api/finance/health/lab/orders'],
  ['GET', '/api/finance/health/vet/pets'],
  ['POST', '/api/finance/health/vet/appointments'],
  ['POST', '/api/finance/support/sessions'],
];

const ADMIN_PROBES: Array<[string, string]> = [
  ['GET', '/api/health/pharmacy/admin/orders'],
  ['GET', '/api/health/lab/admin/orders'],
  ['GET', '/api/health/vet/admin/appointments'],
  ['POST', '/api/health/admin/intake/schemas'],
];

const FLAG_GATED_PROBES: Array<[string, string, string]> = [
  // [method, path, flag]
  ['POST', '/api/finance/health/triage/sessions', 'FEATURE_HEALTH_TRIAGE_ENABLED'],
  ['GET', '/api/finance/health/triage/profiles', 'FEATURE_HEALTH_TRIAGE_ENABLED'],
  ['GET', '/api/health/triage/admin/escalations', 'FEATURE_HEALTH_TRIAGE_ENABLED'],
  ['GET', '/api/finance/health/intake/appointments/any/doctor-summary', 'FEATURE_HEALTH_INTAKE_ENABLED'],
  ['POST', '/api/finance/health/pharmacy/symptom-search', 'FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED'],
  ['GET', '/api/health/pharmacy/admin/symptom/metrics', 'FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED'],
  ['GET', '/api/finance/nutrition/dishes/any', 'FEATURE_NUTRITION_ENABLED'],
  ['GET', '/api/nutrition/admin/payouts', 'FEATURE_NUTRITION_ENABLED'],
  ['GET', '/api/v1/doctor/profile', 'FEATURE_DOCTOR_ENABLED'],
  ['GET', '/api/v1/doctor/appointments', 'FEATURE_DOCTOR_ENABLED'],
  ['GET', '/api/health/doctor/admin/verification/queue', 'FEATURE_DOCTOR_ENABLED'],
  ['POST', '/api/v1/doctor/emergency/escalate/ambulance', 'FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED'],
];

test.describe('HLT-006 edge: auth gates + flag-gated routes', () => {
  test('anonymous requests are refused 401 on every mounted health surface', async ({ request }) => {
    for (const [method, path] of MEMBER_PROBES) {
      const res = await goFetch(request, path, { method });
      expect(res.status, `${method} ${path} should refuse anonymous`).toBe(401);
    }
    for (const [method, path] of ADMIN_PROBES) {
      const res = await goFetch(request, path, { method });
      expect(res.status, `${method} ${path} should refuse anonymous`).toBe(401);
    }
  });

  test('a non-admin member token is refused 403 on the admin RBAC surfaces', async ({ request }) => {
    const member = await provisionVerifiedUser(request, 'hlt006');
    const token = await goTrueToken(request, member.email, member.password);
    for (const [method, path] of ADMIN_PROBES) {
      const res = await goFetch(request, path, { method, token });
      expect(res.status, `${method} ${path} should refuse non-admin`).toBe(403);
    }
  });

  test('flag-off modules are unmounted (404), never a misleading status', async ({ request }) => {
    const member = await provisionVerifiedUser(request, 'hlt006-f');
    const token = await goTrueToken(request, member.email, member.password);
    for (const [method, path, flag] of FLAG_GATED_PROBES) {
      const res = await goFetch(request, path, { method, token });
      expect(res.status, `${method} ${path} (${flag} off) must 404 — got ${res.status}`).toBe(404);
    }
  });
});
