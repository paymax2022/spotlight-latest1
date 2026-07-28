// ── Spotlight Academy — React Query hooks (v5) ───────────────────────────────
// Declarative data hooks the learner screens reuse. Mirrors the health module.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Api from './api';
import type { ProfileUpdate, CreateOrderInput, CreatePotInput } from './api';
import type { AcademyRole, PracticeSubmission, Bundle, UsageControls, SavingsPot } from './types';

const KEY = 'academy';

// ── Identity ──────────────────────────────────────────────────────────────────
export function useMe() {
  return useQuery({ queryKey: [KEY, 'me'], queryFn: Api.getMe, staleTime: 30_000 });
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: AcademyRole) => Api.setRole(role),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'me'] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileUpdate) => Api.updateProfile(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'me'] }),
  });
}

export function useLinkGuardian() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) => Api.linkGuardian(phone),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'me'] }),
  });
}

export function useRecordConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { minorId: string; granted: boolean }) => Api.recordConsent(args.minorId, args.granted),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'me'] }),
  });
}

// ── Curriculum ────────────────────────────────────────────────────────────────
export function useCurriculumVersions() {
  return useQuery({ queryKey: [KEY, 'cv'], queryFn: Api.getCurriculumVersions, staleTime: 5 * 60_000 });
}

export function useClasses() {
  return useQuery({ queryKey: [KEY, 'classes'], queryFn: Api.getClasses, staleTime: 5 * 60_000 });
}

export function useSubjects(classCode?: string) {
  return useQuery({ queryKey: [KEY, 'subjects', classCode ?? 'me'], queryFn: () => Api.getSubjects(classCode), staleTime: 60_000 });
}

export function useSubject(id?: string) {
  return useQuery({ queryKey: [KEY, 'subject', id], queryFn: () => Api.getSubject(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useTopics(subjectId?: string) {
  return useQuery({ queryKey: [KEY, 'topics', subjectId], queryFn: () => Api.getTopics(subjectId as string), enabled: !!subjectId, staleTime: 60_000 });
}

export function useTopic(id?: string) {
  return useQuery({ queryKey: [KEY, 'topic', id], queryFn: () => Api.getTopic(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useObjectives(topicId?: string) {
  return useQuery({ queryKey: [KEY, 'objectives', topicId], queryFn: () => Api.getObjectives(topicId as string), enabled: !!topicId, staleTime: 60_000 });
}

export function useLessons(topicId?: string) {
  return useQuery({ queryKey: [KEY, 'lessons', topicId], queryFn: () => Api.getLessons(topicId as string), enabled: !!topicId, staleTime: 60_000 });
}

export function useLesson(id?: string) {
  return useQuery({ queryKey: [KEY, 'lesson', id], queryFn: () => Api.getLesson(id as string), enabled: !!id, staleTime: 60_000 });
}

// ── Assessment ────────────────────────────────────────────────────────────────
export function usePractice(objectiveId?: string) {
  return useQuery({ queryKey: [KEY, 'practice', objectiveId ?? 'mixed'], queryFn: () => Api.getPractice(objectiveId), staleTime: 0 });
}

export function useSubmitPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sub: PracticeSubmission) => Api.submitPractice(sub),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'mastery'] });
      qc.invalidateQueries({ queryKey: [KEY, 'rewards'] });
    },
  });
}

export function useMastery() {
  return useQuery({ queryKey: [KEY, 'mastery'], queryFn: Api.getMastery, staleTime: 30_000 });
}

// ── Exam ──────────────────────────────────────────────────────────────────────
export function useArenas() {
  return useQuery({ queryKey: [KEY, 'arenas'], queryFn: Api.getArenas, staleTime: 60_000 });
}

export function useArena(id?: string) {
  return useQuery({ queryKey: [KEY, 'arena', id], queryFn: () => Api.getArena(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useBlueprints(arenaId?: string) {
  return useQuery({ queryKey: [KEY, 'blueprints', arenaId], queryFn: () => Api.getBlueprints(arenaId as string), enabled: !!arenaId, staleTime: 60_000 });
}

export function useUtmeCombinations(course?: string) {
  return useQuery({ queryKey: [KEY, 'utme-combos', course ?? 'all'], queryFn: () => Api.getUtmeCombinations(course), staleTime: 5 * 60_000 });
}

export function useStartAttempt() {
  return useMutation({ mutationFn: (blueprintId: string) => Api.startAttempt(blueprintId) });
}

export function useAttempt(id?: string) {
  return useQuery({ queryKey: [KEY, 'attempt', id], queryFn: () => Api.getAttempt(id as string), enabled: !!id, staleTime: 0 });
}

export function useExamResult(id?: string) {
  return useQuery({ queryKey: [KEY, 'exam-result', id], queryFn: () => Api.getExamResult(id as string), enabled: !!id, retry: 2, staleTime: 60_000 });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Api.submitAttempt(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'arenas'] });
      qc.invalidateQueries({ queryKey: [KEY, 'rewards'] });
    },
  });
}

// ── Gamification ─────────────────────────────────────────────────────────────
export function useGamificationProfile() {
  return useQuery({ queryKey: [KEY, 'gamification'], queryFn: Api.getGamificationProfile, staleTime: 30_000 });
}

export function useBadges() {
  return useQuery({ queryKey: [KEY, 'badges'], queryFn: Api.getBadges, staleTime: 60_000 });
}

export function useChallenges() {
  return useQuery({ queryKey: [KEY, 'challenges'], queryFn: Api.getChallenges, staleTime: 60_000 });
}

export function useLeaderboard(id = 'national') {
  return useQuery({ queryKey: [KEY, 'leaderboard', id], queryFn: () => Api.getLeaderboard(id), staleTime: 60_000 });
}

// ── Rewards ──────────────────────────────────────────────────────────────────
export function useRewardBalance() {
  return useQuery({ queryKey: [KEY, 'rewards', 'balance'], queryFn: Api.getRewardBalance, staleTime: 15_000 });
}

export function useRewardHistory() {
  return useQuery({ queryKey: [KEY, 'rewards', 'history'], queryFn: Api.getRewardHistory, staleTime: 15_000 });
}

export function useRewardCatalog() {
  return useQuery({ queryKey: [KEY, 'rewards', 'catalog'], queryFn: Api.getRewardCatalog, staleTime: 60_000 });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => Api.redeemReward(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'rewards'] });
      qc.invalidateQueries({ queryKey: [KEY, 'wallet'] });
    },
  });
}

// ── Commerce ─────────────────────────────────────────────────────────────────
export function usePlans() {
  return useQuery({ queryKey: [KEY, 'plans'], queryFn: Api.getPlans, staleTime: 60_000 });
}

export function useBundles(examSlug?: Bundle['examSlug']) {
  return useQuery({ queryKey: [KEY, 'bundles', examSlug ?? 'all'], queryFn: () => Api.getBundles(examSlug), staleTime: 60_000 });
}

export function useBundle(id?: string) {
  return useQuery({ queryKey: [KEY, 'bundle', id], queryFn: () => Api.getBundle(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useBundleManifest(id?: string) {
  return useQuery({ queryKey: [KEY, 'bundle-manifest', id], queryFn: () => Api.getBundleManifest(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useCreateOrder() {
  return useMutation({ mutationFn: (input: CreateOrderInput) => Api.createOrder(input) });
}

export function usePayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orderId: string; amountKobo: number; bundleId?: string }) => Api.payOrder(args.orderId, args.amountKobo, args.bundleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'wallet'] }),
  });
}

export function useBnplOrder() {
  return useMutation({
    mutationFn: (args: { orderId: string; amountKobo: number; instalments: number; bundleId?: string }) =>
      Api.bnplOrder(args.orderId, args.amountKobo, args.instalments, args.bundleId),
  });
}

export function useActivateAccessCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => Api.activateAccessCard(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'wallet'] }),
  });
}

// ── Wallet ───────────────────────────────────────────────────────────────────
export function useWallet() {
  return useQuery({ queryKey: [KEY, 'wallet'], queryFn: Api.getWallet, staleTime: 15_000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — hooks
// ═══════════════════════════════════════════════════════════════════════════════

// ── Progression ──────────────────────────────────────────────────────────────
export function usePath(subjectId?: string) {
  return useQuery({ queryKey: [KEY, 'path', subjectId], queryFn: () => Api.getPath(subjectId as string), enabled: !!subjectId, staleTime: 60_000 });
}

export function useCreatePath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subjectId: string) => Api.createPath(subjectId),
    onSuccess: (_d, subjectId) => qc.invalidateQueries({ queryKey: [KEY, 'path', subjectId] }),
  });
}

export function useAdvanceStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (objectiveId: string) => Api.advanceStep(objectiveId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'path'] }); qc.invalidateQueries({ queryKey: [KEY, 'mastery'] }); },
  });
}

export function useAdaptiveSet() {
  return useMutation({ mutationFn: (subjectId?: string) => Api.getAdaptiveSet(subjectId) });
}

export function useRecommendations() {
  return useQuery({ queryKey: [KEY, 'recommendations'], queryFn: Api.getRecommendations, staleTime: 60_000 });
}

// ── Parent / Guardian ────────────────────────────────────────────────────────
export function useChildren() {
  return useQuery({ queryKey: [KEY, 'children'], queryFn: Api.getChildren, staleTime: 30_000 });
}

export function useChildDashboard(minorId?: string) {
  return useQuery({ queryKey: [KEY, 'child-dash', minorId], queryFn: () => Api.getChildDashboard(minorId as string), enabled: !!minorId, staleTime: 30_000 });
}

export function useChildSubject(minorId?: string, subjectId?: string) {
  return useQuery({ queryKey: [KEY, 'child-subject', minorId, subjectId], queryFn: () => Api.getChildSubject(minorId as string, subjectId as string), enabled: !!minorId && !!subjectId, staleTime: 30_000 });
}

export function useControls(minorId?: string) {
  return useQuery({ queryKey: [KEY, 'controls', minorId], queryFn: () => Api.getControls(minorId as string), enabled: !!minorId, staleTime: 30_000 });
}

export function useUpdateControls() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { minorId: string; input: Partial<UsageControls> }) => Api.updateControls(args.minorId, args.input),
    onSuccess: (_d, args) => { qc.invalidateQueries({ queryKey: [KEY, 'controls', args.minorId] }); qc.invalidateQueries({ queryKey: [KEY, 'children'] }); },
  });
}

export function useReports(minorId?: string) {
  return useQuery({ queryKey: [KEY, 'reports', minorId ?? 'all'], queryFn: () => Api.getReports(minorId), staleTime: 30_000 });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { minorId: string; period: 'weekly' | 'termly' }) => Api.generateReport(args.minorId, args.period),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'reports'] }),
  });
}

export function useApprovals() {
  return useQuery({ queryKey: [KEY, 'approvals'], queryFn: Api.getApprovals, staleTime: 15_000 });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; approve: boolean }) => Api.decideApproval(args.id, args.approve),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'approvals'] }),
  });
}

export function useParentNotifications() {
  return useQuery({ queryKey: [KEY, 'parent-notifications'], queryFn: Api.getParentNotifications, staleTime: 30_000 });
}

export function useSubscriptions() {
  return useQuery({ queryKey: [KEY, 'subscriptions'], queryFn: Api.getSubscriptions, staleTime: 60_000 });
}

export function useInvoices() {
  return useQuery({ queryKey: [KEY, 'invoices'], queryFn: Api.getInvoices, staleTime: 60_000 });
}

// ── EduPay ───────────────────────────────────────────────────────────────────
export function useSchools(query?: string) {
  return useQuery({ queryKey: [KEY, 'schools', query ?? 'all'], queryFn: () => Api.getSchools(query), staleTime: 60_000 });
}

export function useFeeSchedules() {
  return useQuery({ queryKey: [KEY, 'fee-schedules'], queryFn: Api.getFeeSchedules, staleTime: 60_000 });
}

export function useEduPayProfile() {
  return useQuery({ queryKey: [KEY, 'edupay'], queryFn: Api.getEduPayProfile, staleTime: 30_000 });
}

export function useLinkSchool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { schoolId: string; feeScheduleId?: string }) => Api.linkSchool(args.schoolId, args.feeScheduleId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'edupay'] }); qc.invalidateQueries({ queryKey: [KEY, 'schools'] }); qc.invalidateQueries({ queryKey: [KEY, 'fee-schedules'] }); },
  });
}

export function usePayFees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { feeScheduleId: string; amountKobo: number; method: 'wallet' | 'bnpl'; instalments?: number }) =>
      Api.payFees(args.feeScheduleId, args.amountKobo, args.method, args.instalments),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'edupay'] }); qc.invalidateQueries({ queryKey: [KEY, 'wallet'] }); },
  });
}

export function usePots() {
  return useQuery({ queryKey: [KEY, 'pots'], queryFn: Api.getPots, staleTime: 30_000 });
}

export function useCreatePot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePotInput) => Api.createPot(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'pots'] }),
  });
}

export function useFundPot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { potId: string; amountKobo: number }) => Api.fundPot(args.potId, args.amountKobo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'pots'] }); qc.invalidateQueries({ queryKey: [KEY, 'wallet'] }); },
  });
}

export function usePayFromPot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { potId: string; feeScheduleId: string }) => Api.payFromPot(args.potId, args.feeScheduleId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'pots'] }); qc.invalidateQueries({ queryKey: [KEY, 'edupay'] }); },
  });
}

export function useScholarships() {
  return useQuery({ queryKey: [KEY, 'scholarships'], queryFn: Api.getScholarships, staleTime: 60_000 });
}

export function useApplyScholarship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => Api.applyScholarship(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'scholarships'] }),
  });
}

// ── Learner: daily goal, search, bookmarks, notes, downloads ─────────────────
export function useDailyGoal() {
  return useQuery({ queryKey: [KEY, 'daily-goal'], queryFn: Api.getDailyGoal, staleTime: 30_000 });
}

export function useSearch(query: string) {
  return useQuery({ queryKey: [KEY, 'search', query], queryFn: () => Api.searchAcademy(query), enabled: query.trim().length > 0, staleTime: 10_000 });
}

export function useBookmarks() {
  return useQuery({ queryKey: [KEY, 'bookmarks'], queryFn: Api.getBookmarks, staleTime: 30_000 });
}

export function useRemoveBookmark() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => Api.removeBookmark(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'bookmarks'] }) });
}

export function useNotes() {
  return useQuery({ queryKey: [KEY, 'notes'], queryFn: Api.getNotes, staleTime: 30_000 });
}

export function useSaveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lessonId: string; lessonTitle: string; subjectName: string; body: string }) =>
      Api.saveNote(args.lessonId, args.lessonTitle, args.subjectName, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notes'] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => Api.deleteNote(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notes'] }) });
}

export function useDownloads() {
  return useQuery({ queryKey: [KEY, 'downloads'], queryFn: Api.getDownloads, staleTime: 15_000 });
}

export function useStorageInfo() {
  return useQuery({ queryKey: [KEY, 'storage'], queryFn: Api.getStorageInfo, staleTime: 15_000 });
}

export function useSetDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { bundleId: string; download: boolean }) => Api.setDownload(args.bundleId, args.download),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'downloads'] }); qc.invalidateQueries({ queryKey: [KEY, 'storage'] }); },
  });
}

export function useSyncDownload() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (bundleId: string) => Api.syncDownload(bundleId), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'downloads'] }) });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — hooks (Trade & Skills, credentials/earning, live/community)
// ═══════════════════════════════════════════════════════════════════════════════
import type {
  SubmitProjectInput,
  TakeAssessmentInput,
  CreateGroupInput,
  CreateDiscussionInput,
} from './api';
import type { ModerationReport, ReportReason } from './types';

// ── Trade & Skills ─────────────────────────────────────────────────────────────
export function useTradeHub() {
  return useQuery({ queryKey: [KEY, 'trade-hub'], queryFn: Api.getTradeHub, staleTime: 30_000 });
}

export function useTradeTracks() {
  return useQuery({ queryKey: [KEY, 'trade-tracks'], queryFn: Api.getTradeTracks, staleTime: 60_000 });
}

export function useTradeModule(id?: string) {
  return useQuery({ queryKey: [KEY, 'trade-module', id], queryFn: () => Api.getTradeModule(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useTradeProject(id?: string) {
  return useQuery({ queryKey: [KEY, 'trade-project', id], queryFn: () => Api.getTradeProject(id as string), enabled: !!id, staleTime: 30_000 });
}

export function useSubmitProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectId: string; input: SubmitProjectInput }) => Api.submitProject(args.projectId, args.input),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: [KEY, 'trade-project', args.projectId] });
      qc.invalidateQueries({ queryKey: [KEY, 'trade-hub'] });
      qc.invalidateQueries({ queryKey: [KEY, 'rewards'] });
    },
  });
}

export function useAssessment(id?: string) {
  return useQuery({ queryKey: [KEY, 'assessment', id], queryFn: () => Api.getAssessment(id as string), enabled: !!id, staleTime: 30_000 });
}

export function useTakeAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { assessmentId: string; input: TakeAssessmentInput }) => Api.takeAssessment(args.assessmentId, args.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'credentials'] });
      qc.invalidateQueries({ queryKey: [KEY, 'opportunities'] });
      qc.invalidateQueries({ queryKey: [KEY, 'trade-hub'] });
      qc.invalidateQueries({ queryKey: [KEY, 'rewards'] });
    },
  });
}

export function useMentors(trade?: string) {
  return useQuery({ queryKey: [KEY, 'mentors', trade ?? 'all'], queryFn: () => Api.getMentors(trade), staleTime: 60_000 });
}

export function useRequestMentor() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (mentorId: string) => Api.requestMentor(mentorId), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'mentors'] }) });
}

// ── Credentials & earning bridge ───────────────────────────────────────────────
export function useCredentials() {
  return useQuery({ queryKey: [KEY, 'credentials'], queryFn: Api.getCredentials, staleTime: 30_000 });
}

export function useCredential(id?: string) {
  return useQuery({ queryKey: [KEY, 'credential', id], queryFn: () => Api.getCredential(id as string), enabled: !!id, staleTime: 60_000 });
}

export function useVerifyCredential(verificationId?: string) {
  return useQuery({ queryKey: [KEY, 'verify', verificationId], queryFn: () => Api.verifyCredential(verificationId as string), enabled: !!verificationId, staleTime: 30_000 });
}

export function useOpportunities() {
  return useQuery({ queryKey: [KEY, 'opportunities'], queryFn: Api.getOpportunities, staleTime: 30_000 });
}

export function useOpportunity(id?: string) {
  return useQuery({ queryKey: [KEY, 'opportunity', id], queryFn: () => Api.getOpportunity(id as string), enabled: !!id, staleTime: 30_000 });
}

export function useApplyOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opportunityId: string) => Api.applyOpportunity(opportunityId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'opportunities'] }),
  });
}

// ── Live, community & notifications ─────────────────────────────────────────────
export function useLiveSessions() {
  return useQuery({ queryKey: [KEY, 'live-sessions'], queryFn: Api.getLiveSessions, staleTime: 15_000 });
}

export function useLiveSession(id?: string) {
  return useQuery({ queryKey: [KEY, 'live-session', id], queryFn: () => Api.getLiveSession(id as string), enabled: !!id, staleTime: 15_000 });
}

export function useJoinLiveSession() {
  return useMutation({ mutationFn: (id: string) => Api.joinLiveSession(id) });
}

export function useGroups() {
  return useQuery({ queryKey: [KEY, 'groups'], queryFn: Api.getGroups, staleTime: 30_000 });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateGroupInput) => Api.createGroup(input), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'groups'] }) });
}

export function useJoinGroup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => Api.joinGroup(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'groups'] }) });
}

export function useDiscussions(scope?: string) {
  return useQuery({ queryKey: [KEY, 'discussions', scope ?? 'all'], queryFn: () => Api.getDiscussions(scope), staleTime: 15_000 });
}

export function useCreateDiscussion() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateDiscussionInput) => Api.createDiscussion(input), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'discussions'] }) });
}

export function useReportContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { targetKind: ModerationReport['targetKind']; targetId: string; reason: ReportReason }) =>
      Api.reportContent(args.targetKind, args.targetId, args.reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'discussions'] }),
  });
}

export function useNotifications() {
  return useQuery({ queryKey: [KEY, 'notifications'], queryFn: Api.getNotifications, staleTime: 15_000 });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => Api.markNotificationRead(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }) });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => Api.markAllNotificationsRead(), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'notifications'] }) });
}

export function useAnnouncements() {
  return useQuery({ queryKey: [KEY, 'announcements'], queryFn: Api.getAnnouncements, staleTime: 60_000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — hooks (Tutor & School, ECCE)
// ═══════════════════════════════════════════════════════════════════════════════
import type { TutorOnboardInput, CreateAssignmentInput, GradeInput } from './types';

// ── Tutor identity (T1, T2) ────────────────────────────────────────────────────
export function useTutorMe() {
  return useQuery({ queryKey: [KEY, 'tutor', 'me'], queryFn: Api.getTutorMe, staleTime: 30_000 });
}

export function useOnboardTutor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TutorOnboardInput) => Api.onboardTutor(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'tutor', 'me'] }); qc.invalidateQueries({ queryKey: [KEY, 'me'] }); },
  });
}

export function useTutors(subject?: string) {
  return useQuery({ queryKey: [KEY, 'tutors', subject ?? 'all'], queryFn: () => Api.getTutors(subject), staleTime: 60_000 });
}

// ── Cohorts & roster (T3) ──────────────────────────────────────────────────────
export function useCohorts() {
  return useQuery({ queryKey: [KEY, 'cohorts'], queryFn: Api.getCohorts, staleTime: 30_000 });
}

// ── Assignments (T4) ───────────────────────────────────────────────────────────
export function useAssignments(cohortId?: string) {
  return useQuery({ queryKey: [KEY, 'assignments', cohortId ?? 'all'], queryFn: () => Api.getAssignments(cohortId), staleTime: 15_000 });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAssignmentInput) => Api.createAssignment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'assignments'] }),
  });
}

// ── Review & grade (T5) ────────────────────────────────────────────────────────
export function useSubmissions(assignmentId?: string) {
  return useQuery({ queryKey: [KEY, 'submissions', assignmentId ?? 'all'], queryFn: () => Api.getSubmissions(assignmentId), staleTime: 15_000 });
}

export function useGradeSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GradeInput) => Api.gradeSubmission(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'submissions'] });
      qc.invalidateQueries({ queryKey: [KEY, 'assignments'] });
      qc.invalidateQueries({ queryKey: [KEY, 'tutor', 'earnings'] });
    },
  });
}

// ── Earnings & payouts (T7) ────────────────────────────────────────────────────
export function useTutorEarnings() {
  return useQuery({ queryKey: [KEY, 'tutor', 'earnings'], queryFn: Api.getTutorEarnings, staleTime: 15_000 });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { amountKobo: number; methodId?: string }) => Api.requestPayout(args.amountKobo, args.methodId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'tutor', 'earnings'] }),
  });
}

// ── School admin (lite) (T8) ───────────────────────────────────────────────────
export function useMySchools() {
  return useQuery({ queryKey: [KEY, 'schools', 'mine'], queryFn: Api.getMySchools, staleTime: 60_000 });
}

export function useSchoolOverview(schoolId?: string) {
  return useQuery({ queryKey: [KEY, 'school-overview', schoolId], queryFn: () => Api.getSchoolOverview(schoolId as string), enabled: !!schoolId, staleTime: 30_000 });
}

// ── ECCE / Little Learners (E1, E2) ────────────────────────────────────────────
export function useEcceHome() {
  return useQuery({ queryKey: [KEY, 'ecce', 'home'], queryFn: Api.getEcceHome, staleTime: 30_000 });
}

// Re-export for screens that type pot cadence selects.
export type { SavingsPot };
