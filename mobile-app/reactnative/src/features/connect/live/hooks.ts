// Paymax Connect — LIVE STREAMING hooks (React Query v5).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as liveApi from './api';
import type { LiveCategory } from './types';

export const liveKeys = {
  all: ['connect', 'live'] as const,
  streams: (c: LiveCategory) => [...liveKeys.all, 'streams', c] as const,
  stream: (id: string) => [...liveKeys.all, 'stream', id] as const,
  chat: (id: string) => [...liveKeys.all, 'chat', id] as const,
  gifts: () => [...liveKeys.all, 'gifts'] as const,
  pk: (id: string) => [...liveKeys.all, 'pk', id] as const,
  leaderboard: (k: string) => [...liveKeys.all, 'leaderboard', k] as const,
  replays: () => [...liveKeys.all, 'replays'] as const,
  cohost: (id: string) => [...liveKeys.all, 'cohost', id] as const,
  reportReasons: () => [...liveKeys.all, 'report-reasons'] as const,
  preflight: () => [...liveKeys.all, 'preflight'] as const,
  session: () => [...liveKeys.all, 'session'] as const,
  viewers: () => [...liveKeys.all, 'viewers'] as const,
  summary: () => [...liveKeys.all, 'summary'] as const,
};

export function useLiveStreams(category: LiveCategory = 'all') {
  return useQuery({ queryKey: liveKeys.streams(category), queryFn: () => liveApi.listLiveStreams(category) });
}

export function useLiveStream(id: string) {
  return useQuery({ queryKey: liveKeys.stream(id), queryFn: () => liveApi.getLiveStream(id), enabled: !!id });
}

export function useLiveChat(id: string) {
  return useQuery({ queryKey: liveKeys.chat(id), queryFn: () => liveApi.getLiveChat(id), enabled: !!id });
}

export function useSendLiveChat(streamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => liveApi.sendLiveChat(streamId, text),
    onSuccess: (msg) =>
      qc.setQueryData(liveKeys.chat(streamId), (prev: unknown) =>
        Array.isArray(prev) ? [...prev, msg] : [msg]),
  });
}

export function useGifts() {
  return useQuery({ queryKey: liveKeys.gifts(), queryFn: liveApi.listGifts });
}

export function useSendGift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: liveApi.sendGift,
    onSuccess: () => {
      // tier status changed (real money debited) — invalidate the shared widget source.
      qc.invalidateQueries({ queryKey: ['connect', 'tier-status'] });
    },
  });
}

export function usePkBattle(streamId: string) {
  return useQuery({ queryKey: liveKeys.pk(streamId), queryFn: () => liveApi.getPkBattle(streamId), enabled: !!streamId });
}

export function useLiveLeaderboard(kind: 'gifters' | 'streamers') {
  return useQuery({ queryKey: liveKeys.leaderboard(kind), queryFn: () => liveApi.getLiveLeaderboard(kind) });
}

export function useReplays() {
  return useQuery({ queryKey: liveKeys.replays(), queryFn: liveApi.listReplays });
}

export function useCoHostRequests(streamId: string) {
  return useQuery({ queryKey: liveKeys.cohost(streamId), queryFn: () => liveApi.listCoHostRequests(streamId), enabled: !!streamId });
}

export function useRespondCoHost(streamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: liveApi.respondCoHostRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: liveKeys.cohost(streamId) }),
  });
}

export function useStreamReportReasons() {
  return useQuery({ queryKey: liveKeys.reportReasons(), queryFn: liveApi.getStreamReportReasons });
}

export function useReportStream() {
  return useMutation({ mutationFn: liveApi.reportStream });
}

export function useBroadcastPreflight() {
  return useQuery({ queryKey: liveKeys.preflight(), queryFn: liveApi.getBroadcastPreflight });
}

export function useBroadcastSession() {
  return useQuery({ queryKey: liveKeys.session(), queryFn: liveApi.getBroadcastSession });
}

export function useStartBroadcast() {
  return useMutation({ mutationFn: liveApi.startBroadcast });
}

export function useLiveViewers() {
  return useQuery({ queryKey: liveKeys.viewers(), queryFn: liveApi.listLiveViewers });
}

export function useModerateViewer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: liveApi.moderateViewer,
    onSuccess: () => qc.invalidateQueries({ queryKey: liveKeys.viewers() }),
  });
}

export function useStreamSummary() {
  return useQuery({ queryKey: liveKeys.summary(), queryFn: liveApi.getStreamSummary });
}
