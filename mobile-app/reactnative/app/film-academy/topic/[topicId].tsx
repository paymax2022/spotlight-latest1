// A NATIVE topic screen: the teaching article, approved media, learning
// outcomes and the mastery quiz for ONE topic.
//
// HONEST BY CONSTRUCTION. The article and every media URL are withheld by the
// server until the topic passes its publication gate (approved article, reviewed
// media, rights, accessibility). When they are withheld this screen says why
// instead of rendering an empty lesson. The quiz button mirrors the server's
// canStartQuiz decision and never invents an unlock.
//
// THE QUIZ IS A SEPARATE, SERVER-AUTHORITATIVE ATTEMPT. Starting it draws an
// immutable form on the server; this screen only navigates to the runner.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Lock, CircleCheck, AlertTriangle, Award, Play,
  ExternalLink, Layers, Target, BookOpen, ClipboardCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import {
  getTopic,
  getPractical,
  startTopicQuiz,
  filmAcademyTopicKey,
  filmAcademyPracticalKey,
  FILM_ACADEMY_PATH_KEY,
} from '@/features/filmAcademy/api';
import { useMasteryEvents } from '@/features/filmAcademy/useMasteryEvents';
import {
  topicStateColor,
  topicStateLabel,
  topicStateQuizPassed,
} from '@/features/filmAcademy/topicState';
import { Lecture } from '@/features/filmAcademy/Lecture';
import { InlineVideo } from '@/features/filmAcademy/InlineVideo';
import { getErrorMessage } from '@/utils/errorMapper';
import { secureRandomId } from '@/lib/secureRandom';
import { HomeMenuButton } from '@/components/HomeMenu';
import type { FilmTopicDetail, FilmTopicMediaAsset, FilmPracticalView } from '@/features/filmAcademy/types';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function MediaAsset({ asset }: { asset: FilmTopicMediaAsset }) {
  const title = asset.instructions || asset.mediaType;
  if (asset.mediaType === 'photo_or_diagram') {
    return (
      <View style={styles.mediaCard}>
        <Text style={styles.mediaTitle}>{title}</Text>
        <Image
          source={{ uri: asset.url }}
          style={styles.mediaImage}
          resizeMode="cover"
          accessibilityLabel={asset.altText || title}
        />
        {!!asset.altText && <Text style={styles.mediaMeta}>{asset.altText}</Text>}
      </View>
    );
  }
  if (asset.mediaType === 'teaching_video' || asset.mediaType === 'comparison_clip') {
    return (
      <View style={styles.mediaCard}>
        <InlineVideo url={asset.url} label={title} />
        {!!asset.captionsUrl && (
          <Pressable
            onPress={() => void Linking.openURL(asset.captionsUrl).catch(() => {})}
            style={styles.mediaLink}
            accessibilityRole="link"
          >
            <ExternalLink size={14} color={Colors.gold} />
            <Text style={styles.mediaLinkText}>Captions</Text>
          </Pressable>
        )}
        {!!asset.transcript && (
          <Text style={styles.mediaMeta} numberOfLines={8}>{asset.transcript}</Text>
        )}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => void Linking.openURL(asset.url).catch(() => {})}
      style={styles.mediaCard}
      accessibilityRole="link"
    >
      <View style={styles.mediaRow}>
        <View style={styles.mediaIcon}>
          <Play size={16} color={Colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mediaTitle}>{title}</Text>
          <Text style={styles.mediaMeta}>
            {asset.mediaType.toUpperCase()} — opens outside Spotlight
          </Text>
        </View>
        <ExternalLink size={16} color={Colors.onSurfaceVariant} />
      </View>
      {!!asset.transcript && (
        <Text style={styles.mediaMeta} numberOfLines={6}>{asset.transcript}</Text>
      )}
    </Pressable>
  );
}

function QuizSection({ topic }: { topic: FilmTopicDetail }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => startTopicQuiz(topic.topicId, secureRandomId()),
    onSuccess: async (attempt) => {
      await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_PATH_KEY });
      await queryClient.invalidateQueries({ queryKey: filmAcademyTopicKey(topic.topicId) });
      router.push(`/film-academy/topic-attempt/${attempt.attemptId}` as never);
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const passed = topicStateQuizPassed(topic.state);
  const color = topicStateColor(topic.state);

  return (
    <View style={styles.card}>
      <View style={styles.quizHead}>
        <View style={styles.quizIcon}>
          <Target size={18} color={Colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Mastery check</Text>
          <Text style={styles.cardMeta}>
            {topic.drawCount} questions · pass mark {topic.quizMinimumPercent}% · exact arithmetic
          </Text>
        </View>
        <View style={[styles.statePill, { backgroundColor: color + '20' }]}>
          <Text style={[styles.statePillText, { color }]}>{topicStateLabel(topic.state)}</Text>
        </View>
      </View>

      {passed && (
        <View style={[styles.resultBox, { backgroundColor: Colors.iconBgGreen }]}>
          <CircleCheck size={18} color={Colors.teal} />
          <View style={{ flex: 1 }}>
            <Text style={styles.resultTitle}>
              {topic.state === 'MASTERED' ? 'Topic mastered' : 'Quiz passed — hold open'}
            </Text>
            <Text style={styles.cardMeta}>
              Best score {Math.round(topic.bestScore ?? 0)}% · {topic.attemptsCount} attempt
              {topic.attemptsCount === 1 ? '' : 's'}
              {topic.masteredAt ? ` · mastered ${formatDate(topic.masteredAt)}` : ''}
            </Text>
            {topic.state === 'PASSED' && (
              <Text style={styles.holdText}>
                A practical or review hold must be cleared before the next topic unlocks.
              </Text>
            )}
          </View>
        </View>
      )}

      {!passed && topic.lastResult && (
        <View style={[styles.resultBox, { backgroundColor: Colors.errorContainer }]}>
          <AlertTriangle size={18} color={Colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.resultTitle, { color: Colors.error }]}>
              {topic.lastResult.percentage}% — below {topic.lastResult.threshold}%
            </Text>
            <Text style={styles.cardMeta}>
              {topic.lastResult.earnedPoints} of {topic.lastResult.possiblePoints} points on{' '}
              {formatDate(topic.lastResult.submittedAt)}. Revise the article and retake the quiz.
            </Text>
          </View>
        </View>
      )}

      {topic.canStartQuiz ? (
        <>
          <Pressable
            onPress={() => { setError(null); start.mutate(); }}
            disabled={start.isPending}
            accessibilityRole="button"
            style={[styles.quizBtn, start.isPending && styles.quizBtnDisabled]}
          >
            {start.isPending ? (
              <ActivityIndicator color={Colors.black} />
            ) : (
              <>
                <Text style={styles.quizBtnText}>
                  {topic.state === 'IN_PROGRESS'
                    ? 'Resume quiz'
                    : topic.state === 'REMEDIATION_REQUIRED'
                      ? 'Retake quiz'
                      : 'Start quiz'}
                </Text>
                <ChevronRight size={18} color={Colors.black} />
              </>
            )}
          </Pressable>
          <Text style={styles.cardMeta}>
            Your answers save as you go. The timer and the score run on the server —
            leaving this screen does not pause the attempt.
          </Text>
        </>
      ) : !passed ? (
        <View style={styles.blockerBox}>
          <Lock size={15} color={Colors.onSurfaceVariant} />
          <Text style={styles.blockerText}>
            {topic.blockerMessage || 'This topic quiz is not open yet.'}
          </Text>
        </View>
      ) : null}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function PracticalSection({ practical }: { practical: FilmPracticalView }) {
  const assessment = practical.assessment;
  if (!assessment) return null;
  const { eligibility } = practical;
  const status = eligibility.passed
    ? { label: 'Passed', color: Colors.teal, bg: Colors.iconBgGreen }
    : eligibility.inReview
      ? { label: 'In review', color: Colors.onWarning, bg: Colors.iconBgGold }
      : assessment.active
        ? { label: 'Required', color: Colors.onSurfaceVariant, bg: Colors.surfaceVariant }
        : { label: 'Not open', color: Colors.onSurfaceVariant, bg: Colors.surfaceVariant };

  return (
    <View style={styles.card}>
      <View style={styles.quizHead}>
        <View style={styles.quizIcon}>
          <ClipboardCheck size={18} color={Colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Practical assessment</Text>
          <Text style={styles.cardMeta}>{assessment.title}</Text>
        </View>
        <View style={[styles.statePill, { backgroundColor: status.bg }]}>
          <Text style={[styles.statePillText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <Text style={styles.cardMeta}>
        {eligibility.passed
          ? 'Your practical is passed. The topic completes once the quiz is also passed and no hold remains.'
          : eligibility.inReview
            ? 'Your work is with a reviewer. The grade and feedback will appear here.'
            : `A reviewer marks your work against a published rubric. Pass mark ${assessment.passPercent}% · ${eligibility.attemptsUsed} of ${assessment.maxAttempts} attempts used.`}
      </Text>

      <Pressable
        onPress={() => router.push(`/film-academy/practical/${practical.topicId}` as never)}
        accessibilityRole="button"
        style={eligibility.passed ? styles.practicalSecondary : styles.quizBtn}
      >
        <Text style={eligibility.passed ? styles.practicalSecondaryText : styles.quizBtnText}>
          {eligibility.passed
            ? 'View grade and feedback'
            : eligibility.inReview
              ? 'View submission'
              : eligibility.draftSubmissionId
                ? 'Continue practical'
                : 'Open practical'}
        </Text>
        <ChevronRight
          size={18}
          color={eligibility.passed ? Colors.onSurface : Colors.black}
        />
      </Pressable>
    </View>
  );
}

export default function FilmAcademyTopicScreen() {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: filmAcademyTopicKey(topicId ?? ''),
    queryFn: () => getTopic(topicId!),
    enabled: !!topicId,
  });

  // The practical is optional per topic: when none is configured, or the
  // assessment feature is off, the card is simply absent.
  const practicalQuery = useQuery({
    queryKey: filmAcademyPracticalKey(topicId ?? ''),
    queryFn: () => getPractical(topicId!),
    enabled: !!topicId && !!data,
    retry: false,
  });

  useMasteryEvents(!!data);

  const color = data ? topicStateColor(data.state) : Colors.onSurfaceVariant;
  const media = (data?.mediaAssets ?? []).filter((asset) => asset.published && !!asset.url);
  const scoredAttempts = data?.attempts ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/film-academy/path')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{data?.title ?? 'Topic'}</Text>
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
            <Text style={styles.stateText}>Opening the topic…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              This topic could not be opened. It may not be part of your programme,
              or the academy is still preparing it.
            </Text>
            <Pressable onPress={() => router.replace('/film-academy/path')} style={styles.retry}>
              <Text style={styles.retryText}>Back to my path</Text>
            </Pressable>
          </View>
        )}

        {!!data && (
          <>
            <Text style={styles.eyebrow}>{data.stageLabel} · {data.courseTitle}</Text>
            <Text style={styles.title}>{data.title}</Text>
            {data.pilot && (
              <View style={styles.pilotNote}>
                <Text style={styles.pilotNoteText}>
                  Pilot delivery — this lesson and its questions have not completed faculty or SME
                  review yet. Your work counts toward unlocking the next topic, but it cannot earn a
                  certificate.
                </Text>
              </View>
            )}
            <View style={styles.metaRow}>
              <View style={[styles.statePill, { backgroundColor: color + '20' }]}>
                <Text style={[styles.statePillText, { color }]}>{topicStateLabel(data.state)}</Text>
              </View>
              <Text style={styles.metaText}>
                {data.approvedQuestionCount} approved questions
              </Text>
            </View>

            {data.outcomes.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Layers size={17} color={Colors.gold} />
                  <Text style={styles.cardTitle}>What you will be able to do</Text>
                </View>
                {data.outcomes.map((outcome) => (
                  <View key={outcome.objective_id} style={styles.outcomeRow}>
                    <Text style={styles.outcomeId}>{outcome.objective_id}</Text>
                    <Text style={styles.outcomeText}>{outcome.description}</Text>
                  </View>
                ))}
              </View>
            )}

            {data.articleLocked || !data.article ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Lock size={17} color={Colors.onSurfaceVariant} />
                  <Text style={styles.cardTitle}>The lesson is not open yet</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {data.publicationBlockers[0]?.message
                    || data.blockerMessage
                    || 'This topic has not completed academic publication review.'}
                </Text>
                {data.publicationBlockers.length > 1 && (
                  <View style={styles.blockerList}>
                    {data.publicationBlockers.slice(1).map((blocker) => (
                      <Text key={blocker.code} style={styles.cardMeta}>· {blocker.message}</Text>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.articleCard}>
                <Lecture markdown={data.article} />
              </View>
            )}

            {media.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <BookOpen size={17} color={Colors.gold} />
                  <Text style={styles.cardTitle}>Teaching media</Text>
                </View>
                {media.map((asset) => <MediaAsset key={asset.assetId} asset={asset} />)}
              </View>
            )}

            {data.holds.length > 0 && (
              <View style={[styles.card, { backgroundColor: Colors.errorContainer }]}>
                <View style={styles.cardHead}>
                  <AlertTriangle size={17} color={Colors.error} />
                  <Text style={[styles.cardTitle, { color: Colors.error }]}>Academic hold</Text>
                </View>
                {data.holds.map((hold, index) => (
                  <Text key={`${hold.type}-${index}`} style={styles.holdReason}>
                    {hold.reason}
                  </Text>
                ))}
                <Text style={styles.cardMeta}>
                  A tutor or academy admin must clear this hold before the next topic opens.
                </Text>
              </View>
            )}

            <QuizSection topic={data} />

            {practicalQuery.data && <PracticalSection practical={practicalQuery.data} />}

            {scoredAttempts.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Award size={17} color={Colors.gold} />
                  <Text style={styles.cardTitle}>Your attempts</Text>
                </View>
                {scoredAttempts.map((attempt) => (
                  <View key={attempt.attemptId} style={styles.attemptRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attemptScore}>
                        {attempt.earnedPoints} of {attempt.possiblePoints} points
                      </Text>
                      <Text style={styles.cardMeta}>
                        {formatDate(attempt.submittedAt)} · pass mark {attempt.threshold}%
                      </Text>
                    </View>
                    <View style={[styles.statePill, {
                      backgroundColor: attempt.passed ? Colors.iconBgGreen : Colors.errorContainer,
                    }]}>
                      <Text style={[styles.statePillText, {
                        color: attempt.passed ? Colors.teal : Colors.error,
                      }]}>
                        {attempt.passed ? 'Passed' : 'Not passed'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {data.nextTopicId && data.state === 'MASTERED' && (
              <Pressable
                onPress={() => router.push(`/film-academy/topic/${data.nextTopicId}` as never)}
                style={styles.nextBtn}
              >
                <Text style={styles.nextBtnText}>Next topic</Text>
                <ChevronRight size={18} color={Colors.black} />
              </Pressable>
            )}

            <Pressable
              onPress={() => router.replace('/film-academy/path')}
              style={styles.backBtn}
            >
              <Text style={styles.backBtnText}>Back to my path</Text>
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
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  eyebrow:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase',
                 letterSpacing: 0.5 },
  title:       { ...Typography.headlineMd, color: Colors.onSurface },
  pilotNote:   { backgroundColor: Colors.gold + '20', borderRadius: Radius.md, padding: Spacing.md,
                 marginTop: Spacing.sm },
  pilotNoteText: { ...Typography.bodySm, color: Colors.onWarning },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  metaText:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
                 gap: Spacing.sm },
  articleCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  cardHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  cardMeta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  outcomeRow:  { gap: 2 },
  outcomeId:   { ...Typography.labelSm, color: Colors.gold, fontWeight: '700' },
  outcomeText: { ...Typography.bodyMd, color: Colors.onSurface },

  mediaCard:   { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md,
                 gap: Spacing.xs },
  mediaRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mediaIcon:   { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: Colors.iconBgGold,
                 alignItems: 'center', justifyContent: 'center' },
  mediaTitle:  { ...Typography.labelLg, color: Colors.onSurface },
  mediaMeta:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  mediaImage:  { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.sm,
                 backgroundColor: Colors.surfaceVariant },
  mediaLink:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mediaLinkText: { ...Typography.labelSm, color: Colors.onWarning },

  statePill:   { borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  statePillText: { ...Typography.labelSm, fontWeight: '700' },

  quizHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  quizIcon:    { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: Colors.iconBgGold,
                 alignItems: 'center', justifyContent: 'center' },
  resultBox:   { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
                 padding: Spacing.md, borderRadius: Radius.md },
  resultTitle: { ...Typography.labelLg, color: Colors.onSurface },
  holdText:    { ...Typography.labelSm, color: Colors.onWarning, marginTop: 2 },

  quizBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
                 backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md },
  quizBtnDisabled: { opacity: 0.6 },
  quizBtnText: { ...Typography.labelLg, color: Colors.black, fontWeight: '700' },
  practicalSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                 gap: Spacing.xs, backgroundColor: Colors.surfaceVariant, borderRadius: Radius.md,
                 paddingVertical: Spacing.md },
  practicalSecondaryText: { ...Typography.labelLg, color: Colors.onSurface },

  blockerBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
                 backgroundColor: Colors.surfaceVariant, borderRadius: Radius.md, padding: Spacing.md },
  blockerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  blockerList: { gap: 2 },

  holdReason:  { ...Typography.bodySm, color: Colors.error },

  attemptRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  attemptScore:{ ...Typography.labelLg, color: Colors.onSurface },

  nextBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
                 backgroundColor: Colors.gold, borderRadius: Radius.md, paddingVertical: Spacing.md },
  nextBtnText: { ...Typography.labelLg, color: Colors.black, fontWeight: '700' },
  backBtn:     { alignItems: 'center', paddingVertical: Spacing.md },
  backBtnText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  error:       { ...Typography.labelSm, color: Colors.error },
});
