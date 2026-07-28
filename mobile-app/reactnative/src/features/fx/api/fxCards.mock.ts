// ── FX Exchange — Cards mock seed data ───────────────────────────────────────
// All money is minor units (integer). Sensitive PAN/CVV are mock-only.

import type { Card, CardTransaction, CardSensitive } from '../types/fx.types';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

export const MOCK_CARDS: Card[] = [
  {
    id: 'card_1', label: 'Subscriptions', brand: 'visa', currency: 'USD',
    last4: '4242', expMonth: 8, expYear: 28, cardholderName: 'SPOTLIGHT USER',
    balance: 420_00, status: 'active', color: 'purple', spentThisMonth: 86_40,
    controls: { monthlyLimit: 500_00, perTxLimit: 200_00, online: true, atm: false, international: true, contactless: true },
    provider: 'maplerad', createdAt: iso(86_400_000 * 60),
  },
  {
    id: 'card_2', label: 'Travel', brand: 'mastercard', currency: 'USD',
    last4: '5588', expMonth: 3, expYear: 27, cardholderName: 'SPOTLIGHT USER',
    balance: 1_250_00, status: 'frozen', color: 'graphite', spentThisMonth: 0,
    controls: { monthlyLimit: null, perTxLimit: null, online: true, atm: true, international: true, contactless: true },
    provider: 'maplerad', createdAt: iso(86_400_000 * 20),
  },
];

export const MOCK_CARD_SENSITIVE: Record<string, CardSensitive> = {
  card_1: { pan: '4242 4242 4242 4242', cvv: '318', expiry: '08/28' },
  card_2: { pan: '5588 0000 0000 5588', cvv: '907', expiry: '03/27' },
};

export const MOCK_CARD_TRANSACTIONS: CardTransaction[] = [
  { id: 'ct_1', cardId: 'card_1', merchant: 'Netflix', category: 'Subscriptions', icon: 'Tv', amount: 15_49, currency: 'USD', status: 'approved', createdAt: iso(3_600_000 * 5) },
  { id: 'ct_2', cardId: 'card_1', merchant: 'OpenAI', category: 'Software', icon: 'Cpu', amount: 20_00, currency: 'USD', status: 'approved', createdAt: iso(86_400_000 * 1) },
  { id: 'ct_3', cardId: 'card_1', merchant: 'Spotify', category: 'Subscriptions', icon: 'Music', amount: 10_99, currency: 'USD', status: 'declined', createdAt: iso(86_400_000 * 2), declineReason: 'Exceeds per-transaction limit on this card.' },
  { id: 'ct_4', cardId: 'card_1', merchant: 'Amazon Web Services', category: 'Software', icon: 'Server', amount: 39_92, currency: 'USD', status: 'approved', createdAt: iso(86_400_000 * 3) },
  { id: 'ct_5', cardId: 'card_1', merchant: 'Figma', category: 'Software', icon: 'PenTool', amount: 12_00, currency: 'USD', status: 'refunded', createdAt: iso(86_400_000 * 6) },
  { id: 'ct_6', cardId: 'card_2', merchant: 'Booking.com', category: 'Travel', icon: 'BedDouble', amount: 240_00, currency: 'USD', status: 'approved', createdAt: iso(86_400_000 * 25) },
];
