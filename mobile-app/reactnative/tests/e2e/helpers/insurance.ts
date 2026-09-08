import type { Page } from '@playwright/test';

/**
 * Contract-shaped stubs for `/api/v1/insurance/*`.
 *
 * The payloads below are REAL MyCover records — product ids, underwriters,
 * prices, cover periods and the Sovereign Trust comprehensive-motor field table
 * are copied from the live catalog and from
 * `GET /v2/public-product-details/{id}` (see docs/prd/Insurance/MYCOVER-API-MAP.md),
 * translated into the internal contract by the backend's rules: naira → integer
 * kobo, rates → basis points.
 *
 * Stubbing here is about determinism, not convenience: these tests assert that
 * the UI renders the CONTRACT correctly — that a rate is never drawn as a naira
 * amount, that a 20-field motor schema becomes a short sequence of steps, that
 * an empty policy list is honest about being empty. Pointing them at a live
 * catalog would make them fail whenever an insurer retires a plan.
 */

// ── Products ────────────────────────────────────────────────────────────────
/** Sovereign Trust comprehensive motor — a real 20-field schema. */
export const STI_COMPREHENSIVE = {
  code: 'sti-comprehensive',
  name: 'Comprehensive Auto',
  description: 'Comprehensive motor cover for private and commercial vehicles.',
  product_line: 'auto',
  category: 'Auto',
  underwriter: 'Sovereign Trust Insurance Plc',
  underwriter_logo_url: null,
  aggregator: 'mycover',
  base_price_kobo: 500,
  is_percentage: true,
  rate_bps: 500, // 5% of the declared vehicle value
  sum_insured_kobo: 0,
  cover_period_days: 365,
  is_renewable: true,
  is_claimable: true,
  is_certificateable: true,
  key_benefits_html:
    '<ul><li>Accidental damage to your vehicle</li><li>Fire and theft</li><li>Third-party property damage up to ₦1,000,000</li></ul>',
  full_benefits_html: '<p>Full comprehensive cover underwritten by Sovereign Trust Insurance Plc.</p>',
  how_it_works_html: '<p>Buy online, get your certificate the same day.</p>',
  how_to_claim_html: '<p>Report the incident within 48 hours and submit an inspection.</p>',
  active: true,
  purchasable: true,
  family_code: 'sti',
  provider_product_id: 'b0d0f39c-0b8a-452f-a876-78bef8de3347',
};

/** Bastion FlexiCare Mini — a real flat-priced health plan. */
export const BASTION_FLEXICARE_MINI = {
  code: 'bastion-flexicare-mini',
  name: 'FlexiCare Mini',
  description: 'Everyday health cover — consultations, tests and hospital cash.',
  product_line: 'health',
  category: 'Health',
  underwriter: 'Bastion Health',
  underwriter_logo_url: null,
  aggregator: 'mycover',
  base_price_kobo: 400_000, // ₦4,000 — the real compute-price result at payment_plan 1
  is_percentage: false,
  rate_bps: 0,
  sum_insured_kobo: 25_000_000,
  cover_period_days: 30,
  is_renewable: true,
  is_claimable: true,
  is_certificateable: true,
  key_benefits_html:
    '<ul><li>Unlimited GP consultations</li><li>Malaria and typhoid tests</li><li>Hospital cash for overnight stays</li></ul>',
  full_benefits_html: '<p>Primary care cover from Bastion Health.</p>',
  how_it_works_html: '<p>Pick a plan, answer a few questions, and you are covered.</p>',
  how_to_claim_html: '<p>Present your policy number at any partner hospital.</p>',
  active: true,
  purchasable: true,
  family_code: 'bastion',
  provider_product_id: '5c1b1a48-7f45-4b1a-9c15-2f3d1e6a9b01',
};

export const BASTION_FLEXICARE = {
  ...BASTION_FLEXICARE_MINI,
  code: 'bastion-flexicare',
  name: 'FlexiCare',
  base_price_kobo: 900_000,
  sum_insured_kobo: 75_000_000,
  provider_product_id: '5c1b1a48-7f45-4b1a-9c15-2f3d1e6a9b02',
};

/** One of the seven plans MyCover cannot currently issue. */
export const BROKEN_PLAN = {
  ...BASTION_FLEXICARE_MINI,
  code: 'coronation-life-cover',
  name: 'Life Cover',
  product_line: 'life',
  category: 'Life',
  underwriter: 'Coronation Insurance Plc',
  base_price_kobo: 250_000,
  family_code: 'coronation',
  purchasable: false,
  provider_config_status: "Product sharing formula doesn't exist",
  provider_product_id: '9a2f5c31-1d84-4a02-bb70-77c4e1d2f5aa',
};

export const GOODS_IN_TRANSIT = {
  code: 'sti-git-annual',
  name: 'Annual Goods In Transit',
  description: 'Annual goods in transit cover.',
  product_line: 'package',
  category: 'Package',
  underwriter: 'Sovereign Trust Insurance Plc',
  underwriter_logo_url: null,
  aggregator: 'mycover',
  base_price_kobo: 50,
  is_percentage: true,
  rate_bps: 50, // 0.5% — the value that must never render as "₦0.50"
  sum_insured_kobo: 0,
  cover_period_days: 365,
  is_renewable: true,
  is_claimable: true,
  is_certificateable: true,
  key_benefits_html: '<p>Cover for goods while they are being moved.</p>',
  full_benefits_html: '',
  how_it_works_html: '',
  how_to_claim_html: '',
  active: true,
  purchasable: true,
  family_code: 'sti',
  provider_product_id: '6e417faa-e042-4768-8d5d-916fd531a478',
};

/**
 * Third-party bike — a genuinely short schema, so the dependent make/model pair
 * lands on a single page. It exists to test the dependency itself rather than
 * the step navigation that would otherwise stand between a test and the field.
 */
export const STI_BIKE = {
  ...STI_COMPREHENSIVE,
  code: 'sti-third-party-bike',
  name: 'Third Party Bike',
  description: 'Third-party cover for motorcycles.',
  base_price_kobo: 300_000,
  is_percentage: false,
  rate_bps: 0,
  provider_product_id: 'c1d2e3f4-0000-4a02-bb70-77c4e1d2f501',
};

export const CATALOG = [
  BASTION_FLEXICARE_MINI,
  BASTION_FLEXICARE,
  STI_COMPREHENSIVE,
  GOODS_IN_TRANSIT,
  STI_BIKE,
  BROKEN_PLAN,
];

// ── Schemas ─────────────────────────────────────────────────────────────────
/** The real Bastion health field table, in contract form. */
export const BASTION_SCHEMA = {
  fields: [
    { name: 'first_name', label: 'First name', type: 'text', required: true, min_length: 2 },
    { name: 'last_name', label: 'Last name', type: 'text', required: true, min_length: 2 },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone_number', label: 'Phone number', type: 'phone', required: true },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date', required: true, max_date: 'today' },
    {
      name: 'gender',
      label: 'Gender',
      type: 'select',
      required: true,
      options: [
        { value: 'Male', label: 'Male' },
        { value: 'Female', label: 'Female' },
      ],
    },
    { name: 'nin', label: 'NIN', type: 'nin', required: true, min_length: 11, max_length: 11 },
    { name: 'image_url', label: 'Passport photo', type: 'image', required: true },
    { name: 'payment_plan', label: 'Payment plan', type: 'number', required: true, min: 1, max: 12 },
    { name: 'product_id', label: 'Product', type: 'text', required: true, hidden: true },
  ],
};

/** Short enough to render on one page, so the dependency is immediately visible. */
export const BIKE_SCHEMA = {
  fields: [
    { name: 'vehicle_make', label: 'Vehicle make', type: 'select', required: true, remote_options: true },
    {
      name: 'vehicle_model',
      label: 'Vehicle model',
      type: 'select',
      required: true,
      remote_options: true,
      depends_on: { field: 'vehicle_make', query_param: true },
    },
    { name: 'value', label: 'Vehicle value', type: 'money', required: true, min: 1_000_000, unit: 'naira' },
    { name: 'product_id', label: 'Product', type: 'text', required: true, hidden: true },
  ],
};

/** A dependent-dropdown schema — vehicle_model is empty until a make is chosen. */
export const MOTOR_SCHEMA = {
  fields: [
    { name: 'first_name', label: 'First name', type: 'text', required: true, min_length: 2 },
    { name: 'last_name', label: 'Last name', type: 'text', required: true, min_length: 2 },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone_number', label: 'Phone number', type: 'phone', required: true },
    { name: 'address', label: 'Address', type: 'address', required: true, min_length: 6 },
    { name: 'vehicle_make', label: 'Vehicle make', type: 'select', required: true, remote_options: true },
    {
      name: 'vehicle_model',
      label: 'Vehicle model',
      type: 'select',
      required: true,
      remote_options: true,
      depends_on: { field: 'vehicle_make', query_param: true },
    },
    { name: 'value', label: 'Vehicle value', type: 'money', required: true, min: 1_000_000, unit: 'naira' },
    { name: 'registration_number', label: 'Vehicle registration number', type: 'text', required: true, min_length: 2 },
    { name: 'product_id', label: 'Product', type: 'text', required: true, hidden: true },
  ],
};

// ── Route stubs ─────────────────────────────────────────────────────────────
export interface InsuranceStubOptions {
  policies?: unknown[];
  claims?: unknown[];
  /** Fail the purchase with this code — the prefunded-float failure by default. */
  purchaseFailure?: string | null;
  premiumKobo?: number;
}

/**
 * Quiet the app-wide widgets that surround every screen.
 *
 * The shared axios client signs a user OUT on any 401, so a single unstubbed
 * background read — notifications, wallet balance, the elections banner — ends
 * the session and lands the test on /login, several assertions away from the
 * cause. These are not what the insurance tests are about; they just have to
 * not 401.
 */
export async function mockAmbientReads(page: Page) {
  const empty = async (route: import('@playwright/test').Route, body: unknown = []) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await page.route('**/api/v1/visitor/notifications**', (r) => empty(r, []));
  await page.route('**/api/v1/elections/active**', (r) => empty(r, []));
  await page.route('**/api/v1/wallet/balance**', (r) => empty(r, { balance_kobo: 15_000_000, currency: 'NGN' }));
  await page.route('**/rest/v1/utility_transactions**', (r) => empty(r, []));
}

function schemaFor(code: string) {
  if (code === STI_COMPREHENSIVE.code) return MOTOR_SCHEMA;
  if (code === STI_BIKE.code) return BIKE_SCHEMA;
  return BASTION_SCHEMA;
}

export async function mockInsurance(page: Page, opts: InsuranceStubOptions = {}) {
  await mockAmbientReads(page);
  const policies = opts.policies ?? [];
  const claims = opts.claims ?? [];
  const premiumKobo = opts.premiumKobo ?? 400_000;

  const json = (data: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400 ? { data } : data),
  });

  // Order matters: Playwright matches the most recently registered route first,
  // so the specific paths are registered after the catch-alls they refine.
  await page.route('**/api/v1/insurance/products**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').filter(Boolean);
    const productsIdx = parts.indexOf('products');
    const code = parts[productsIdx + 1];
    const tail = parts[productsIdx + 2];

    if (tail === 'schema') {
      await route.fulfill(json(schemaFor(decodeURIComponent(code))));
      return;
    }
    if (tail === 'options') {
      const field = parts[productsIdx + 3];
      const query = url.searchParams.get('query');
      // vehicle_model is deliberately empty without its parent, exactly as the
      // provider behaves — the UI must never fetch it in that state.
      if (field === 'vehicle_model' && !query) {
        await route.fulfill(json([]));
        return;
      }
      const options =
        field === 'vehicle_model'
          ? [{ label: 'Camry', value: 'Camry' }, { label: 'Corolla', value: 'Corolla' }]
          : [{ label: 'Toyota', value: 'Toyota' }, { label: 'Honda', value: 'Honda' }];
      await route.fulfill(json(options));
      return;
    }
    if (code) {
      const found = CATALOG.find((p) => p.code === decodeURIComponent(code));
      await route.fulfill(
        found
          ? json({ ...found, form_schema: schemaFor(decodeURIComponent(code)) })
          : json({ error: { code: 'NOT_FOUND', message: 'No such product' } }, 404),
      );
      return;
    }

    const line = url.searchParams.get('line');
    await route.fulfill(json(line ? CATALOG.filter((p) => p.product_line === line) : CATALOG));
  });

  await page.route('**/api/v1/insurance/quotes', async (route) => {
    const body = route.request().postDataJSON() as { inputs?: Record<string, unknown> };
    const plan = Number(body?.inputs?.payment_plan ?? 1) || 1;
    await route.fulfill(
      json({
        quote_ref: 'qte-e2e-001',
        product_code: BASTION_FLEXICARE_MINI.code,
        // The provider really does return 4,000 at plan 1 and 48,000 at plan 12.
        premium_kobo: premiumKobo * plan,
        sum_insured_kobo: 25_000_000,
        commission_kobo: 40_000,
        underwriter: 'Bastion Health',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        terms: 'Cover begins the day after the insurer issues your certificate.',
      }),
    );
  });

  await page.route('**/api/v1/insurance/policies**', async (route) => {
    if (route.request().method() === 'POST') {
      const code = opts.purchaseFailure === null ? null : (opts.purchaseFailure ?? 'PROVIDER_FLOAT_EXHAUSTED');
      if (code) {
        await route.fulfill(
          json({ error: { code, message: 'The insurer could not issue this policy.' } }, 502),
        );
        return;
      }
      await route.fulfill(json(policies[0] ?? {}));
      return;
    }
    await route.fulfill(json(policies));
  });

  await page.route('**/api/v1/insurance/claims**', async (route) => {
    await route.fulfill(json(claims));
  });
}
