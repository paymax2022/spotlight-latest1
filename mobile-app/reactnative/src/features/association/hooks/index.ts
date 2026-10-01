import { confirmImport, decideApplication, decideOfflinePayment, getAdminKpis, getApplication, getApprovalQueue, getAuditLog, getFinanceSummary, getImportPreview, getOfflinePayments } from '../api/admin.api';
import { assignRole, getMyAdminAccess, restoreMember, suspendMember, transferMember } from '../api/adminMembers.api';
import { approveAiNote, awaitProcessing, convertActionItem, createAiNote, getAiNote, getAiNotes, publishAiNote, regenerateSummary } from '../api/ainotes.api';
import { castVote, getDashboard, getDirectory, getDues, getElection, getElections, getMember, getMembershipCard, getOrganisation, getOrganisations, getReceipt, payInvoice, submitApplication, verifyMembershipCard } from '../api/association.api';
import { CommitteeInput, createCommittee, deleteCommittee, updateCommittee } from '../api/authoring.api';
import { getThread, getThreads, muteThread, reactToMessage, sendMessage } from '../api/chat.api';
import { getCommittee, getCommittees, getEvent, getEvents, registerEvent, requestJoinCommittee, rsvpEvent, submitEventFeedback } from '../api/community.api';
import { acknowledgeAnnouncement, acknowledgeDocument, checkInMeeting, decideMeeting, getAnnouncement, getAnnouncements, getDocument, getDocuments, getMeeting, getMeetings, getNotifications, getPendingMeetings, getTask, getTasks, markNotificationsRead, proposeMeeting, rsvpMeeting, updateTaskStatus } from '../api/engagement.api';
import { validateCode } from '../api/join.api';
import { publishOrganisation } from '../api/orgCreate.api';
import { getActivity, getMyProfile, getPrivacy, updateMyProfile, updatePrivacy } from '../api/profile.api';
import { createTicket, getDevices, getFaqs, getNotificationPrefs, getPreferences, getSecuritySettings, getTicket, getTickets, replyTicket, revokeDevice, updateNotificationPrefs, updatePreferences, updateSecuritySettings } from '../api/settings.api';
import { ASSOCIATION_API_BASE, USE_MOCK } from '../constants';
import type { AdminRole, ApplicationJurisdiction, ApprovalDecision, ChatMessage, ChatThread, CodeKind, CreateAiNoteInput, CreateTicketInput, EventRsvp, MeetingProposalInput, NotificationPrefs, OrgDraft, Preferences, PrivacySettings, ProfileEdit, RsvpStatus, SecuritySettings, SupportTicket, TaskScope, TaskStatus } from '../types';
import type { JoinDraft, MemberDirectoryQuery } from '../types/association.types';
import type { PickedFile } from '../utils';
import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';
import { getDevUrl } from '@/lib/devUrl';
import { openWebSocket } from '@/lib/nativeWebSocket';
import { createSupabaseClient } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';


const KEY = 'association';

export function useAdminKpis() {
  return useQuery({ queryKey: [KEY, 'adminKpis'], queryFn: getAdminKpis, staleTime: 30_000 });
}

export function useApprovalQueue(jurisdiction: ApplicationJurisdiction | 'ALL' = 'ALL') {
  return useQuery({ queryKey: [KEY, 'approvals', jurisdiction], queryFn: () => getApprovalQueue(jurisdiction), staleTime: 20_000 });
}

export function useApplication(id?: string) {
  return useQuery({
    queryKey: [KEY, 'application', id],
    queryFn: () => getApplication(id as string),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

export function useDecideApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: ApprovalDecision; note?: string }) =>
      decideApplication(id, decision, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'approvals'] });
      qc.invalidateQueries({ queryKey: [KEY, 'adminKpis'] });
    },
  });
}

export function useFinanceSummary() {
  return useQuery({ queryKey: [KEY, 'finance'], queryFn: getFinanceSummary, staleTime: 30_000 });
}

export function useOfflinePayments() {
  return useQuery({ queryKey: [KEY, 'offlinePayments'], queryFn: getOfflinePayments, staleTime: 15_000 });
}

export function useDecideOfflinePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideOfflinePayment(id, approve),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'offlinePayments'] });
      qc.invalidateQueries({ queryKey: [KEY, 'finance'] });
    },
  });
}

export function useAuditLog(action: string = 'all') {
  return useQuery({ queryKey: [KEY, 'auditLog', action], queryFn: () => getAuditLog(action), staleTime: 20_000 });
}

/** Cache key the preview screen reads the uploaded dry-run from. */
export const IMPORT_PREVIEW_KEY = [KEY, 'importPreview'] as const;

export function useImportPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, orgId }: { file: PickedFile; orgId?: string }) => getImportPreview(file, orgId),
    // The preview screen cannot re-fetch (multipart endpoint, no file in hand),
    // so hand it the result through the cache.
    onSuccess: (data) => qc.setQueryData(IMPORT_PREVIEW_KEY, data),
  });
}

export function useConfirmImport() {
  return useMutation({ mutationFn: (sendInvites: boolean) => confirmImport(sendInvites) });
}



export function useAdminAccess() {
  return useQuery({ queryKey: [KEY, 'adminAccess'], queryFn: getMyAdminAccess, staleTime: 5 * 60_000 });
}

function useMemberAction() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: [KEY, 'member', id] });
    qc.invalidateQueries({ queryKey: [KEY, 'directory'] });
    qc.invalidateQueries({ queryKey: [KEY, 'adminKpis'] });
  };
}

export function useSuspendMember() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => suspendMember(id, reason),
    onSuccess: (_d, { id }) => invalidate(id),
  });
}

export function useRestoreMember() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: (id: string) => restoreMember(id),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useTransferMember() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: ({ id, chapter }: { id: string; chapter: string }) => transferMember(id, chapter),
    onSuccess: (_d, { id }) => invalidate(id),
  });
}

export function useAssignRole() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: AdminRole }) => assignRole(id, role),
    onSuccess: (_d, { id }) => invalidate(id),
  });
}

// ── Association — AI note-taking hooks (L) ────────────────────────────────────



export function useAiNotes() {
  return useQuery({ queryKey: [KEY, 'aiNotes'], queryFn: getAiNotes, staleTime: 20_000 });
}

export function useAiNote(id?: string) {
  return useQuery({
    queryKey: [KEY, 'aiNote', id],
    queryFn: () => getAiNote(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCreateAiNote() {
  return useMutation({ mutationFn: (input: CreateAiNoteInput) => createAiNote(input) });
}

export function useAwaitProcessing() {
  return useMutation({ mutationFn: (id: string) => awaitProcessing(id) });
}

/**
 * Regeneration is asynchronous server-side and answers `{ ok, status }` — not
 * the new text. Invalidate the note so the screen re-reads the stored summary.
 */
export function useRegenerateSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => regenerateSummary(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'aiNotes'] });
    },
  });
}

export function useApproveAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveAiNote(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'aiNotes'] });
    },
  });
}

export function usePublishAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => publishAiNote(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'aiNotes'] });
    },
  });
}

export function useConvertActionItem(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionItemId: string) => convertActionItem(noteId, actionItemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', noteId] });
      qc.invalidateQueries({ queryKey: [KEY, 'tasks'] });
    },
  });
}

// React Query hooks (mirrors the voting / crowdfunding hook pattern) so screens
// stay declarative and share caching / loading / error contracts.



export function useOrganisations(search?: string) {
  return useQuery({
    queryKey: [KEY, 'orgs', search ?? ''],
    queryFn: () => getOrganisations(search),
    staleTime: 60_000,
  });
}

export function useOrganisation(id?: string) {
  return useQuery({
    queryKey: [KEY, 'org', id],
    queryFn: () => getOrganisation(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useSubmitApplication() {
  return useMutation({
    mutationFn: (draft: JoinDraft) => submitApplication(draft),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: [KEY, 'dashboard'],
    queryFn: getDashboard,
    staleTime: 30_000,
  });
}

export function useMembershipCard() {
  return useQuery({
    queryKey: [KEY, 'card'],
    queryFn: getMembershipCard,
    staleTime: 60_000,
  });
}

/** Verify a scanned membership-card QR token (POST /cards/verify). */
export function useVerifyCard() {
  return useMutation({ mutationFn: (token: string) => verifyMembershipCard(token) });
}

export function useDirectory(query?: MemberDirectoryQuery) {
  return useQuery({
    queryKey: [KEY, 'directory', query ?? {}],
    queryFn: () => getDirectory(query),
    staleTime: 30_000,
  });
}

export function useMember(id?: string) {
  return useQuery({
    queryKey: [KEY, 'member', id],
    queryFn: () => getMember(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useDues() {
  return useQuery({
    queryKey: [KEY, 'dues'],
    queryFn: getDues,
    staleTime: 15_000,
  });
}

export function useReceipt(receiptId?: string) {
  return useQuery({
    queryKey: [KEY, 'receipt', receiptId],
    queryFn: () => getReceipt(receiptId as string),
    enabled: Boolean(receiptId),
    staleTime: 5 * 60_000,
  });
}

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, method }: { invoiceId: string; method: 'WALLET' | 'PAYSTACK' }) =>
      payInvoice(invoiceId, method),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'dues'] });
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
    },
  });
}

export function useElections() {
  return useQuery({ queryKey: [KEY, 'elections'], queryFn: getElections, staleTime: 30_000 });
}

export function useElection(id?: string) {
  return useQuery({
    queryKey: [KEY, 'election', id],
    queryFn: () => getElection(id as string),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useCastVote(electionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { positionId: string; candidateId: string }) =>
      castVote(electionId as string, v.positionId, v.candidateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'election', electionId] });
    },
  });
}



export function useChatThreads() {
  return useQuery({ queryKey: [KEY, 'chatThreads'], queryFn: getThreads, staleTime: 15_000 });
}

export function useChatThread(id?: string) {
  return useQuery({
    queryKey: [KEY, 'chatThread', id],
    queryFn: () => getThread(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, imageUrl }: { body: string; imageUrl?: string | null }) => sendMessage(threadId, body, imageUrl),
    onSuccess: (msg) => {
      qc.setQueryData<ChatThread>([KEY, 'chatThread', threadId], (prev) =>
        prev ? { ...prev, messages: [...prev.messages, msg], lastMessage: msg.imageUrl && !msg.body ? '📷 Photo' : msg.body, lastAt: msg.createdAt } : prev,
      );
      qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] });
    },
  });
}

export function useMuteThread(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) => muteThread(threadId, muted),
    onMutate: (muted) => {
      qc.setQueryData<ChatThread>([KEY, 'chatThread', threadId], (prev) => (prev ? { ...prev, muted } : prev));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] }),
  });
}

export function useReactMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) => reactToMessage(threadId, messageId, emoji),
    onMutate: ({ messageId, emoji }) => {
      // Optimistic toggle of the caller's reaction on the cached message.
      qc.setQueryData<ChatThread>([KEY, 'chatThread', threadId], (prev) => {
        if (!prev) return prev;
        const messages = prev.messages.map((m): ChatMessage => {
          if (m.id !== messageId) return m;
          // `reactions` is optional on the live DTO — treat a missing array as empty.
          const current = m.reactions ?? [];
          const existing = current.find((r) => r.emoji === emoji);
          let reactions;
          if (existing) {
            const nextCount = existing.count + (existing.mine ? -1 : 1);
            reactions = nextCount <= 0
              ? current.filter((r) => r.emoji !== emoji)
              : current.map((r) => (r.emoji === emoji ? { ...r, count: nextCount, mine: !existing.mine } : r));
          } else {
            reactions = [...current, { emoji, count: 1, mine: true }];
          }
          return { ...m, reactions };
        });
        return { ...prev, messages };
      });
    },
  });
}



// ws(s):// URL for the caller's own realtime stream, off the same API base the
// axios client uses (getDevUrl rewrites loopback for a physical device).
function chatWsUrl(): string {
  const base = getDevUrl(resolveApiBaseUrl());
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + ASSOCIATION_API_BASE + '/ws';
}

/** The frame the backend pushes on a committed message. */
interface ChatFrame {
  type?: string;
  payload?: { threadId?: string; id?: string };
}

/**
 * Keeps an open chat thread live.
 *
 * Association chat could send and fetch messages but never received one it had
 * not asked for: a member had to leave the thread and come back to see a reply.
 *
 * TRANSPORT: the backend's own WebSocket hub (platform/ws — the open-source
 * nhooyr/websocket server the food, mobility and doctor streams already use),
 * not a hosted realtime service. A message posted by any member of a thread is
 * pushed to every other member the API would let open it; a nil hub or an
 * unauthenticated socket simply leaves the screen on its normal fetches.
 *
 * INVALIDATES RATHER THAN APPENDING THE PAYLOAD. The pushed row is not the
 * thread's own read model: `mine` is stamped for the AUTHOR, and the audience
 * list carries no per-member reactions or unread state. Appending it to the
 * cache would render a message attributed to the wrong caller. Treating the
 * frame purely as a SIGNAL, and re-reading through the Go API, keeps the API the
 * only thing that decides what a member may see.
 *
 * Delivery is scoped by the backend's ChatThreadAudience gate — the same rule
 * GetChatThread applies, so a member cannot be pushed an executive or committee
 * message they could not fetch. See
 * backend/tests/association/chat_realtime_rls_test.go, which pins the push
 * audience against the API gate for the same users and threads.
 */
export function useAssociationChatRealtime(threadId?: string): void {
  const qc = useQueryClient();

  // Held in a ref so the effect does not re-subscribe on every render — a
  // subscribe/unsubscribe loop drops events and churns the socket.
  const refresh = useRef<() => void>(() => {});
  refresh.current = () => {
    if (threadId) void qc.invalidateQueries({ queryKey: [KEY, 'chatThread', threadId] });
    // The thread list carries the last message and unread count, both of which
    // a new message changes.
    void qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] });
  };

  const retryRef = useRef(0);

  useEffect(() => {
    // a connection that never delivers.
    if (!threadId || USE_MOCK) return;
    // A browser cannot put the Authorization header on a WebSocket, and this
    // route has no ticket or cookie fallback (the food socket trades an HTTP
    // therefore only ever 401 and re-loop, so web stays on its normal fetches.
    if (Platform.OS === 'web') return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
      retryRef.current += 1;
      timer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (stopped) return;
      let token: string | undefined;
      try {
        // The socket is Bearer-authenticated (the route sits behind
        // RequireAuthContext), so it must be handed the user's access token
        // BEFORE opening. A socket that connected as `anon` would be rejected at
        // the handshake — so without a token, do not open one at all.
        const supabase = createSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token;
      } catch {
        /* connect unauthenticated — server rejects, then we back off */
      }
      if (stopped) return;
      try {
        ws = openWebSocket(chatWsUrl(), token ? { Authorization: `Bearer ${token}` } : {});
        ws.onopen = () => {
          retryRef.current = 0;
        };
        ws.onmessage = (e: WebSocketMessageEvent) => {
          try {
            const raw = typeof e.data === 'string' ? e.data : '';
            const frame = JSON.parse(raw) as ChatFrame;
            if (frame?.type !== 'chat.message') return;
            // A user socket carries every thread's messages. Another thread's
            // message still changes the list (last message, unread count), so
            // only the open thread's own messages re-read that thread.
            if (frame.payload?.threadId === threadId) {
              refresh.current();
            } else {
              void qc.invalidateQueries({ queryKey: [KEY, 'chatThreads'] });
            }
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = () => {
          ws = null;
          scheduleReconnect();
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* noop */
          }
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    };
  }, [threadId, qc]);
}



export function useCommittees() {
  return useQuery({ queryKey: [KEY, 'committees'], queryFn: getCommittees, staleTime: 30_000 });
}
export function useCommittee(id?: string) {
  return useQuery({
    queryKey: [KEY, 'committee', id],
    queryFn: () => getCommittee(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
export function useRequestJoinCommittee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestJoinCommittee(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'committee', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'committees'] });
    },
  });
}

// Server-gated on the manageCommittees capability. Screens hide these behind
// the same flag, but the server is the gate that counts.

export function useCreateCommittee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, input }: { orgId: string; input: CommitteeInput }) =>
      createCommittee(orgId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'committees'] }),
  });
}

export function useUpdateCommittee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CommitteeInput }) => updateCommittee(id, input),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'committee', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'committees'] });
    },
  });
}

export function useDeleteCommittee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCommittee(id),
    // The detail query is dropped rather than refetched: the row is gone, and
    // refetching it would 404 on a screen that is already navigating away.
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: [KEY, 'committee', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'committees'] });
    },
  });
}

export function useEvents() {
  return useQuery({ queryKey: [KEY, 'events'], queryFn: getEvents, staleTime: 30_000 });
}
export function useEvent(id?: string) {
  return useQuery({
    queryKey: [KEY, 'event', id],
    queryFn: () => getEvent(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
export function useRsvpEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rsvp }: { id: string; rsvp: EventRsvp }) => rsvpEvent(id, rsvp),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'event', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'events'] });
    },
  });
}
export function useRegisterEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => registerEvent(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'event', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'events'] });
      // Registering for a PAID event raises a dues invoice. The payment screen
      // reads that invoice out of the dues list, so leaving the dues cache
      // stale would send the member to "we couldn't find this invoice" for the
      // invoice that had just been created for them.
      qc.invalidateQueries({ queryKey: [KEY, 'dues'] });
    },
  });
}
export function useSubmitEventFeedback(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rating, comment }: { rating: number; comment: string }) => submitEventFeedback(id, rating, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'event', id] }),
  });
}

export function useCreateOrganisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: OrgDraft) => publishOrganisation(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['association', 'orgs'] }),
  });
}

// React Query hooks for announcements, notifications, meetings, tasks, documents.



export function useAnnouncements() {
  return useQuery({ queryKey: [KEY, 'announcements'], queryFn: getAnnouncements, staleTime: 30_000 });
}
export function useAnnouncement(id?: string) {
  return useQuery({ queryKey: [KEY, 'announcement', id], queryFn: () => getAnnouncement(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useAcknowledgeAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acknowledgeAnnouncement(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'announcement', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'announcements'] });
    },
  });
}

export function useNotifications() {
  return useQuery({ queryKey: [KEY, 'notifications'], queryFn: getNotifications, staleTime: 15_000 });
}
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }),
  });
}

export function useMeetings() {
  return useQuery({ queryKey: [KEY, 'meetings'], queryFn: getMeetings, staleTime: 30_000 });
}
export function useMeeting(id?: string) {
  return useQuery({ queryKey: [KEY, 'meeting', id], queryFn: () => getMeeting(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useRsvpMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RsvpStatus }) => rsvpMeeting(id, status),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'meeting', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'meetings'] });
    },
  });
}
export function useProposeMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MeetingProposalInput) => proposeMeeting(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'meetings'] });
      // An admin's own proposal is approved on insert and leaves the queue
      // untouched; a member's adds to it. Invalidating both covers either.
      qc.invalidateQueries({ queryKey: [KEY, 'pendingMeetings'] });
    },
  });
}
export function usePendingMeetings(orgId?: string) {
  return useQuery({
    queryKey: [KEY, 'pendingMeetings', orgId],
    queryFn: () => getPendingMeetings(orgId as string),
    enabled: Boolean(orgId),
    staleTime: 15_000,
  });
}
export function useDecideMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      decideMeeting(id, approve, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'pendingMeetings'] });
      // An approval puts the meeting on the calendar, so the list changes too.
      qc.invalidateQueries({ queryKey: [KEY, 'meetings'] });
    },
  });
}
export function useCheckInMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => checkInMeeting(id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: [KEY, 'meeting', id] }),
  });
}

export function useTasks(scope: TaskScope = 'mine') {
  return useQuery({ queryKey: [KEY, 'tasks', scope], queryFn: () => getTasks(scope), staleTime: 20_000 });
}
export function useTask(id?: string) {
  return useQuery({ queryKey: [KEY, 'task', id], queryFn: () => getTask(id as string), enabled: Boolean(id), staleTime: 20_000 });
}
export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => updateTaskStatus(id, status),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY, 'task', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'tasks'] });
    },
  });
}

export function useDocuments() {
  return useQuery({ queryKey: [KEY, 'documents'], queryFn: getDocuments, staleTime: 30_000 });
}
export function useDocument(id?: string) {
  return useQuery({ queryKey: [KEY, 'document', id], queryFn: () => getDocument(id as string), enabled: Boolean(id), staleTime: 30_000 });
}
export function useAcknowledgeDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acknowledgeDocument(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'document', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'documents'] });
    },
  });
}

export function useValidateCode(kind: CodeKind) {
  return useMutation({ mutationFn: (code: string) => validateCode(kind, code) });
}



export function useMyProfile() {
  return useQuery({ queryKey: [KEY, 'myProfile'], queryFn: getMyProfile, staleTime: 30_000 });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edit: ProfileEdit) => updateMyProfile(edit),
    onSuccess: (data) => {
      qc.setQueryData([KEY, 'myProfile'], data);
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
    },
  });
}

export function usePrivacy() {
  return useQuery({ queryKey: [KEY, 'privacy'], queryFn: getPrivacy, staleTime: 30_000 });
}

export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: PrivacySettings) => updatePrivacy(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'privacy'], data),
  });
}

export function useActivity() {
  return useQuery({ queryKey: [KEY, 'activity'], queryFn: getActivity, staleTime: 30_000 });
}



export function useNotificationPrefs() {
  return useQuery({ queryKey: [KEY, 'notifPrefs'], queryFn: getNotificationPrefs, staleTime: 30_000 });
}
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: NotificationPrefs) => updateNotificationPrefs(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'notifPrefs'], data),
  });
}
export function useSecuritySettings() {
  return useQuery({ queryKey: [KEY, 'security'], queryFn: getSecuritySettings, staleTime: 30_000 });
}
export function useUpdateSecuritySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: SecuritySettings) => updateSecuritySettings(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'security'], data),
  });
}
export function useDevices() {
  return useQuery({ queryKey: [KEY, 'devices'], queryFn: getDevices, staleTime: 30_000 });
}
export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'devices'] }),
  });
}

export function usePreferences() {
  return useQuery({ queryKey: [KEY, 'preferences'], queryFn: getPreferences, staleTime: 60_000 });
}
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: Preferences) => updatePreferences(next),
    onSuccess: (data) => qc.setQueryData([KEY, 'preferences'], data),
  });
}

export function useFaqs() {
  return useQuery({ queryKey: [KEY, 'faqs'], queryFn: getFaqs, staleTime: 5 * 60_000 });
}
export function useTickets() {
  return useQuery({ queryKey: [KEY, 'tickets'], queryFn: getTickets, staleTime: 20_000 });
}
export function useTicket(id?: string) {
  return useQuery({
    queryKey: [KEY, 'ticket', id],
    queryFn: () => getTicket(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => createTicket(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'tickets'] }),
  });
}
export function useReplyTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => replyTicket(id, body),
    onSuccess: (msg) => {
      qc.setQueryData<SupportTicket>([KEY, 'ticket', id], (prev) =>
        prev ? { ...prev, messages: [...prev.messages, msg] } : prev,
      );
    },
  });
}
