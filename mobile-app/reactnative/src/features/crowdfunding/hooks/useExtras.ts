// ── Crowdfunding — Wallet / support / notifications / rewards / settings hooks ─

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCampaignWallet, getLedger, getLedgerEntry, getBankAccounts, submitWithdrawal,
  getHelpArticles, getTickets, getTicket, createTicket, replyTicket,
  getNotifications, markNotificationsRead,
  getRewardBackers, updateRewardStatus,
  getNotificationPrefs, updateNotificationPrefs,
  getComments, postComment, replyComment, reportComment, postCampaignUpdate, broadcastToContributors,
} from '../api/crowdfundingExtras.api';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  WithdrawalRequestInput, CreateTicketInput, NotificationPrefs, RewardFulfilmentStatus,
  PostUpdateInput, BroadcastInput,
} from '../types/crowdfunding.types';

const KEY = 'crowdfunding';

// Callers may not have a campaign id resolved yet (e.g. a bare wallet entry
// point still waiting on the creator's default campaign) — `enabled` holds
// the request rather than sending `campaignId` as the literal string
// "undefined" to the API.
export function useCampaignWallet(campaignId?: string) {
  return useQuery({ queryKey: [KEY, 'wallet', campaignId ?? 'me'], queryFn: () => getCampaignWallet(campaignId), staleTime: 20_000, enabled: Boolean(campaignId) });
}
export function useLedger(campaignId?: string, type?: string) {
  return useQuery({ queryKey: [KEY, 'ledger', campaignId ?? 'me', type ?? 'all'], queryFn: () => getLedger(campaignId, type), staleTime: 20_000, enabled: Boolean(campaignId) });
}
export function useLedgerEntry(id?: string) {
  return useQuery({ queryKey: [KEY, 'ledger-entry', id], queryFn: () => getLedgerEntry(id as string), enabled: Boolean(id) });
}
export function useBankAccounts() {
  return useQuery({ queryKey: [KEY, 'banks'], queryFn: getBankAccounts, staleTime: 60_000 });
}
export function useSubmitWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WithdrawalRequestInput) => submitWithdrawal(input, generateIdempotencyKey()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'wallet'] }); qc.invalidateQueries({ queryKey: [KEY, 'creator', 'withdrawals'] }); },
  });
}

export function useHelpArticles() {
  return useQuery({ queryKey: [KEY, 'help'], queryFn: getHelpArticles, staleTime: 5 * 60_000 });
}
export function useTickets() {
  return useQuery({ queryKey: [KEY, 'tickets'], queryFn: getTickets, staleTime: 15_000 });
}
export function useTicket(id?: string) {
  return useQuery({ queryKey: [KEY, 'ticket', id], queryFn: () => getTicket(id as string), enabled: Boolean(id) });
}
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateTicketInput) => createTicket(input), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'tickets'] }) });
}
export function useReplyTicket(ticketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => replyTicket(ticketId as string, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'ticket', ticketId] }); qc.invalidateQueries({ queryKey: [KEY, 'tickets'] }); },
  });
}

export function useNotifications() {
  return useQuery({ queryKey: [KEY, 'notifications'], queryFn: getNotifications, staleTime: 15_000 });
}
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: markNotificationsRead, onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }) });
}

export function useRewardBackers(status?: string) {
  return useQuery({ queryKey: [KEY, 'backers', status ?? 'all'], queryFn: () => getRewardBackers(status), staleTime: 20_000 });
}
export function useUpdateRewardStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ backerId, status }: { backerId: string; status: RewardFulfilmentStatus }) => updateRewardStatus(backerId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'backers'] }),
  });
}

export function useNotificationPrefs() {
  return useQuery({ queryKey: [KEY, 'notif-prefs'], queryFn: getNotificationPrefs, staleTime: 60_000 });
}
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (prefs: NotificationPrefs) => updateNotificationPrefs(prefs), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notif-prefs'] }) });
}

export function useComments(campaignId?: string) {
  return useQuery({ queryKey: [KEY, 'comments', campaignId], queryFn: () => getComments(campaignId as string), enabled: Boolean(campaignId), staleTime: 15_000 });
}
export function usePostComment(campaignId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, isQuestion }: { body: string; isQuestion: boolean }) => postComment(campaignId as string, body, isQuestion),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'comments', campaignId] }),
  });
}
export function useReplyComment(campaignId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) => replyComment(commentId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'comments', campaignId] }),
  });
}
export function useReportComment(campaignId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => reportComment(commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'comments', campaignId] }),
  });
}
export function usePostUpdate() {
  return useMutation({ mutationFn: (input: PostUpdateInput) => postCampaignUpdate(input) });
}
export function useBroadcast() {
  return useMutation({ mutationFn: (input: BroadcastInput) => broadcastToContributors(input) });
}
