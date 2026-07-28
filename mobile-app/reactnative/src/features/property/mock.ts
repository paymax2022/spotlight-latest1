// ── Property Management — in-memory mock data ────────────────────────────────
// Used when EXPO_PUBLIC_PROPERTY_USE_MOCK !== 'false' (the default). Mirrors the
// shapes returned by the canonical /api/finance/property/* + realtor endpoints so
// flipping to live is a no-op for the screens.

import type {
  ContextEnvelope,
  PropertyContext,
  RentPassport,
  StayGatePass,
} from './types';

export const MOCK_CONTEXTS: PropertyContext[] = [
  { type: 'estate',   id: 'est_lekki_gardens', name: 'Lekki Gardens Estate', roles: ['resident', 'tenant'] },
  { type: 'property', id: 'prop_12b_admiralty', name: '12B Admiralty Way',    roles: ['landlord'] },
  { type: 'agency',   id: 'agy_paymax_realty',  name: 'Paymax Realty',        roles: ['agent'] },
];

export function mockContextEnvelope(): ContextEnvelope {
  return {
    activeContext: { type: MOCK_CONTEXTS[0].type, id: MOCK_CONTEXTS[0].id },
    contexts:      MOCK_CONTEXTS,
  };
}

export const MOCK_RENT_PASSPORT: RentPassport = {
  userId:        'usr_demo',
  score:         86,
  onTimeRate:    0.92,
  totalPaidKobo: 480_000_00, // ₦480,000.00 in kobo
  paymentsCount: 12,
  recentPayments: [
    { id: 'pay_1', paidAt: '2026-06-01T09:00:00Z', amountKobo: 150_000_00, onTime: true,  propertyName: '12B Admiralty Way' },
    { id: 'pay_2', paidAt: '2026-05-01T09:00:00Z', amountKobo: 150_000_00, onTime: true,  propertyName: '12B Admiralty Way' },
    { id: 'pay_3', paidAt: '2026-04-03T09:00:00Z', amountKobo: 150_000_00, onTime: false, propertyName: '12B Admiralty Way' },
  ],
};

export function mockGatePass(bookingId: string): StayGatePass {
  return {
    bookingId,
    guestName:  'Your stay',
    estateName: 'Lekki Gardens Estate',
    qrPayload:  `paymax-staypass:${bookingId}`,
    pin:        '482913',
    validFrom:  '2026-06-25T14:00:00Z',
    validTo:    '2026-06-28T11:00:00Z',
  };
}
