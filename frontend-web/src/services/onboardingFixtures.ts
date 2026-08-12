// Local fixtures so the Merchant Onboarding console renders before the
// live backend admin endpoints are wired. Swap off by setting
// USE_FIXTURES = false in onboardingService.ts.

import type {
  OnboardingApplication,
  OnboardingQueueRow,
} from '@/types/onboarding';

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

export const onboardingQueueFixture: OnboardingQueueRow[] = [
  {
    id: 'onb_1001',
    applicantName: 'Ada Kitchen Ltd',
    moduleId: 'restaurant',
    moduleName: 'Restaurant Delivery',
    merchantTypeId: 'food_vendor',
    merchantTypeName: 'Food Vendor',
    status: 'SUBMITTED',
    riskLevel: 'low',
    submittedAt: hoursAgo(6),
    createdAt: hoursAgo(8),
  },
  {
    id: 'onb_1002',
    applicantName: 'SwiftRide Logistics',
    moduleId: 'transport',
    moduleName: 'Transport',
    merchantTypeId: 'fleet_operator',
    merchantTypeName: 'Fleet Operator',
    status: 'UNDER_REVIEW',
    riskLevel: 'medium',
    submittedAt: hoursAgo(30),
    createdAt: hoursAgo(34),
  },
  {
    id: 'onb_1003',
    applicantName: 'GreenFund Estates',
    moduleId: 'estate',
    moduleName: 'Estate',
    merchantTypeId: 'estate_manager',
    merchantTypeName: 'Estate Manager',
    status: 'NEEDS_MORE_INFO',
    riskLevel: 'high',
    submittedAt: hoursAgo(80),
    createdAt: hoursAgo(82),
  },
  {
    id: 'onb_1004',
    applicantName: 'CareWell Clinic',
    moduleId: 'telemedicine',
    moduleName: 'Telemedicine',
    merchantTypeId: 'health_provider',
    merchantTypeName: 'Health Provider',
    status: 'SUBMITTED',
    riskLevel: 'high',
    submittedAt: hoursAgo(2),
    createdAt: hoursAgo(2),
  },
];

const detailFixtures: Record<string, OnboardingApplication> = {
  onb_1001: {
    id: 'onb_1001',
    userId: 'usr_88a1',
    applicantName: 'Ada Kitchen Ltd',
    merchantTypeId: 'food_vendor',
    merchantTypeName: 'Food Vendor',
    moduleId: 'restaurant',
    moduleName: 'Restaurant Delivery',
    formSchemaId: 'schema_food_vendor',
    formSchemaVersion: 'v3',
    status: 'SUBMITTED',
    data: {
      businessName: 'Ada Kitchen Ltd',
      rcNumber: 'RC1234567',
      contactEmail: 'ada@adakitchen.ng',
      contactPhone: '+2348012345678',
      bankAccountName: 'Ada Kitchen Ltd',
      bankAccountNumber: '0123456789',
      bankName: 'GTBank',
      cuisineTypes: ['Nigerian', 'Continental'],
      averagePrepTimeMins: 25,
      address: '12 Allen Avenue, Ikeja, Lagos',
    },
    documents: [
      {
        type: 'cac',
        label: 'CAC Certificate',
        fileName: 'cac-certificate.pdf',
        expiryDate: null,
        verificationStatus: 'verified',
      },
      {
        type: 'food_handler',
        label: 'Food Handler Permit',
        fileName: 'food-handler.pdf',
        expiryDate: hoursAgo(-24 * 200),
        verificationStatus: 'pending',
      },
      {
        type: 'utility_bill',
        label: 'Utility Bill (Proof of Address)',
        fileName: 'utility-bill.jpg',
        expiryDate: null,
        verificationStatus: 'verified',
      },
    ],
    checks: [
      { key: 'bvn', label: 'BVN Match', status: 'pass', detail: 'BVN matches director name' },
      { key: 'nin', label: 'NIN Verification', status: 'pass', detail: 'NIN verified via NIMC' },
      { key: 'credential', label: 'Bank Account Resolution', status: 'pass', detail: 'Account name matches business' },
    ],
    decisionReason: null,
    infoChecklist: [],
    submittedAt: hoursAgo(6),
    decidedAt: null,
    createdAt: hoursAgo(8),
    updatedAt: hoursAgo(6),
  },
  onb_1003: {
    id: 'onb_1003',
    userId: 'usr_44c9',
    applicantName: 'GreenFund Estates',
    merchantTypeId: 'estate_manager',
    merchantTypeName: 'Estate Manager',
    moduleId: 'estate',
    moduleName: 'Estate',
    formSchemaId: 'schema_estate_manager',
    formSchemaVersion: 'v2',
    status: 'NEEDS_MORE_INFO',
    data: {
      businessName: 'GreenFund Estates',
      rcNumber: 'RC7654321',
      contactEmail: 'admin@greenfund.ng',
      contactPhone: '+2348098765432',
      estatesUnderManagement: 4,
      bankAccountNumber: '9988776655',
      bankName: 'Access Bank',
    },
    documents: [
      {
        type: 'cac',
        label: 'CAC Certificate',
        fileName: 'cac.pdf',
        expiryDate: null,
        verificationStatus: 'verified',
      },
      {
        type: 'estate_license',
        label: 'Estate Management License',
        fileName: 'license.pdf',
        expiryDate: hoursAgo(24 * 10),
        verificationStatus: 'expired',
      },
    ],
    checks: [
      { key: 'bvn', label: 'BVN Match', status: 'fail', detail: 'BVN name mismatch with director' },
      { key: 'nin', label: 'NIN Verification', status: 'pending', detail: 'Awaiting NIMC response' },
      { key: 'credential', label: 'Bank Account Resolution', status: 'pass', detail: 'Account resolved' },
    ],
    decisionReason: null,
    infoChecklist: ['Valid estate management license', 'Director BVN re-verification'],
    submittedAt: hoursAgo(80),
    decidedAt: null,
    createdAt: hoursAgo(82),
    updatedAt: hoursAgo(40),
  },
};

function genericFixture(id: string): OnboardingApplication {
  const row = onboardingQueueFixture.find((r) => r.id === id);
  return {
    id,
    userId: 'usr_unknown',
    applicantName: row?.applicantName ?? 'Unknown Applicant',
    merchantTypeId: row?.merchantTypeId ?? 'unknown',
    merchantTypeName: row?.merchantTypeName ?? 'Unknown',
    moduleId: row?.moduleId ?? 'unknown',
    moduleName: row?.moduleName ?? 'Unknown',
    formSchemaId: 'schema_generic',
    formSchemaVersion: 'v1',
    status: row?.status ?? 'SUBMITTED',
    data: {
      businessName: row?.applicantName ?? 'Unknown',
      contactEmail: 'merchant@example.ng',
    },
    documents: [
      {
        type: 'cac',
        label: 'CAC Certificate',
        fileName: 'cac.pdf',
        expiryDate: null,
        verificationStatus: 'pending',
      },
    ],
    checks: [
      { key: 'bvn', label: 'BVN Match', status: 'pending', detail: 'Not yet run' },
      { key: 'nin', label: 'NIN Verification', status: 'pending', detail: 'Not yet run' },
      { key: 'credential', label: 'Bank Account Resolution', status: 'pending', detail: 'Not yet run' },
    ],
    decisionReason: null,
    infoChecklist: [],
    submittedAt: row?.submittedAt ?? null,
    decidedAt: null,
    createdAt: row?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function onboardingApplicationFixture(
  id: string,
): Promise<OnboardingApplication> {
  await new Promise((r) => setTimeout(r, 150));
  return detailFixtures[id] ?? genericFixture(id);
}
