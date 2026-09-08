// ── Crowdfunding — Wallet / support / notifications / rewards / settings API ──
// Mock-backed; mirrors crowdfunding.api.ts conventions. Money in kobo.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  CampaignWalletSummary,
  LedgerEntry,
  BankAccount,
  WithdrawalRequestInput,
  SupportTicket,
  CreateTicketInput,
  HelpArticle,
  AppNotification,
  RewardBacker,
  RewardFulfilmentStatus,
  NotificationPrefs,
  TicketMessage,
  CampaignComment,
  PostUpdateInput,
  BroadcastInput,
} from '../types/crowdfunding.types';
import {
  MOCK_WALLET,
  MOCK_LEDGER,
  MOCK_BANK_ACCOUNTS,
  MOCK_TICKETS,
  MOCK_HELP,
  MOCK_NOTIFICATIONS,
  MOCK_BACKERS,
  MOCK_NOTIFICATION_PREFS,
  MOCK_COMMENTS,
} from './crowdfundingExtras.mock';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_CF_USE_MOCK, true);
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ─── Wallet & ledger ──────────────────────────────────────────────────────────

export async function getCampaignWallet(campaignId?: string): Promise<CampaignWalletSummary> {
  if (USE_MOCK) { await delay(200); return MOCK_WALLET; }
  // Proxy: /api/v1/crowdfunding/wallet/[id] → Go GET /api/finance/crowdfunding/campaigns/:id/wallet
  const res = await api.get(`/api/v1/crowdfunding/wallet/${campaignId}`);
  return res.data?.data ?? res.data;
}

export async function getLedger(campaignId?: string, type?: string): Promise<LedgerEntry[]> {
  if (USE_MOCK) {
    await delay();
    return type ? MOCK_LEDGER.filter((e) => e.type === type) : MOCK_LEDGER;
  }
  // Proxy: /api/v1/crowdfunding/ledger/[id] → Go GET /api/finance/crowdfunding/campaigns/:id/ledger
  // NOTE: [id] here is the CAMPAIGN id (the feed), not a ledger entry id.
  const res = await api.get(`/api/v1/crowdfunding/ledger/${campaignId}`, { params: { type } });
  return res.data?.data ?? res.data;
}

export async function getLedgerEntry(id: string): Promise<LedgerEntry> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_LEDGER.find((e) => e.id === id || e.reference === id);
    if (!found) throw new Error('Entry not found');
    return found;
  }
  // Proxy: /api/v1/crowdfunding/ledger-entry/[id] → Go GET /api/finance/crowdfunding/ledger/:id
  const res = await api.get(`/api/v1/crowdfunding/ledger-entry/${id}`);
  return res.data?.data ?? res.data;
}

export async function getBankAccounts(): Promise<BankAccount[]> {
  if (USE_MOCK) { await delay(180); return MOCK_BANK_ACCOUNTS; }
  const res = await api.get('/api/v1/crowdfunding/bank-accounts');
  return res.data?.data ?? res.data;
}

export async function submitWithdrawal(input: WithdrawalRequestInput, idempotencyKey: string): Promise<{ reference: string; status: string }> {
  if (USE_MOCK) { await delay(800); return { reference: `SPL-WD-${Date.now()}`, status: 'PENDING' }; }
  // Proxy: /api/v1/crowdfunding/withdraw/[id] → Go POST /api/finance/crowdfunding/campaigns/:id/withdrawal-request
  // Money mutation — the proxy route rejects the request if Idempotency-Key is missing.
  const res = await api.post(`/api/v1/crowdfunding/withdraw/${input.campaignId}`, input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return res.data?.data ?? res.data;
}

// ─── Support & help ───────────────────────────────────────────────────────────

export async function getHelpArticles(): Promise<HelpArticle[]> {
  if (USE_MOCK) { await delay(160); return MOCK_HELP; }
  const res = await api.get('/api/v1/crowdfunding/help');
  return res.data?.data ?? res.data;
}

export async function getTickets(): Promise<SupportTicket[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_TICKETS].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }
  const res = await api.get('/api/v1/crowdfunding/support/tickets');
  return res.data?.data ?? res.data;
}

export async function getTicket(id: string): Promise<SupportTicket> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_TICKETS.find((t) => t.id === id || t.reference === id);
    if (!found) throw new Error('Ticket not found');
    return found;
  }
  const res = await api.get(`/api/v1/crowdfunding/support/tickets/${id}`);
  return res.data?.data ?? res.data;
}

export async function createTicket(input: CreateTicketInput): Promise<SupportTicket> {
  if (USE_MOCK) {
    await delay(600);
    const now = new Date().toISOString();
    const ticket: SupportTicket = {
      id: `t${Date.now()}`, reference: `SPL-TK-${Math.floor(Math.random() * 9000) + 1000}`,
      subject: input.subject, category: input.category, status: 'OPEN', createdAt: now, updatedAt: now,
      messages: [{ id: 'm1', from: 'user', body: input.body, createdAt: now }],
    };
    MOCK_TICKETS.unshift(ticket);
    return ticket;
  }
  const res = await api.post('/api/v1/crowdfunding/support/tickets', input);
  return res.data?.data ?? res.data;
}

export async function replyTicket(ticketId: string, body: string): Promise<TicketMessage> {
  if (USE_MOCK) {
    await delay(400);
    const t = MOCK_TICKETS.find((x) => x.id === ticketId);
    const msg: TicketMessage = { id: `m${Date.now()}`, from: 'user', body, createdAt: new Date().toISOString() };
    if (t) { t.messages.push(msg); t.updatedAt = msg.createdAt; t.status = 'PENDING'; }
    return msg;
  }
  const res = await api.post(`/api/v1/crowdfunding/support/tickets/${ticketId}/reply`, { body });
  return res.data?.data ?? res.data;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(): Promise<AppNotification[]> {
  if (USE_MOCK) { await delay(200); return MOCK_NOTIFICATIONS; }
  const res = await api.get('/api/v1/crowdfunding/notifications');
  return res.data?.data ?? res.data;
}

export async function markNotificationsRead(): Promise<void> {
  if (USE_MOCK) { await delay(120); MOCK_NOTIFICATIONS.forEach((n) => (n.read = true)); return; }
  await api.post('/api/v1/crowdfunding/notifications/read');
}

// ─── Reward fulfilment ────────────────────────────────────────────────────────

export async function getRewardBackers(status?: string): Promise<RewardBacker[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_BACKERS.filter((b) => b.status === status) : MOCK_BACKERS;
  }
  const res = await api.get('/api/v1/crowdfunding/rewards/backers', { params: { status } });
  return res.data?.data ?? res.data;
}

export async function updateRewardStatus(backerId: string, status: RewardFulfilmentStatus): Promise<void> {
  if (USE_MOCK) {
    await delay(400);
    const b = MOCK_BACKERS.find((x) => x.id === backerId);
    if (b) b.status = status;
    return;
  }
  await api.put(`/api/v1/crowdfunding/rewards/fulfilment/${backerId}`, { status });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (USE_MOCK) { await delay(160); return { ...MOCK_NOTIFICATION_PREFS }; }
  const res = await api.get('/api/v1/crowdfunding/settings/notifications');
  return res.data?.data ?? res.data;
}

export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  if (USE_MOCK) { await delay(200); Object.assign(MOCK_NOTIFICATION_PREFS, prefs); return prefs; }
  const res = await api.put('/api/v1/crowdfunding/settings/notifications', prefs);
  return res.data?.data ?? res.data;
}

// ─── Updates & communication (Section H) ──────────────────────────────────────

export async function getComments(campaignId: string): Promise<CampaignComment[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_COMMENTS
      .filter((c) => c.campaignId === campaignId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const res = await api.get(`/api/v1/crowdfunding/campaigns/${campaignId}/comments`);
  return res.data?.data ?? res.data;
}

export async function postComment(campaignId: string, body: string, isQuestion: boolean): Promise<CampaignComment> {
  if (USE_MOCK) {
    await delay(400);
    const comment: CampaignComment = {
      id: `cm${Date.now()}`, campaignId, authorName: 'You', avatarUrl: null, body,
      createdAt: new Date().toISOString(), isQuestion, isCreator: false, reported: false, replies: [],
    };
    MOCK_COMMENTS.unshift(comment);
    return comment;
  }
  const res = await api.post(`/api/v1/crowdfunding/campaigns/${campaignId}/comments`, { body, isQuestion });
  return res.data?.data ?? res.data;
}

export async function replyComment(commentId: string, body: string): Promise<void> {
  if (USE_MOCK) {
    await delay(350);
    const c = MOCK_COMMENTS.find((x) => x.id === commentId);
    if (c) c.replies.push({ id: `rp${Date.now()}`, authorName: 'You (creator)', body, createdAt: new Date().toISOString(), isCreator: true });
    return;
  }
  await api.post(`/api/v1/crowdfunding/comments/${commentId}/reply`, { body });
}

export async function reportComment(commentId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(250);
    const c = MOCK_COMMENTS.find((x) => x.id === commentId);
    if (c) c.reported = true;
    return;
  }
  await api.post(`/api/v1/crowdfunding/comments/${commentId}/report`);
}

export async function postCampaignUpdate(input: PostUpdateInput): Promise<{ id: string }> {
  if (USE_MOCK) { await delay(600); return { id: `up${Date.now()}` }; }
  const res = await api.post(`/api/v1/crowdfunding/campaigns/${input.campaignId}/updates`, input);
  return res.data?.data ?? res.data;
}

export async function broadcastToContributors(input: BroadcastInput): Promise<{ recipients: number }> {
  if (USE_MOCK) { await delay(600); return { recipients: 412 }; }
  const res = await api.post(`/api/v1/crowdfunding/campaigns/${input.campaignId}/broadcast`, input);
  return res.data?.data ?? res.data;
}
