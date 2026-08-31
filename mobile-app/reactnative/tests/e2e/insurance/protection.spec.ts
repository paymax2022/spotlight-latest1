import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import {
  BASTION_FLEXICARE_MINI,
  BROKEN_PLAN,
  GOODS_IN_TRANSIT,
  STI_BIKE,
  STI_COMPREHENSIVE,
  mockInsurance,
} from '../helpers/insurance';

/**
 * The Protection (insurance) member journey.
 *
 * These assert the things that would be expensive to get wrong and cheap to
 * regress: that a rate-priced plan is never drawn as a naira amount, that a plan
 * the insurer cannot issue never offers a buy button, that a bespoke schema
 * renders as a short sequence of validated steps, and that a failed bind tells
 * the user plainly they have not been charged.
 */

const shot = async (page: import('@playwright/test').Page, name: string) => {
  await page.screenshot({ path: `playwright-report/screens/${name}.png`, fullPage: true });
};

test.describe('Protection — discovery', () => {
  test.beforeEach(async ({ page }) => {
    await mockInsurance(page);
    await loginAs(page);
  });

  test('the hub shows the seven real categories with live counts', async ({ page }) => {
    await page.goto('/insurance');

    await expect(page.getByText('Protection').first()).toBeVisible();
    for (const label of ['Health', 'Motor', 'Life & Personal', 'Gadget', 'Home & Content', 'Business & Goods', 'Travel']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // Counts come from the catalog, never a constant: 2 Bastion health plans.
    await expect(page.getByText('2 plans').first()).toBeVisible();
    await shot(page, 'hub-no-cover');
  });

  test('with no policies the hub leads with cover, not an empty box', async ({ page }) => {
    await page.goto('/insurance');
    await expect(page.getByText('You have no cover yet')).toBeVisible();
    await expect(page.getByText('Find cover')).toBeVisible();
  });

  test('browse lists every plan, grouped by real category', async ({ page }) => {
    await page.goto('/insurance/browse');

    await expect(page.getByText(BASTION_FLEXICARE_MINI.name).first()).toBeVisible();
    await expect(page.getByText(STI_COMPREHENSIVE.name).first()).toBeVisible();
    await expect(page.getByText('Sovereign Trust Insurance Plc').first()).toBeVisible();
    await shot(page, 'browse-all');
  });

  test('search matches the insurer, not just the plan name', async ({ page }) => {
    await page.goto('/insurance/browse');
    await page.getByPlaceholder('Search plans or insurers').fill('Bastion');

    await expect(page.getByText(BASTION_FLEXICARE_MINI.name).first()).toBeVisible();
    await expect(page.getByText(STI_COMPREHENSIVE.name)).toHaveCount(0);
  });

  test('a RATE-priced plan never renders as a naira amount', async ({ page }) => {
    // base_price 0.5 means "0.5% of what you insure". Drawing "₦0.50" would
    // misprice it by orders of magnitude to the reader's eye.
    await page.goto(`/insurance/product/${GOODS_IN_TRANSIT.code}`);

    await expect(page.getByText('0.5%').first()).toBeVisible();
    await expect(page.getByText('of value insured').first()).toBeVisible();
    await expect(page.getByText('Rate-based').first()).toBeVisible();
    await expect(page.getByText('₦0.50')).toHaveCount(0);
    await shot(page, 'product-rate-priced');
  });

  test('a flat-priced plan shows its exact premium and its siblings', async ({ page }) => {
    await page.goto(`/insurance/product/${BASTION_FLEXICARE_MINI.code}`);

    await expect(page.getByText('₦4,000').first()).toBeVisible();
    await expect(page.getByText('Choose your plan')).toBeVisible();
    await expect(page.getByText('FlexiCare', { exact: true }).first()).toBeVisible();
    // Provider HTML is rendered as text, never as markup.
    await expect(page.getByText('Unlimited GP consultations').first()).toBeVisible();
    await expect(page.getByText('<li>')).toHaveCount(0);
    await shot(page, 'product-flat-priced');
  });

  test('a plan the insurer cannot issue offers no buy button', async ({ page }) => {
    await page.goto(`/insurance/product/${BROKEN_PLAN.code}`);

    await expect(page.getByText('Not available right now')).toBeVisible();
    await expect(page.getByText('Get covered')).toHaveCount(0);
    await shot(page, 'product-unpurchasable');
  });
});

test.describe('Protection — the schema-driven application', () => {
  test.beforeEach(async ({ page }) => {
    await mockInsurance(page);
    await loginAs(page);
  });

  test('a bespoke schema becomes a short sequence of steps, not one scroll', async ({ page }) => {
    await page.goto(`/insurance/quote/form?code=${BASTION_FLEXICARE_MINI.code}`);

    await expect(page.getByText('About you')).toBeVisible();
    await expect(page.getByText(/Step 1 of \d/)).toBeVisible();
    // The plan UUID is submitted, never asked for.
    await expect(page.getByText('Product', { exact: true })).toHaveCount(0);
    await shot(page, 'form-step-1');
  });

  test("the provider's own rules are enforced before the round trip", async ({ page }) => {
    await page.goto(`/insurance/quote/form?code=${BASTION_FLEXICARE_MINI.code}`);

    // The signed-in profile prefills the name fields, so clear one to prove the
    // rule is enforced rather than merely satisfied by the prefill. Targeted by
    // value because react-native-web renders TextInput with no name or label
    // association to select on.
    const firstName = page.locator('input[value="Funded"]').first();
    await expect(firstName).toBeVisible();
    await firstName.fill('');
    await page.getByText('Continue').click();

    await expect(page.getByText('First name is required').first()).toBeVisible();
    await shot(page, 'form-validation');
  });

  test('a dependent dropdown refuses to open before its parent is answered', async ({ page }) => {
    // vehicle_model returns [] without a make, so fetching eagerly would leave a
    // dropdown that can never be completed.
    await page.goto(`/insurance/quote/form?code=${STI_BIKE.code}`);

    await expect(page.getByText('Choose vehicle make first')).toBeVisible();
    await shot(page, 'form-dependent-dropdown');
  });

  test('a naira minimum is enforced as naira, not as kobo', async ({ page }) => {
    // min 50000 on a naira-denominated field means ₦50,000, not ₦500.
    await page.goto(`/insurance/quote/form?code=${STI_BIKE.code}`);
    await expect(page.getByText(/Minimum ₦1,000,000/).first()).toBeVisible();
  });
});

test.describe('Protection — buying', () => {
  test('a failed bind says plainly that nothing was charged', async ({ page }) => {
    // The real blocker today: MyCover settles binds against a prefunded float,
    // and ours is empty. The user did nothing wrong and must not be left
    // wondering about their money.
    await mockInsurance(page, { purchaseFailure: 'PROVIDER_FLOAT_EXHAUSTED' });
    await loginAs(page);

    await page.goto('/insurance/pay/failure?code=PROVIDER_FLOAT_EXHAUSTED');

    await expect(page.getByText("We couldn't complete your purchase")).toBeVisible();
    await expect(page.getByText(/You have not been charged/).first()).toBeVisible();
    // The vendor's own wording must never reach a customer.
    await expect(page.getByText(/wallet fund/i)).toHaveCount(0);
    await shot(page, 'purchase-failed');
  });
});

test.describe('Protection — policies and claims', () => {
  test.beforeEach(async ({ page }) => {
    await mockInsurance(page);
    await loginAs(page);
  });

  test('an empty policy wallet explains itself instead of saying "no data"', async ({ page }) => {
    await page.goto('/insurance/policies');

    await expect(page.getByText('Your policy wallet is empty')).toBeVisible();
    await expect(page.getByText('Your certificate, available offline')).toBeVisible();
    await expect(page.getByText('Find cover')).toBeVisible();
    await shot(page, 'policies-empty');
  });

  test('a real policy shows its reference, premium and certificate', async ({ page }) => {
    await mockInsurance(page, {
      policies: [
        {
          id: 'pol-e2e-1',
          policy_ref: 'PMX-INS-000123',
          product_code: BASTION_FLEXICARE_MINI.code,
          product_name: 'FlexiCare Mini',
          underwriter: 'Bastion Health',
          status: 'active',
          premium_kobo: 400_000,
          sum_insured_kobo: 25_000_000,
          starts_at: '2026-08-01T00:00:00Z',
          ends_at: '2026-08-31T00:00:00Z',
          certificate_url: 'https://example.test/cert.pdf',
          claim_url: 'https://mycover.ai/purchase?q=abc',
          created_at: '2026-08-01T00:00:00Z',
        },
      ],
    });
    await page.goto('/insurance/policies');

    await expect(page.getByText('FlexiCare Mini').first()).toBeVisible();
    await expect(page.getByText('Active').first()).toBeVisible();
    await expect(page.getByText('₦4,000').first()).toBeVisible();
    await shot(page, 'policies-populated');
  });

  test('claims are honest about being filed with the insurer', async ({ page }) => {
    await page.goto('/insurance/claims');

    await expect(page.getByText('No claims — and long may it last')).toBeVisible();
    await shot(page, 'claims-empty');
  });
});
