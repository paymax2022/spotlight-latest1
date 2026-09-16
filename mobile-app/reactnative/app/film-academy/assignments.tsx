// ── Film Academy — assignments ───────────────────────────────────────────────
// A NATIVE screen. Brief, submission, and the tutor's grade in one place, so a
// learner never has to remember what they sent.
//
// A graded assignment is read-only here AND on the server: resubmitting would
// erase the tutor's score and feedback, so the form is not offered at all.
//
// PAGINATED. The list used to render every assignment a learner had ever been
// set, in one response and one render. A cohort's brief list grows all term, so
// both grew with it; pages of 10 are fetched as the learner asks for them.
//
// PARTS. An assignment may be delivered in parts, each scheduled in a programme
// week (week 1-4). Each part is submitted on its own, so a learner who sends
// week 1 and later sends week 2 keeps both — before this the single
// (assignment, learner) submission row meant the second upload overwrote the
// first. An assignment with NO parts renders and submits exactly as before.

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, Clock, Lock, Award, ExternalLink, CalendarDays } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import {
  getAssignments,
  submitAssignment,
  submitAssignmentPart,
  FILM_ACADEMY_ASSIGNMENTS_KEY,
} from '@/features/filmAcademy/api';
import { lockCopy } from '@/features/filmAcademy/lockCopy';
import { getErrorMessage } from '@/utils/errorMapper';
import { HomeMenuButton } from '@/components/HomeMenu';
import type {
  FilmAcademyAssignment,
  FilmAcademyAssignmentPart,
  FilmAcademySubmission,
} from '@/features/filmAcademy/types';

const PAGE_SIZE = 10;

function formatDate(iso: string | null): string {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'No deadline';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Shared submission form — identical for a whole assignment and for one part. */
function SubmissionForm({
  submission, busy, error, onSend, sendLabel,
}: {
  submission: FilmAcademySubmission | null;
  busy: boolean;
  error: string | null;
  onSend: (link: string, text: string) => void;
  sendLabel: string;
}) {
  const [link, setLink] = useState(submission?.submission_link ?? '');
  const [text, setText] = useState(submission?.submission_text ?? '');
  const empty = !link.trim() && !text.trim();

  return (
    <View style={styles.form}>
      <Text style={styles.fieldLabel}>Link to your work</Text>
      <TextInput
        value={link}
        onChangeText={setLink}
        placeholder="https://…"
        placeholderTextColor={Colors.onSurfaceVariant}
        autoCapitalize="none"
        keyboardType="url"
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>Or write your submission</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Type your answer…"
        placeholderTextColor={Colors.onSurfaceVariant}
        multiline
        style={[styles.input, styles.inputMultiline]}
      />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={() => onSend(link.trim(), text.trim())}
        disabled={busy || empty}
        style={[styles.sendBtn, (busy || empty) && styles.sendBtnDisabled]}
      >
        {busy
          ? <ActivityIndicator color={Colors.black} />
          : <Text style={styles.sendBtnText}>{submission ? `Re${sendLabel.toLowerCase()}` : sendLabel}</Text>}
      </Pressable>
    </View>
  );
}

function SubmittedLink({ submission }: { submission: FilmAcademySubmission | null }) {
  if (!submission?.submission_link) return null;
  return (
    <Pressable
      onPress={() => void Linking.openURL(submission.submission_link!).catch(() => {})}
      style={styles.linkRow}
    >
      <ExternalLink size={14} color={Colors.gold} />
      <Text style={styles.linkText} numberOfLines={1}>{submission.submission_link}</Text>
    </Pressable>
  );
}

/** One week's deliverable inside a multi-part assignment. */
function PartRow({ part }: { part: FilmAcademyAssignmentPart }) {
  const queryClient = useQueryClient();
  const submission = part.submission;
  const graded = submission?.status === 'graded';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const send = async (link: string, text: string) => {
    setBusy(true);
    setError(null);
    try {
      await submitAssignmentPart({
        partId: part.id,
        submissionLink: link || undefined,
        submissionText: text || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_ASSIGNMENTS_KEY });
      setOpen(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.part}>
      <View style={styles.partHead}>
        <View style={styles.weekPill}>
          <CalendarDays size={11} color={Colors.primary} />
          <Text style={styles.weekText}>Week {part.week_number}</Text>
        </View>
        <Text style={styles.partTitle} numberOfLines={2}>
          Part {part.part_number}: {part.title}
        </Text>
        {graded ? (
          <View style={styles.gradedPill}>
            <Award size={11} color={Colors.teal} />
            <Text style={styles.gradedText}>
              {submission!.score}{part.max_score ? `/${part.max_score}` : ''}
            </Text>
          </View>
        ) : submission ? (
          <View style={styles.submittedPill}>
            <CircleCheck size={11} color={Colors.gold} />
            <Text style={styles.submittedText}>Sent</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Clock size={11} color={Colors.onSurfaceVariant} />
        <Text style={styles.meta}>
          Due {formatDate(part.due_date)}{part.is_required ? '' : ' · optional'}
        </Text>
      </View>

      {!!part.description && <Text style={styles.partBody}>{part.description}</Text>}

      {graded && !!submission?.feedback && (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackLabel}>Tutor feedback</Text>
          <Text style={styles.feedbackText}>{submission.feedback}</Text>
        </View>
      )}

      <SubmittedLink submission={submission} />

      {graded ? (
        <Text style={styles.meta}>Graded — this part is closed.</Text>
      ) : open ? (
        <SubmissionForm
          submission={submission}
          busy={busy}
          error={error}
          onSend={send}
          sendLabel="Submit"
        />
      ) : (
        <Pressable onPress={() => setOpen(true)} style={styles.editBtn}>
          <Text style={styles.editBtnText}>
            {submission ? 'Change this part' : `Submit part ${part.part_number}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function AssignmentCard({ assignment }: { assignment: FilmAcademyAssignment }) {
  const queryClient = useQueryClient();
  const submission = assignment.submission;
  const graded = submission?.status === 'graded';
  const parts = assignment.parts ?? [];
  const hasParts = parts.length > 0;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!submission);

  const send = async (link: string, text: string) => {
    setBusy(true);
    setError(null);
    try {
      await submitAssignment({
        assignmentId: assignment.id,
        submissionLink: link || undefined,
        submissionText: text || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_ASSIGNMENTS_KEY });
      setOpen(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const progressPct = assignment.partsTotal > 0
    ? Math.round((assignment.partsSubmitted / assignment.partsTotal) * 100)
    : 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{assignment.title}</Text>
        {/* A multi-part brief's headline state is its progress, not one grade. */}
        {hasParts ? (
          <View style={assignment.partsComplete ? styles.gradedPill : styles.submittedPill}>
            <Text style={assignment.partsComplete ? styles.gradedText : styles.submittedText}>
              {assignment.partsSubmitted}/{assignment.partsTotal} parts
            </Text>
          </View>
        ) : graded ? (
          <View style={styles.gradedPill}>
            <Award size={12} color={Colors.teal} />
            <Text style={styles.gradedText}>
              {submission!.score}
              {assignment.max_score ? `/${assignment.max_score}` : ''}
            </Text>
          </View>
        ) : submission ? (
          <View style={styles.submittedPill}>
            <CircleCheck size={12} color={Colors.gold} />
            <Text style={styles.submittedText}>Submitted</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Clock size={12} color={Colors.onSurfaceVariant} />
        <Text style={styles.meta}>
          {assignment.week_number ? `Week ${assignment.week_number} · ` : ''}
          Due {formatDate(assignment.due_date)}
        </Text>
      </View>

      {!!assignment.description && <Text style={styles.body}>{assignment.description}</Text>}
      {!!assignment.rubric && (
        <Text style={styles.rubric}>How it is marked: {assignment.rubric}</Text>
      )}

      {hasParts ? (
        <>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={styles.meta}>
            {assignment.partsComplete
              ? 'All parts submitted.'
              : `${assignment.partsTotal - assignment.partsSubmitted} part${assignment.partsTotal - assignment.partsSubmitted === 1 ? '' : 's'} still to send.`}
          </Text>
          <View style={styles.partList}>
            {parts.map((p) => <PartRow key={p.id} part={p} />)}
          </View>
        </>
      ) : (
        <>
          {graded && (
            <View style={styles.feedbackBox}>
              <Text style={styles.feedbackLabel}>Tutor feedback</Text>
              <Text style={styles.feedbackText}>
                {submission!.feedback || 'No written feedback was left.'}
              </Text>
            </View>
          )}

          <SubmittedLink submission={submission} />

          {graded ? (
            <Text style={styles.meta}>This assignment has been graded and is now closed.</Text>
          ) : open ? (
            <SubmissionForm
              submission={submission}
              busy={busy}
              error={error}
              onSend={send}
              sendLabel="Submit"
            />
          ) : (
            <Pressable onPress={() => setOpen(true)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Change my submission</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

export default function FilmAcademyAssignmentsScreen() {
  const {
    data, isLoading, error, refetch, isRefetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: FILM_ACADEMY_ASSIGNMENTS_KEY,
    queryFn: ({ pageParam }) => getAssignments(pageParam as number, PAGE_SIZE),
    initialPageParam: 1,
    // hasMore is computed server-side from the exact row count, so the button
    // disappears at the right moment rather than after one empty fetch.
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const first = data?.pages?.[0];
  const assignments = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.assignments),
    [data],
  );
  const total = first?.total ?? assignments.length;
  const lock = lockCopy(first?.reason);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Assignments</Text>
        <HomeMenuButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading your assignments…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load your assignments.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && first?.locked && (
          <View style={styles.state}>
            <Lock size={28} color={Colors.onSurfaceVariant} />
            <Text style={styles.lockTitle}>{lock.title}</Text>
            <Text style={styles.stateText}>{lock.detail}</Text>
            {!!lock.cta && (
              <Pressable onPress={() => router.push(lock.cta!.route as never)} style={styles.retry}>
                <Text style={styles.retryText}>{lock.cta.label}</Text>
              </Pressable>
            )}
          </View>
        )}

        {!isLoading && !error && !first?.locked && assignments.length === 0 && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              No assignments have been set yet. They will appear here when your tutors publish them.
            </Text>
          </View>
        )}

        {!isLoading && !error && !first?.locked && assignments.length > 0 && (
          <>
            <Text style={styles.countLine}>
              Showing {assignments.length} of {total}
            </Text>
            {assignments.map((a) => <AssignmentCard key={a.id} assignment={a} />)}

            {hasNextPage ? (
              <Pressable
                onPress={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                style={[styles.moreBtn, isFetchingNextPage && styles.sendBtnDisabled]}
              >
                {isFetchingNextPage
                  ? <ActivityIndicator color={Colors.onSurface} />
                  : <Text style={styles.moreBtnText}>Load more</Text>}
              </Pressable>
            ) : (
              <Text style={styles.endLine}>That is all of your assignments.</Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  lockTitle:   { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  countLine:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  endLine:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center',
                 paddingVertical: Spacing.sm },
  moreBtn:     { borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center',
                 backgroundColor: Colors.surfaceVariant },
  moreBtnText: { ...Typography.labelLg, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  rubric:      { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceVariant,
                   overflow: 'hidden', marginTop: Spacing.sm },
  progressFill:  { height: 6, borderRadius: 3, backgroundColor: Colors.gold },

  partList:    { gap: Spacing.sm, marginTop: Spacing.sm },
  part:        { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md,
                 gap: 4, borderWidth: 1, borderColor: Colors.surfaceVariant },
  partHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  partTitle:   { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1, flex: 1 },
  partBody:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  weekPill:    { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgPurple,
                 paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.sm },
  weekText:    { ...Typography.labelSm, color: Colors.primary },

  gradedPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGreen,
                 paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  gradedText:  { ...Typography.labelSm, color: Colors.teal },
  submittedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold,
                   paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  submittedText: { ...Typography.labelSm, color: Colors.gold },

  feedbackBox: { backgroundColor: Colors.iconBgGreen, borderRadius: Radius.md, padding: Spacing.md,
                 marginTop: Spacing.xs, gap: 2 },
  feedbackLabel: { ...Typography.labelSm, color: Colors.teal },
  feedbackText:  { ...Typography.bodyMd, color: Colors.onSurface },

  linkRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  linkText:    { ...Typography.bodySm, color: Colors.gold, flex: 1 },

  form:        { gap: Spacing.xs, marginTop: Spacing.sm },
  fieldLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  input:       { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md,
                 color: Colors.onSurface, borderWidth: 1, borderColor: Colors.surfaceVariant,
                 ...Typography.bodyMd },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  error:       { ...Typography.bodySm, color: Colors.error },

  sendBtn:     { backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md,
                 alignItems: 'center', marginTop: Spacing.xs },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { ...Typography.labelLg, color: Colors.black },
  editBtn:     { paddingVertical: Spacing.sm, alignItems: 'center' },
  editBtnText: { ...Typography.labelLg, color: Colors.gold },
});
