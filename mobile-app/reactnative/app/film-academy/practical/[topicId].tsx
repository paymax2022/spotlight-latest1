// A NATIVE practical assessment screen: the brief, the rubric, the learner's own
// evidence and the reviewer's grade.
//
// Nothing here decides eligibility or the pass mark. The server says whether the
// learner can submit, freezes the rubric at submission, and computes the score.
// The screen therefore mirrors `eligibility` verbatim and shows the reviewer's
// feedback instead of inventing a result.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
  Alert, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ClipboardCheck, CircleCheck, Clock, Lock, ExternalLink, AlertTriangle,
  Award, FileText, Send,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import {
  FILM_ACADEMY_PATH_KEY,
  filmAcademyPracticalKey,
  filmAcademyTopicKey,
  getPractical,
  savePracticalDraft,
  submitPractical,
} from '@/features/filmAcademy/api';
import { Lecture } from '@/features/filmAcademy/Lecture';
import { useMasteryEvents } from '@/features/filmAcademy/useMasteryEvents';
import { getErrorMessage } from '@/utils/errorMapper';
import { HomeMenuButton } from '@/components/HomeMenu';
import type {
  FilmPracticalAssessment,
  FilmPracticalSubmission,
} from '@/features/filmAcademy/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void Linking.openURL(url).catch(() => {});
}

function SubmittedEvidence({ submission }: { submission: FilmPracticalSubmission }) {
  return (
    <>
      {!!submission.submissionText && (
        <Text style={styles.submittedText} numberOfLines={8}>{submission.submissionText}</Text>
      )}
      {!!submission.mediaUrl && (
        <Pressable
          onPress={() => openLink(submission.mediaUrl)}
          style={styles.linkRow}
          accessibilityRole="link"
        >
          <ExternalLink size={14} color={Colors.onWarning} />
          <Text style={styles.linkText}>View submitted media</Text>
        </Pressable>
      )}
      {!!submission.mediaNote && (
        <Text style={styles.cardMeta}>{submission.mediaNote}</Text>
      )}
    </>
  );
}

function GradedAttempt({
  submission,
  assessment,
}: {
  submission: FilmPracticalSubmission;
  assessment: FilmPracticalAssessment;
}) {
  const rubric = submission.rubricSnapshot.length > 0 ? submission.rubricSnapshot : assessment.rubric;
  const labels = new Map(rubric.map((criterion) => [criterion.id, criterion.label]));
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyHead}>
        <Text style={styles.historyTitle}>Attempt {submission.attemptNumber}</Text>
        <View style={[styles.pill, {
          backgroundColor: submission.passed ? Colors.iconBgGreen : Colors.errorContainer,
        }]}>
          <Text style={[styles.pillText, { color: submission.passed ? Colors.teal : Colors.error }]}>
            {submission.passed ? 'Passed' : 'Not passed'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>
        {submission.earnedPoints ?? 0} of {submission.possiblePoints ?? 0} points ·{' '}
        {Math.round(submission.percentage ?? 0)}% · graded {formatDate(submission.gradedAt)}
      </Text>
      {submission.rubricScores.map((score) => (
        <View key={score.criterionId} style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>{labels.get(score.criterionId) ?? score.criterionId}</Text>
          <Text style={styles.scorePoints}>{score.points} pts</Text>
          {!!score.comment && <Text style={styles.scoreComment}>{score.comment}</Text>}
        </View>
      ))}
      {!!submission.feedback && (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackTitle}>Reviewer feedback</Text>
          <Text style={styles.cardMeta}>{submission.feedback}</Text>
        </View>
      )}
      <SubmittedEvidence submission={submission} />
    </View>
  );
}

export default function FilmAcademyPracticalScreen() {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: filmAcademyPracticalKey(topicId ?? ''),
    queryFn: () => getPractical(topicId!),
    enabled: !!topicId,
  });

  useMasteryEvents(!!data);

  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaNote, setMediaNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const hydratedDraft = useRef<string | null>(null);

  const draft = data?.submissions.find((submission) => submission.status === 'draft') ?? null;
  const inReview = data?.submissions.find((submission) => submission.status === 'submitted') ?? null;
  const graded = (data?.submissions ?? []).filter((submission) => submission.status === 'graded');
  const passing = graded.find((submission) => submission.passed === true) ?? null;
  const assessment = data?.assessment ?? null;

  useEffect(() => {
    if (!draft || hydratedDraft.current === draft.id) return;
    hydratedDraft.current = draft.id;
    setText(draft.submissionText);
    setMediaUrl(draft.mediaUrl);
    setMediaNote(draft.mediaNote);
  }, [draft]);

  const invalidate = async (id: string) => {
    await queryClient.invalidateQueries({ queryKey: filmAcademyPracticalKey(id) });
    await queryClient.invalidateQueries({ queryKey: filmAcademyTopicKey(id) });
    await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_PATH_KEY });
  };

  const save = useMutation({
    mutationFn: () =>
      savePracticalDraft(topicId!, {
        submissionText: text,
        mediaUrl: mediaUrl.trim(),
        mediaNote: mediaNote.trim(),
      }),
    onSuccess: async (submission) => {
      hydratedDraft.current = submission.id;
      setFormError(null);
      setNotice('Draft saved on the server. You can come back and finish it later.');
      await invalidate(topicId!);
    },
    onError: (e) => {
      setNotice(null);
      setFormError(getErrorMessage(e));
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      // Persist the current edits first: the reviewer must see exactly what the
      // learner sees, not an older saved draft.
      const submission = await savePracticalDraft(topicId!, {
        submissionText: text,
        mediaUrl: mediaUrl.trim(),
        mediaNote: mediaNote.trim(),
      });
      hydratedDraft.current = submission.id;
      return submitPractical(topicId!, submission.id);
    },
    onSuccess: async () => {
      setFormError(null);
      setNotice('Submitted for review. Your grade and feedback will appear here.');
      await invalidate(topicId!);
    },
    onError: (e) => {
      setNotice(null);
      setFormError(getErrorMessage(e));
    },
  });

  const confirmSubmit = () => {
    setFormError(null);
    setNotice(null);
    if (!text.trim() && !mediaUrl.trim()) {
      setFormError('Add your written work or an https link to the media you produced before submitting.');
      return;
    }
    if (mediaUrl.trim() && !/^https?:\/\//i.test(mediaUrl.trim())) {
      setFormError('The media link must start with http:// or https://.');
      return;
    }
    Alert.alert(
      'Submit for review?',
      'The rubric and pass mark are fixed when you submit, and this attempt can no longer be edited.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Submit', onPress: () => submit.mutate() },
      ],
    );
  };

  const busy = save.isPending || submit.isPending;
  const canSubmit = data?.eligibility.canSubmit === true && !inReview && !passing;
  const reason = data?.eligibility.reason ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace(`/film-academy/topic/${topicId ?? ''}` as never)}
          hitSlop={12}
          style={styles.back}
        >
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Practical assessment</Text>
        <HomeMenuButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
        }
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Opening the practical assessment…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              This practical could not be opened. It may not be part of your programme,
              or the academy is still preparing it.
            </Text>
            <Pressable
              onPress={() => router.replace(`/film-academy/topic/${topicId ?? ''}` as never)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Back to the topic</Text>
            </Pressable>
          </View>
        )}

        {!!data && (
          <>
            <Text style={styles.eyebrow}>{data.topicTitle}</Text>
            <Text style={styles.title}>{assessment?.title ?? 'Practical assessment'}</Text>

            {!assessment && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Lock size={17} color={Colors.onSurfaceVariant} />
                  <Text style={styles.cardTitle}>Not open yet</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {reason
                    || 'The academy has not published a practical assessment for this topic yet.'}
                </Text>
              </View>
            )}

            {!!assessment && (
              <>
                <View style={styles.card}>
                  <View style={styles.metaRow}>
                    <View style={[styles.pill, {
                      backgroundColor: passing
                        ? Colors.iconBgGreen
                        : inReview
                          ? Colors.iconBgGold
                          : Colors.surfaceVariant,
                    }]}>
                      <Text style={[styles.pillText, {
                        color: passing ? Colors.teal : inReview ? Colors.onWarning : Colors.onSurfaceVariant,
                      }]}>
                        {passing
                          ? 'Passed'
                          : inReview
                            ? 'In review'
                            : assessment.active
                              ? 'Practical required'
                              : 'Not open'}
                      </Text>
                    </View>
                    <Text style={styles.cardMeta}>
                      Pass mark {assessment.passPercent}% · {data.eligibility.attemptsUsed} of{' '}
                      {assessment.maxAttempts} attempts used
                    </Text>
                  </View>

                  <View style={styles.cardHead}>
                    <FileText size={17} color={Colors.gold} />
                    <Text style={styles.cardTitle}>Your brief</Text>
                  </View>
                  <Lecture markdown={assessment.briefMarkdown} />
                  {!!assessment.submissionInstructions && (
                    <Text style={styles.cardMeta}>{assessment.submissionInstructions}</Text>
                  )}
                </View>

                <View style={styles.card}>
                  <View style={styles.cardHead}>
                    <ClipboardCheck size={17} color={Colors.gold} />
                    <Text style={styles.cardTitle}>How your work is marked</Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    A reviewer scores every line. Passing needs {assessment.passPercent}% or more;
                    the server adds the points and decides the result.
                  </Text>
                  {assessment.rubric.map((criterion) => (
                    <View key={criterion.id} style={styles.rubricRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rubricLabel}>{criterion.label}</Text>
                        {!!criterion.description && (
                          <Text style={styles.cardMeta}>{criterion.description}</Text>
                        )}
                      </View>
                      <Text style={styles.rubricPoints}>{criterion.maxPoints} pts</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {!!passing && (
              <View style={[styles.card, { backgroundColor: Colors.iconBgGreen }]}>
                <View style={styles.cardHead}>
                  <CircleCheck size={18} color={Colors.teal} />
                  <Text style={styles.cardTitle}>Practical passed</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {passing.earnedPoints} of {passing.possiblePoints} points ·{' '}
                  {Math.round(passing.percentage ?? 0)}% · graded {formatDate(passing.gradedAt)}.
                  {data.eligibility.passed
                    ? ' This requirement is complete.'
                    : ''}
                </Text>
                {!!passing.feedback && (
                  <Text style={styles.cardMeta}>{passing.feedback}</Text>
                )}
              </View>
            )}

            {!passing && !!inReview && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Clock size={17} color={Colors.gold} />
                  <Text style={styles.cardTitle}>With a reviewer</Text>
                </View>
                <Text style={styles.cardMeta}>
                  Attempt {inReview.attemptNumber} was submitted on {formatDate(inReview.submittedAt)}.
                  You will see the grade and feedback on this screen; the topic stays locked until
                  the practical is passed.
                </Text>
                <SubmittedEvidence submission={inReview} />
              </View>
            )}

            {!passing && !inReview && !!reason && (
              <View style={styles.blockerBox}>
                <AlertTriangle size={15} color={Colors.onSurfaceVariant} />
                <Text style={styles.blockerText}>{reason}</Text>
              </View>
            )}

            {!passing && !inReview && canSubmit && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Award size={17} color={Colors.gold} />
                  <Text style={styles.cardTitle}>
                    {draft ? 'Finish your submission' : 'Submit your work'}
                  </Text>
                </View>
                <Text style={styles.cardMeta}>
                  Write your work below, or paste an https link to the media you produced
                  (video, audio, photos). Add at least one of the two.
                </Text>

                <Text style={styles.inputLabel}>Written work</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  style={[styles.input, styles.textArea]}
                  multiline
                  textAlignVertical="top"
                  maxLength={20_000}
                  placeholder="Write your submission here…"
                  placeholderTextColor={Colors.onSurfaceVariant}
                  accessibilityLabel="Written practical submission"
                />

                <Text style={styles.inputLabel}>Media link</Text>
                <TextInput
                  value={mediaUrl}
                  onChangeText={setMediaUrl}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  maxLength={2_000}
                  placeholder="https://…"
                  placeholderTextColor={Colors.onSurfaceVariant}
                  accessibilityLabel="Link to your practical media"
                />

                <Text style={styles.inputLabel}>Media note (optional)</Text>
                <TextInput
                  value={mediaNote}
                  onChangeText={setMediaNote}
                  style={styles.input}
                  maxLength={2_000}
                  placeholder="What should the reviewer know about the link?"
                  placeholderTextColor={Colors.onSurfaceVariant}
                  accessibilityLabel="Note about the media link"
                />

                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => save.mutate()}
                    disabled={busy}
                    accessibilityRole="button"
                    style={[styles.secondaryBtn, busy && styles.disabled]}
                  >
                    {save.isPending ? (
                      <ActivityIndicator color={Colors.onSurface} />
                    ) : (
                      <Text style={styles.secondaryBtnText}>Save draft</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={confirmSubmit}
                    disabled={busy}
                    accessibilityRole="button"
                    style={[styles.primaryBtn, busy && styles.disabled]}
                  >
                    {submit.isPending ? (
                      <ActivityIndicator color={Colors.black} />
                    ) : (
                      <>
                        <Send size={16} color={Colors.black} />
                        <Text style={styles.primaryBtnText}>Submit for review</Text>
                      </>
                    )}
                  </Pressable>
                </View>

                {!!notice && (
                  <View style={styles.noticeBox}>
                    <CircleCheck size={15} color={Colors.teal} />
                    <Text style={styles.noticeText}>{notice}</Text>
                  </View>
                )}
                {!!formError && <Text style={styles.error}>{formError}</Text>}
              </View>
            )}

            {graded.length > 0 && !!assessment && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <ClipboardCheck size={17} color={Colors.gold} />
                  <Text style={styles.cardTitle}>Your attempts</Text>
                </View>
                {graded.map((submission) => (
                  <GradedAttempt
                    key={submission.id}
                    submission={submission}
                    assessment={assessment}
                  />
                ))}
              </View>
            )}

            <Pressable
              onPress={() => router.replace(`/film-academy/topic/${topicId ?? ''}` as never)}
              style={styles.backBtn}
            >
              <Text style={styles.backBtnText}>Back to the topic</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.labelLg, color: Colors.onSurface, flex: 1, textAlign: 'center' },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },

  eyebrow:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase',
                 letterSpacing: 0.5 },
  title:       { ...Typography.headlineMd, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
                 gap: Spacing.sm },
  cardHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  cardMeta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },

  pill:        { borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  pillText:    { ...Typography.labelSm, fontWeight: '700' },

  rubricRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
                 paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  rubricLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rubricPoints:{ ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' },

  historyCard: { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md,
                 gap: Spacing.xs },
  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyTitle:{ ...Typography.labelLg, color: Colors.onSurface },
  scoreRow:    { paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  scoreLabel:  { ...Typography.labelSm, color: Colors.onSurface },
  scorePoints: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  scoreComment:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  submittedText: { ...Typography.bodySm, color: Colors.onSurface },
  linkRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText:    { ...Typography.labelSm, color: Colors.onWarning },

  feedbackBox: { backgroundColor: Colors.surface, borderRadius: Radius.sm, padding: Spacing.sm,
                 gap: 2 },
  feedbackTitle: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' },

  inputLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  input:       { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md,
                 ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1,
                 borderColor: Colors.outlineVariant },
  textArea:    { minHeight: 160 },

  actionRow:   { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginTop: Spacing.xs },
  primaryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
                 backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md,
                 paddingHorizontal: Spacing.lg, flexGrow: 1 },
  primaryBtnText: { ...Typography.labelLg, color: Colors.black, fontWeight: '700' },
  secondaryBtn:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
                 backgroundColor: Colors.surfaceVariant, borderRadius: Radius.md,
                 paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  secondaryBtnText: { ...Typography.labelLg, color: Colors.onSurface },
  disabled:    { opacity: 0.6 },

  noticeBox:   { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
                 backgroundColor: Colors.iconBgGreen, borderRadius: Radius.md, padding: Spacing.md },
  noticeText:  { ...Typography.labelSm, color: Colors.onSurface, flex: 1 },

  blockerBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
                 backgroundColor: Colors.surfaceVariant, borderRadius: Radius.md, padding: Spacing.md },
  blockerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },

  backBtn:     { alignItems: 'center', paddingVertical: Spacing.md },
  backBtnText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  error:       { ...Typography.labelSm, color: Colors.error },
});
