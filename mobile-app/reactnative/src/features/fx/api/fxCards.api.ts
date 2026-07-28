// ── FX Exchange — Cards API wrapper ──────────────────────────────────────────
// Typed data layer for the cards vertical (Backend role owns this file).
// Mock-flagged; flip USE_MOCK=false once /v1/cards endpoints land.
// IRON RULES: money is minor units; every money mutation carries an Idempotency-Key.

import { api } from '@/api/client';
import type {
  Card,
  CardSensitive,
  CardTransaction,
  CreateCardDraft,
  SpendingControls,
} from '../types/fx.types';
import {
  MOCK_CARDS,
  MOCK_CARD_SENSITIVE,
  MOCK_CARD_TRANSACTIONS,
} from './fxCards.mock';

const USE_MOCK = (process.env.EXPO_PUBLIC_FX_USE_MOCK ?? 'true').toLowerCase() !== 'false';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

export async function getCards(): Promise<Card[]> {
  if (USE_MOCK) { await delay(); return MOCK_CARDS.filter((c) => c.status !== 'terminated'); }
  return unwrap<Card[]>(await api.get('/api/v1/fx/cards'));
}

export async function getCard(id: string): Promise<Card> {
  if (USE_MOCK) {
    await delay();
    const c = MOCK_CARDS.find((x) => x.id === id);
    if (!c) throw new Error('Card not found');
    return c;
  }
  return unwrap<Card>(await api.get(`/api/v1/fx/cards/${id}`));
}

export async function createCard(draft: CreateCardDraft, idempotencyKey: string): Promise<Card> {
  if (USE_MOCK) {
    await delay(1000);
    const last4 = String(Math.floor(1000 + Math.random() * 8999));
    const created: Card = {
      id: `card_${Date.now()}`,
      label: draft.label || 'Virtual card',
      brand: draft.brand, currency: draft.currency, last4,
      expMonth: ((new Date().getMonth() + 1) % 12) + 1, expYear: (new Date().getFullYear() + 3) % 100,
      cardholderName: 'SPOTLIGHT USER',
      balance: draft.fundingAmount, status: 'active', color: draft.color, spentThisMonth: 0,
      controls: { monthlyLimit: null, perTxLimit: null, online: true, atm: false, international: true, contactless: true },
      provider: 'maplerad', createdAt: new Date().toISOString(),
    };
    MOCK_CARDS.unshift(created);
    MOCK_CARD_SENSITIVE[created.id] = { pan: `${last4} •••• •••• ${last4}`, cvv: String(Math.floor(100 + Math.random() * 899)), expiry: `${String(created.expMonth).padStart(2, '0')}/${created.expYear}` };
    return created;
  }
  return unwrap<Card>(await api.post('/api/v1/fx/cards', draft, { headers: { 'Idempotency-Key': idempotencyKey } }));
}

export async function revealCard(id: string): Promise<CardSensitive> {
  if (USE_MOCK) {
    await delay(600);
    return MOCK_CARD_SENSITIVE[id] ?? { pan: '•••• •••• •••• ••••', cvv: '•••', expiry: '••/••' };
  }
  return unwrap<CardSensitive>(await api.post(`/api/v1/fx/cards/${id}/reveal`, {}));
}

export async function fundCard(id: string, amount: number, idempotencyKey: string): Promise<Card> {
  if (USE_MOCK) {
    await delay(800);
    const c = MOCK_CARDS.find((x) => x.id === id);
    if (!c) throw new Error('Card not found');
    c.balance += amount;
    return c;
  }
  return unwrap<Card>(await api.post(`/api/v1/fx/cards/${id}/fund`, { amount }, { headers: { 'Idempotency-Key': idempotencyKey } }));
}

export async function setCardFrozen(id: string, frozen: boolean): Promise<Card> {
  if (USE_MOCK) {
    await delay(400);
    const c = MOCK_CARDS.find((x) => x.id === id);
    if (!c) throw new Error('Card not found');
    c.status = frozen ? 'frozen' : 'active';
    return c;
  }
  return unwrap<Card>(await api.post(`/api/v1/fx/cards/${id}/${frozen ? 'freeze' : 'unfreeze'}`, {}));
}

export async function terminateCard(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(600);
    const c = MOCK_CARDS.find((x) => x.id === id);
    if (c) c.status = 'terminated';
    return;
  }
  await api.post(`/api/v1/fx/cards/${id}/terminate`, {});
}

export async function updateCardControls(id: string, controls: SpendingControls): Promise<Card> {
  if (USE_MOCK) {
    await delay(450);
    const c = MOCK_CARDS.find((x) => x.id === id);
    if (!c) throw new Error('Card not found');
    c.controls = controls;
    return c;
  }
  return unwrap<Card>(await api.patch(`/api/v1/fx/cards/${id}/controls`, controls));
}

export async function getCardTransactions(cardId: string): Promise<CardTransaction[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_CARD_TRANSACTIONS
      .filter((t) => t.cardId === cardId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<CardTransaction[]>(await api.get(`/api/v1/fx/cards/${cardId}/transactions`));
}
