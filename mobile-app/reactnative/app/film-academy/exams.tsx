// A NATIVE screen. Every exam offered to this learner's programme, with attempts
// remaining and whether they may start it right now.
// SERVER-AUTHORITATIVE. This list carries NO questions and NO answer key — the
// draw, the shuffle, the deadline and the score all happen on the server when an
// attempt starts (PRD BK-10). Two distinct "closed" cases: (1) the feature flag is
// OFF, so /api/academy/exams 503s and this renders the load-failure state — the
// plane is simply not live yet; (2) the flag is ON but the learner is not yet
// exam-eligible, so the server 200s with locked+reason and the shared lockCopy
// renders the actionable lock below. Only case (2) is a "lock to explain".
// GATING MIRRORS THE SERVER. `canStart` and `blockerMessage` come straight from
// examEligibility, so the button a learner sees disabled is disabled for the exact
// reason the server would refuse the start — the app never invents its own gate.

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Lock, FileText, Clock, Award, CircleCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import {
  getExams,
  startExamAttempt,
  FILM_ACADEMY_EXAMS_KEY,
} from '@/features/filmAcademy/api';
import { lockCopy } from '@/features/filmAcademy/lockCopy';
import { getErrorMessage } from '@/utils/errorMapper';
import { secureRandomId } from '@/lib/secureRandom';
import { HomeMenuButton } from '@/components/HomeMenu';
import type { FilmAcademyExamSummary } from '@/features/filmAcademy/types';

function ExamCard({ exam }: { exam: FilmAcademyExamSummary }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const attemptsLeft = exam.maxAttempts > 0 ? exam.maxAttempts - exam.attemptsUsed : null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // A fresh key per tap. startExamAttempt is idempotent on the SERVER side for
      // the same key, so a genuine double-submit of THIS tap can't spend two
      // attempts, while a deliberate re-start after a refusal draws cleanly.
      const attempt = await startExamAttempt(exam.id, secureRandomId());
      await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_EXAMS_KEY });
      router.push(`/film-academy/exams/${attempt.attemptId}` as never);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.kindPill}>
          <FileText size={11} color={Colors.primary} />
          <Text style={styles.kindText}>{exam.kind}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{exam.title}</Text>
      </View>

      {!!exam.description && <Text style={styles.body}>{exam.description}</Text>}

      <View style={styles.metaRow}>
        <Clock size={12} color={Colors.onSurfaceVariant} />
        <Text style={styles.meta}>{exam.timeLimitMinutes} min</Text>
        <Award size={12} color={Colors.teal} />
        <Text style={styles.meta}>Pass {exam.passMark}%</Text>
      </View>

      <View style={styles.metaRow}>
        <CircleCheck size={12} color={Colors.gold} />
        <Text style={styles.meta}>
          {exam.maxAttempts > 0
            ? `${exam.attemptsUsed}/${exam.maxAttempts} attempts used${attemptsLeft !== null ? ` · ${attemptsLeft} left` : ''}`
            : `${exam.attemptsUsed} attempts used`}
        </Text>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {exam.canStart ? (
        <Pressable onPress={start} disabled={busy} style={[styles.startBtn, busy && styles.startBtnDisabled]}>
          {busy
            ? <ActivityIndicator color={Colors.black} />
            : <Text style={styles.startBtnText}>Start exam</Text>}
        </Pressable>
      ) : (
        <View style={styles.blocker}>
          <Text style={styles.blockerText}>
            {exam.blockerMessage || 'Not available right now.'}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function FilmAcademyExamsScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_EXAMS_KEY,
    queryFn: getExams,
  });

  const exams = data?.exams ?? [];
  const lock = lockCopy(data?.reason);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Exams</Text>
        <HomeMenuButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading your exams…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load your exams.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && data?.locked && (
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

        {!isLoading && !error && !data?.locked && exams.length === 0 && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              No exams have been published for your programme yet. They will appear here once your academy opens them.
            </Text>
          </View>
        )}

        {!isLoading && !error && !data?.locked && exams.map((e) => <ExamCard key={e.id} exam={e} />)}
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

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardHead:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  kindPill:    { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgPurple,
                 paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.sm },
  kindText:    { ...Typography.labelSm, color: Colors.primary },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  meta:        { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginRight: Spacing.sm },
  body:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },

  startBtn:       { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md,
                    alignItems: 'center', marginTop: Spacing.sm },
  startBtnDisabled: { opacity: 0.6 },
  startBtnText:   { ...Typography.labelLg, color: Colors.black },

  blocker:     { marginTop: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md,
                 backgroundColor: Colors.surfaceVariant },
  blockerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },

  error:       { ...Typography.labelSm, color: Colors.error },
});
