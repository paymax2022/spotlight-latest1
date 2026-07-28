// ── Merchant Onboarding — API wrapper (mock-first) ───────────────────────────
// Typed data layer the screens code against. Mirrors crowdfunding.api.ts and
// doctor.api.ts: USE_MOCK-flagged, in-memory stateful store so the full
// create → draft → submit → review → approve flow runs without a live backend.
//
// TODO(live): flip USE_MOCK=false and point each function at the Go endpoints
//   GET  /api/v1/onboarding/modules
//   GET  /api/v1/onboarding/modules/:id/merchant-types
//   GET  /api/v1/onboarding/merchant-types/:id/form-schema
//   POST /api/v1/onboarding/applications          (create draft)
//   PATCH/api/v1/onboarding/applications/:id       (save draft)
//   POST /api/v1/onboarding/applications/:id/submit | /resubmit
//   GET  /api/v1/me/capabilities
// passing the Idempotency-Key header on every mutation.

import { api } from '@/api/client';
import { Colors } from '@/constants/colors';
import { applyEvent } from '../lib/applicationStateMachine';
import {
  FORM_SCHEMAS,
  MERCHANT_MODULES,
  MERCHANT_TYPES,
} from '../constants/merchant.constants';
import type {
  ApplicationData,
  CreateApplicationInput,
  FormSchema,
  MerchantModule,
  MerchantProfile,
  MerchantType,
  MyCapabilities,
  OnboardingApplication,
  ResubmitApplicationInput,
  SaveDraftInput,
  SubmitApplicationInput,
} from '@/types/merchant';

// Mock by default; flip with EXPO_PUBLIC_MERCHANT_USE_MOCK=false to hit the Go
// backend (/api/v1/onboarding/*, /api/v1/me/capabilities). Matches the house
// convention used by fx/doctor/realtor/mobility feature APIs.
const USE_MOCK = (process.env.EXPO_PUBLIC_MERCHANT_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();
const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── In-memory store (mock) ──────────────────────────────────────────────────

const ME_USER_ID = 'usr-amaka';

const SEED_SELLER_PROFILE: MerchantProfile = {
  id: 'mp-seller-1', userId: ME_USER_ID, moduleId: 'mod-marketplace', moduleName: 'Marketplace',
  merchantTypeId: 'mt-seller', merchantTypeName: 'Marketplace Seller', icon: 'ShoppingBag',
  roleGranted: 'marketplace_seller', status: 'ACTIVE', activatedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
  workspaceRoute: '/services/marketplace',
};

const db: {
  profiles: MerchantProfile[];
  applications: OnboardingApplication[];
} = {
  profiles: [SEED_SELLER_PROFILE],
  applications: [],
};

// ─── Validation (client mirrors server — FR-12) ──────────────────────────────
// Pure implementation lives in ../lib/validation; re-exported so existing
// screen imports from this module keep working.
export { isFieldVisible, validateStep } from '../lib/validation';
import { validateStep as _validateStep } from '../lib/validation';

function validateAll(schema: FormSchema, data: ApplicationData): Record<string, string> {
  return schema.steps.reduce<Record<string, string>>((acc, step) => {
    const { errors } = _validateStep(step, data);
    return { ...acc, ...errors };
  }, {});
}

// ─── Catalogue reads (FR-5, FR-6, FR-8) ──────────────────────────────────────

export async function listModules(): Promise<MerchantModule[]> {
  if (USE_MOCK) { await delay(); return MERCHANT_MODULES; }
  const res = await api.get('/api/v1/onboarding/modules');
  return res.data.data;
}

export async function listMerchantTypes(moduleId: string): Promise<MerchantType[]> {
  if (USE_MOCK) { await delay(); return MERCHANT_TYPES.filter((t) => t.moduleId === moduleId && t.status === 'open'); }
  const res = await api.get(`/api/v1/onboarding/modules/${moduleId}/merchant-types`);
  return res.data.data;
}

export async function getMerchantType(typeId: string): Promise<MerchantType> {
  if (USE_MOCK) {
    await delay(150);
    const t = MERCHANT_TYPES.find((x) => x.id === typeId);
    if (!t) throw new Error('Merchant type not found');
    return t;
  }
  const res = await api.get(`/api/v1/onboarding/merchant-types/${typeId}`);
  return res.data.data;
}

export async function getFormSchema(schemaId: string): Promise<FormSchema> {
  if (USE_MOCK) {
    await delay(150);
    const s = FORM_SCHEMAS[schemaId];
    if (!s) throw new Error('Form schema not found');
    return s;
  }
  const res = await api.get(`/api/v1/onboarding/form-schemas/${schemaId}`);
  return res.data.data;
}

// ─── Capabilities (FR-25 / FR-26) ────────────────────────────────────────────

export async function getMyCapabilities(): Promise<MyCapabilities> {
  if (USE_MOCK) {
    await delay();
    const active = db.applications.filter((a) =>
      ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO'].includes(a.status),
    );
    return {
      userId: ME_USER_ID,
      displayName: 'Amaka Obi',
      kycTier: 2,
      customer: {
        id: 'cap-customer', kind: 'customer', label: 'Customer',
        sublabel: 'Personal account', icon: 'UserRound', status: 'active', route: '/(tabs)/home',
      },
      merchants: db.profiles,
      activeApplications: active,
    };
  }
  const res = await api.get('/api/v1/me/capabilities');
  return res.data.data;
}

// ─── Applications (FR-7, FR-11, FR-12, §7.2) ─────────────────────────────────

const ACTIVE_STATES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO'];

export async function getApplication(id: string): Promise<OnboardingApplication> {
  if (USE_MOCK) {
    await delay(150);
    const app = db.applications.find((a) => a.id === id);
    if (!app) throw new Error('Application not found');
    return app;
  }
  const res = await api.get(`/api/v1/onboarding/applications/${id}`);
  return res.data.data;
}

export async function createApplication(input: CreateApplicationInput): Promise<OnboardingApplication> {
  if (USE_MOCK) {
    await delay();
    const type = MERCHANT_TYPES.find((t) => t.id === input.merchantTypeId);
    if (!type) throw new Error('Merchant type not found');

    // FR-7 / §11: block a duplicate active application or an existing active profile.
    const dupeProfile = db.profiles.find((p) => p.merchantTypeId === type.id && p.status === 'ACTIVE');
    if (dupeProfile) throw new Error('DUPLICATE_PROFILE');
    const dupeApp = db.applications.find((a) => a.merchantTypeId === type.id && ACTIVE_STATES.includes(a.status));
    if (dupeApp) return dupeApp; // resume the existing draft instead of creating a second

    const schema = FORM_SCHEMAS[type.currentFormSchemaId];
    const app: OnboardingApplication = {
      id: uid('app'), userId: ME_USER_ID,
      merchantTypeId: type.id, merchantTypeName: type.name,
      moduleId: type.moduleId, moduleName: type.moduleName,
      formSchemaId: schema.id, formSchemaVersion: schema.version,
      status: 'DRAFT', data: {}, checks: [],
      createdAt: nowISO(), updatedAt: nowISO(),
    };
    db.applications.push(app);
    return app;
  }
  const res = await api.post('/api/v1/onboarding/applications', input);
  return res.data.data;
}

export async function saveDraft(input: SaveDraftInput): Promise<OnboardingApplication> {
  if (USE_MOCK) {
    await delay();
    const app = db.applications.find((a) => a.id === input.applicationId);
    if (!app) throw new Error('Application not found');
    app.data = input.data;
    app.updatedAt = nowISO();
    return app;
  }
  const res = await api.patch(`/api/v1/onboarding/applications/${input.applicationId}`, { data: input.data });
  return res.data.data;
}

function runChecks(): OnboardingApplication['checks'] {
  return [
    { key: 'bvn', label: 'BVN identity match', status: 'passed' },
    { key: 'nin', label: 'NIN verification', status: 'passed' },
    { key: 'credential', label: 'Credential register lookup', status: 'pending', detail: 'Queued with the issuing body.' },
  ];
}

export async function submitApplication(input: SubmitApplicationInput): Promise<OnboardingApplication> {
  if (USE_MOCK) {
    await delay(500);
    const app = db.applications.find((a) => a.id === input.applicationId);
    if (!app) throw new Error('Application not found');
    const schema = FORM_SCHEMAS[app.formSchemaId];
    const errors = validateAll(schema, input.data);
    if (Object.keys(errors).length > 0) throw new Error('VALIDATION_FAILED');

    app.data = input.data;
    app.status = applyEvent(app.status, 'submit'); // DRAFT -> SUBMITTED
    app.checks = runChecks();
    app.submittedAt = nowISO();
    app.updatedAt = nowISO();
    // Demo: auto-advance SUBMITTED → UNDER_REVIEW shortly after (checks "picked up").
    setTimeout(() => { if (app.status === 'SUBMITTED') app.status = 'UNDER_REVIEW'; }, 1500);
    return app;
  }
  const res = await api.post(
    `/api/v1/onboarding/applications/${input.applicationId}/submit`,
    { data: input.data },
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return res.data.data;
}

export async function resubmitApplication(input: ResubmitApplicationInput): Promise<OnboardingApplication> {
  if (USE_MOCK) {
    await delay(500);
    const app = db.applications.find((a) => a.id === input.applicationId);
    if (!app) throw new Error('Application not found');
    app.data = input.data;
    app.status = applyEvent(app.status, 'resubmit'); // NEEDS_MORE_INFO -> UNDER_REVIEW
    app.infoChecklist = undefined;
    app.decisionReason = null;
    app.updatedAt = nowISO();
    return app;
  }
  const res = await api.post(
    `/api/v1/onboarding/applications/${input.applicationId}/resubmit`,
    { data: input.data },
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return res.data.data;
}

// ─── Demo-only helpers (drive the QA happy path; no live equivalent) ─────────

/** Simulates an admin approval so the capability switcher updates in the demo. */
export async function __demoApprove(applicationId: string): Promise<void> {
  const app = db.applications.find((a) => a.id === applicationId);
  if (!app) return;
  app.status = 'APPROVED';
  app.decidedAt = nowISO();
  const type = MERCHANT_TYPES.find((t) => t.id === app.merchantTypeId);
  // Idempotent role grant (§9): only add the profile once.
  if (type && !db.profiles.some((p) => p.merchantTypeId === type.id)) {
    db.profiles.push({
      id: uid('mp'), userId: ME_USER_ID, moduleId: type.moduleId, moduleName: type.moduleName,
      merchantTypeId: type.id, merchantTypeName: type.name, icon: type.icon,
      roleGranted: type.roleToGrant, status: 'ACTIVE', activatedAt: nowISO(),
      workspaceRoute: type.id === 'mt-doctor' ? '/(doctor)/(tabs)/dashboard' : '/services/marketplace',
    });
  }
}
