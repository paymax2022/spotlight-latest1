import { expect, Page, Route } from '@playwright/test';
import {
  cablePackages,
  cableProviders,
  dataPlans,
  discos,
  educationProducts,
  educationProviders,
  networks,
  providerResponses,
  validIdentifiers,
} from './testData';

type Json = Record<string, unknown> | readonly unknown[];
type UtilityPaymentBody = Record<string, unknown> & {
  metadata?: {
    meter_type?: string;
  };
};

export interface CapturedRequests {
  airtimePurchases: Record<string, unknown>[];
  dataPurchases: Record<string, unknown>[];
  electricityPayments: Record<string, unknown>[];
  cablePayments: Record<string, unknown>[];
  educationPayments: Record<string, unknown>[];
  paystackInitiations: Record<string, unknown>[];
}

export function createCapturedRequests(): CapturedRequests {
  return {
    airtimePurchases: [],
    dataPurchases: [],
    electricityPayments: [],
    cablePayments: [],
    educationPayments: [],
    paystackInitiations: [],
  };
}

async function fulfillJson(route: Route, data: Json, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status >= 400 ? data : { data }),
  });
}

async function fulfillRaw(route: Route, data: Json, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function requestJson(route: Route) {
  try {
    return route.request().postDataJSON() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function mockBillsCatalog(page: Page, captured = createCapturedRequests()) {
  await page.route('**/rest/v1/utility_billers**', async (route) => {
    const url = route.request().url();
    if (url.includes('code=eq.MTN')) return fulfillRaw(route, { id: 'net-mtn' });
    if (url.includes('code=eq.IKEDC')) return fulfillRaw(route, { id: 'disco-ikedc' });
    if (url.includes('code=eq.DSTV')) return fulfillRaw(route, { id: 'cable-dstv' });
    if (url.includes('code=eq.waec')) return fulfillRaw(route, { id: 'edu-waec' });
    if (url.includes('category=eq.airtime')) return fulfillRaw(route, networks.map((item) => ({ id: item.id, name: item.name, code: item.code, status: 'active' })));
    if (url.includes('category=eq.data')) return fulfillRaw(route, networks.map((item) => ({ id: item.id, name: item.name, code: item.code, status: 'active' })));
    if (url.includes('category=eq.electricity')) return fulfillRaw(route, discos.map((item) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      status: 'active',
      metadata: { supports_prepaid: item.supportsPrepaid, supports_postpaid: item.supportsPostpaid },
    })));
    if (url.includes('category=eq.cable_tv')) return fulfillRaw(route, cableProviders.map((item) => ({ id: item.id, name: item.name, code: item.code, status: 'active' })));
    if (url.includes('category=eq.education')) return fulfillRaw(route, educationProviders.map((item) => ({ id: item.id, name: item.name, code: item.code, status: 'active' })));
    return fulfillRaw(route, []);
  });

  await page.route('**/rest/v1/utility_products**', async (route) => {
    const url = route.request().url();
    if (url.includes('amount_type=eq.variable') || url.includes('limit=1')) {
      return fulfillRaw(route, { id: 'variable-product', name: 'Variable Product', code: 'VARIABLE', amount_kobo: null, amount_type: 'variable', metadata: {} });
    }
    if (url.includes('biller_id=eq.net-mtn')) {
      return fulfillRaw(route, dataPlans.map((item) => ({
        id: item.id,
        name: item.name,
        code: item.providerCode,
        amount_kobo: item.sellingPrice * 100,
        amount_type: 'fixed',
        metadata: { allowance: item.allowance, validity: item.validity },
      })));
    }
    if (url.includes('biller_id=eq.cable-dstv')) {
      return fulfillRaw(route, cablePackages.map((item) => ({
        id: item.id,
        name: item.name,
        code: item.providerCodeValue,
        amount_kobo: item.sellingPrice * 100,
        amount_type: 'fixed',
        metadata: { duration: item.duration },
      })));
    }
    if (url.includes('biller_id=eq.edu-waec')) {
      return fulfillRaw(route, educationProducts.map((item) => ({
        id: item.id,
        name: item.name,
        code: item.providerCodeValue,
        amount_kobo: item.sellingPrice * 100,
        amount_type: 'fixed',
        metadata: { validity: item.meta },
      })));
    }
    return fulfillRaw(route, [{ id: 'variable-product', name: 'Variable Product', code: 'VARIABLE', amount_kobo: null, amount_type: 'variable', metadata: {} }]);
  });

  await page.route('**/services/airtime/networks', (route) => fulfillJson(route, networks));
  await page.route('**/services/data/networks', (route) => fulfillJson(route, networks));
  await page.route('**/services/data/plans**', (route) => fulfillJson(route, dataPlans));
  await page.route('**/services/electricity/discos', (route) => fulfillJson(route, discos));
  await page.route('**/services/cable/providers', (route) => fulfillJson(route, cableProviders));
  await page.route('**/services/cable/packages**', (route) => fulfillJson(route, cablePackages));

  await page.route('**/services/electricity/validate', async (route) => {
    await fulfillJson(route, {
      customerName: 'QA Electricity Customer',
      customerAddress: '12 Test Avenue, Lagos',
      meterNumber: validIdentifiers.meterNumber,
      discoName: 'IKEDC',
      minimumAmount: 500,
      maximumAmount: 100_000,
    });
  });

  await page.route('**/services/cable/validate', async (route) => {
    await fulfillJson(route, {
      customerName: 'QA Cable Customer',
      smartCardNumber: validIdentifiers.smartCardNumber,
      providerName: 'DSTV',
      currentBouquet: 'Compact',
    });
  });

  await page.route('**/api/v1/utility/validate', async (route) => {
    const body = await requestJson(route);
    if (body.category === 'cable_tv') {
      await fulfillJson(route, {
        customerName: 'QA Cable Customer',
        customer_name: 'QA Cable Customer',
        smartCardNumber: validIdentifiers.smartCardNumber,
        smart_card_number: validIdentifiers.smartCardNumber,
        providerName: 'DSTV',
        provider_name: 'DSTV',
        currentBouquet: 'Compact',
        current_bouquet: 'Compact',
      });
      return;
    }
    if (body.category === 'electricity') {
      await fulfillJson(route, {
        customerName: 'QA Electricity Customer',
        customer_name: 'QA Electricity Customer',
        customerAddress: '12 Test Avenue, Lagos',
        customer_address: '12 Test Avenue, Lagos',
        meterNumber: validIdentifiers.meterNumber,
        meter_number: validIdentifiers.meterNumber,
        discoName: 'IKEDC',
        disco_name: 'IKEDC',
        minimumAmount: 500,
        minimum_amount: 500,
        maximumAmount: 100_000,
        maximum_amount: 100_000,
      });
      return;
    }
    await fulfillJson(route, {});
  });

  await page.route('**/services/airtime/purchase', async (route) => {
    captured.airtimePurchases.push(await requestJson(route));
    await fulfillJson(route, providerResponses.airtimeSuccess);
  });

  await page.route('**/services/data/purchase', async (route) => {
    captured.dataPurchases.push(await requestJson(route));
    await fulfillJson(route, providerResponses.dataSuccess);
  });

  await page.route('**/services/electricity/pay', async (route) => {
    const body = await requestJson(route);
    captured.electricityPayments.push(body);
    await fulfillJson(
      route,
      body.meterType === 'POSTPAID'
        ? providerResponses.electricityPostpaidSuccess
        : providerResponses.electricityPrepaidSuccess,
    );
  });

  await page.route('**/services/cable/pay', async (route) => {
    captured.cablePayments.push(await requestJson(route));
    await fulfillJson(route, providerResponses.cableSuccess);
  });

  await page.route('**/api/v1/utility/pay', async (route) => {
    const body = await requestJson(route);
    if (body.category === 'education') {
      captured.educationPayments.push(body);
      return fulfillJson(route, providerResponses.educationSuccess);
    }
    if (body.category === 'airtime') {
      captured.airtimePurchases.push(body);
      return fulfillJson(route, providerResponses.airtimeSuccess);
    }
    if (body.category === 'data') {
      captured.dataPurchases.push(body);
      return fulfillJson(route, providerResponses.dataSuccess);
    }
    if (body.category === 'electricity') {
      const utilityPayment = body as UtilityPaymentBody;
      captured.electricityPayments.push(utilityPayment);
      return fulfillJson(
        route,
        utilityPayment.metadata?.meter_type === 'POSTPAID'
          ? providerResponses.electricityPostpaidSuccess
          : providerResponses.electricityPrepaidSuccess,
      );
    }
    if (body.category === 'cable_tv') {
      captured.cablePayments.push(body);
      return fulfillJson(route, providerResponses.cableSuccess);
    }
    return fulfillJson(route, providerResponses.pending);
  });

  await page.route('**/api/v1/utility/paystack/initiate', async (route) => {
    captured.paystackInitiations.push(await requestJson(route));
    await fulfillJson(route, { authorizationUrl: 'https://checkout.paystack.test/pay/e2e', paymentReference: 'PSK-E2E-001' });
  });

  await mockTransactions(page);
  return captured;
}

export async function mockTransactions(page: Page) {
  type ReceiptFixture = {
    transactionId: string;
    reference: string;
    status: string;
    serviceType: string;
    amount: number;
    charges: number;
    totalAmount: number;
    customerIdentifier: string;
    customerName?: string;
    providerName?: string;
    productName?: string;
    token?: string;
    units?: string;
    supportMessage?: string;
    createdAt: string;
  };

  const receipts: Record<string, ReceiptFixture> = {
    'tx-airtime-success': {
      transactionId: 'tx-airtime-success',
      reference: 'PMX-AIRTIME-001',
      status: 'SUCCESSFUL',
      serviceType: 'AIRTIME',
      amount: 500,
      charges: 0,
      totalAmount: 500,
      customerIdentifier: validIdentifiers.phone,
      providerName: 'MTN',
      productName: 'Airtime',
      createdAt: '2026-06-14T09:00:00.000Z',
    },
    'tx-data-success': {
      transactionId: 'tx-data-success',
      reference: 'PMX-DATA-001',
      status: 'SUCCESSFUL',
      serviceType: 'DATA',
      amount: 1200,
      charges: 0,
      totalAmount: 1200,
      customerIdentifier: validIdentifiers.phone,
      providerName: 'MTN',
      productName: '3GB Weekly',
      createdAt: '2026-06-14T09:05:00.000Z',
    },
    'tx-electricity-prepaid-success': {
      transactionId: 'tx-electricity-prepaid-success',
      reference: 'PMX-ELEC-001',
      status: 'SUCCESSFUL',
      serviceType: 'ELECTRICITY',
      amount: 5000,
      charges: 0,
      totalAmount: 5000,
      customerIdentifier: validIdentifiers.meterNumber,
      customerName: 'QA Electricity Customer',
      providerName: 'IKEDC',
      productName: 'Prepaid Electricity',
      token: '1234-5678-9012-3456',
      units: '42.3',
      createdAt: '2026-06-14T09:10:00.000Z',
    },
    'tx-electricity-postpaid-success': {
      transactionId: 'tx-electricity-postpaid-success',
      reference: 'PMX-ELEC-002',
      status: 'SUCCESSFUL',
      serviceType: 'ELECTRICITY',
      amount: 10000,
      charges: 0,
      totalAmount: 10000,
      customerIdentifier: validIdentifiers.meterNumber,
      customerName: 'QA Electricity Customer',
      providerName: 'IKEDC',
      productName: 'Postpaid Electricity',
      createdAt: '2026-06-14T09:12:00.000Z',
    },
    'tx-cable-success': {
      transactionId: 'tx-cable-success',
      reference: 'PMX-CABLE-001',
      status: 'SUCCESSFUL',
      serviceType: 'CABLE_TV',
      amount: 12500,
      charges: 0,
      totalAmount: 12500,
      customerIdentifier: validIdentifiers.smartCardNumber,
      customerName: 'QA Cable Customer',
      providerName: 'DSTV',
      productName: 'Compact',
      createdAt: '2026-06-14T09:15:00.000Z',
    },
    'tx-education-success': {
      transactionId: 'tx-education-success',
      reference: 'PMX-EDU-001',
      status: 'SUCCESSFUL',
      serviceType: 'EDUCATION',
      amount: 5350,
      charges: 0,
      totalAmount: 5350,
      customerIdentifier: validIdentifiers.educationReference,
      providerName: 'WAEC Result Checker',
      productName: 'WAEC Result Checker PIN',
      createdAt: '2026-06-14T09:17:00.000Z',
    },
    'tx-provider-pending': {
      transactionId: 'tx-provider-pending',
      reference: 'PMX-PENDING-001',
      status: 'PENDING',
      serviceType: 'ELECTRICITY',
      amount: 5000,
      charges: 0,
      totalAmount: 5000,
      customerIdentifier: validIdentifiers.meterNumber,
      supportMessage: 'Your transaction is pending provider confirmation.',
      createdAt: '2026-06-14T09:20:00.000Z',
    },
  };

  await page.route('**/transactions', async (route) => {
    if (route.request().resourceType() === 'document') return route.fallback();
    await fulfillJson(route, {
      items: Object.values(receipts).map((receipt) => ({
        id: receipt.transactionId,
        serviceType: receipt.serviceType,
        status: receipt.status,
        amount: receipt.amount,
        charges: receipt.charges,
        totalAmount: receipt.totalAmount,
        reference: receipt.reference,
        customerIdentifier: receipt.customerIdentifier,
        providerName: receipt.providerName,
        productName: receipt.productName,
        token: receipt.token,
        units: receipt.units,
        createdAt: receipt.createdAt,
      })),
      total: Object.keys(receipts).length,
      page: 1,
      limit: 50,
      hasMore: false,
    });
  });

  await page.route('**/transactions/*/receipt', async (route) => {
    if (route.request().resourceType() === 'document') return route.fallback();
    const id = route.request().url().match(/transactions\/([^/]+)\/receipt/)?.[1] ?? '';
    await fulfillJson(route, receipts[id as keyof typeof receipts] ?? receipts['tx-airtime-success']);
  });

  await page.route('**/transactions/*', async (route) => {
    if (route.request().resourceType() === 'document') return route.fallback();
    if (route.request().url().includes('/receipt')) return route.fallback();
    if (route.request().method() !== 'GET') return route.fallback();
    const id = route.request().url().match(/transactions\/([^/?]+)/)?.[1] ?? '';
    const receipt = receipts[id as keyof typeof receipts] ?? receipts['tx-airtime-success'];
    await fulfillJson(route, {
      id: receipt.transactionId,
      serviceType: receipt.serviceType,
      status: receipt.status,
      amount: receipt.amount,
      charges: receipt.charges,
      totalAmount: receipt.totalAmount,
      reference: receipt.reference,
      customerIdentifier: receipt.customerIdentifier,
      providerName: receipt.providerName,
      productName: receipt.productName,
      token: receipt.token,
      units: receipt.units,
      createdAt: receipt.createdAt,
    });
  });

  await page.route('**/rest/v1/utility_transactions**', async (route) => {
    const url = route.request().url();
    const requestedId = Object.keys(receipts).find((id) => url.includes(`id=eq.${id}`));

    function toSupabaseRow(receipt: ReceiptFixture) {
      return {
        id: receipt.transactionId,
        category: receipt.serviceType.toLowerCase(),
        status: receipt.status.toLowerCase() === 'successful' ? 'successful' : receipt.status.toLowerCase(),
        amount_kobo: receipt.amount,
        convenience_fee_kobo: receipt.charges,
        retail_amount_kobo: receipt.totalAmount,
        receipt_number: receipt.reference,
        customer_reference: receipt.customerIdentifier,
        customer_name: receipt.customerName,
        token: receipt.token,
        created_at: receipt.createdAt,
        biller: receipt.providerName ? { name: receipt.providerName } : null,
        product: receipt.productName ? { name: receipt.productName } : null,
      };
    }

    if (requestedId) {
      return fulfillRaw(route, toSupabaseRow(receipts[requestedId]));
    }

    return fulfillRaw(route, Object.values(receipts).map(toSupabaseRow));
  });
}

export async function completeEducationPayment(page: Page) {
  await page.goto('/services/education');
  await page.getByText('WAEC Result Checker').first().click();
  await page.getByText('WAEC Result Checker PIN').first().click();
  await page.getByPlaceholder('Candidate ID or phone reference').fill(validIdentifiers.educationReference);
  await page.getByPlaceholder('0801 234 5678').fill(validIdentifiers.phone);
  await page.getByText('Review Payment').click();
  await expect(page.getByText('Confirm Education Payment')).toBeVisible();
  await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
  await page.mouse.wheel(0, 900);
  await page.getByText('Confirm & Pay').last().click();
}

export async function openBillsHome(page: Page) {
  await page.goto('/services/bills');
  await expect(page.getByText('Bill Payments', { exact: true })).toBeVisible();
}

export async function completeAirtimePurchase(page: Page) {
  await page.goto('/services/airtime');
  await page.getByText('MTN').first().click();
  await page.getByPlaceholder('0801 234 5678').fill(validIdentifiers.phone);
  await page.getByText('₦500').first().click();
  await page.getByText('Review Purchase').click();
  await expect(page.getByText('Confirm Purchase')).toBeVisible();
  await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
  await page.mouse.wheel(0, 900);
  await page.getByText('Confirm & Pay').last().click();
}

export async function completeDataPurchase(page: Page) {
  await page.goto('/services/data');
  await page.getByText('MTN').first().click();
  await page.getByPlaceholder('0801 234 5678').fill(validIdentifiers.phone);
  await page.getByText('3GB Weekly').first().click();
  await page.getByText('Review Purchase').click();
  await expect(page.getByText('Confirm Purchase')).toBeVisible();
  await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
  await page.mouse.wheel(0, 900);
  await page.getByText('Confirm & Pay').click();
}

export async function validateElectricityMeter(page: Page, type: 'Prepaid' | 'Postpaid' = 'Prepaid') {
  await page.goto('/services/electricity');
  await page.getByText('IKEDC').first().click();
  await page.getByText(type, { exact: true }).click();
  await page.getByPlaceholder('1234 5678 9012').fill(validIdentifiers.meterNumber);
  await page.getByText('Validate Meter').click();
  await expect(page.getByText('QA Electricity Customer').first()).toBeVisible();
}

export async function completeElectricityPayment(page: Page, type: 'Prepaid' | 'Postpaid' = 'Prepaid') {
  await validateElectricityMeter(page, type);
  await page.getByPlaceholder('0801 234 5678').fill(validIdentifiers.phone);
  await page.getByText(type === 'Postpaid' ? '₦10,000' : '₦5,000').click();
  await page.getByText('Review Payment').click();
  await expect(page.getByText('Confirm Payment')).toBeVisible();
  await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
  await page.mouse.wheel(0, 900);
  await page.getByText('Confirm & Pay').last().click();
}

export async function completeCablePayment(page: Page) {
  await page.goto('/services/cable-tv');
  await page.getByText('DSTV').first().click();
  await page.getByPlaceholder('1234567890').fill(validIdentifiers.smartCardNumber);
  await page.getByText('Validate Card').click();
  await expect(page.getByText('QA Cable Customer').first()).toBeVisible();
  await page.getByText('Compact').last().click();
  await page.getByPlaceholder('0801 234 5678').fill(validIdentifiers.phone);
  await page.getByText('Review Subscription').click();
  await expect(page.getByText('Confirm Subscription')).toBeVisible();
  await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
  await page.mouse.wheel(0, 900);
  await page.getByText('Confirm & Pay').last().click();
}
