import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, CircleSlash, Flag, CheckCircle2, CloudOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useAttempt, useSubmitAttempt } from '@/features/academy/hooks';
import { useConnectivity } from '@/features/academy/offlineQueue';

/**
 * X8 — CBT submit & confirm. Review unanswered + flagged before submitting.
 * Submit is the server-authoritative grading step; the result page reads back
 * the computed score. Submitting while offline is allowed (queues + reconciles).
 */
export default function SubmitConfirm() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const attempt = useAttempt(attemptId);
  const submit = useSubmitAttempt();
  const { offline } = useConnectivity();

  const stats = useMemo(() => {
    const a = attempt.data;
    if (!a) return { total: 0, answered: 0, unanswered: 0, flagged: 0, unansweredList: [] as number[] };
    const answered = a.questions.filter((q) => (a.answers[q.id] ?? []).length > 0).length;
    const unansweredList = a.questions.map((q, i) => ({ q, i })).filter(({ q }) => !(a.answers[q.id] ?? []).length).map(({ i }) => i + 1);
    return { total: a.questions.length, answered, unanswered: a.questions.length - answered, flagged: a.flagged.length, unansweredList };
  }, [attempt.data]);

  const doSubmit = () => {
    submit.mutate(attemptId, { onSuccess: () => router.replace(`/learn/academy/exam/result/${attemptId}`) });
  };

  if (attempt.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (!attempt.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Attempt not found" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Submit exam" subtitle="Review before you finish" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.summaryRow}>
          <SummaryStat icon={CheckCircle2} color={Colors.teal} value={stats.answered} label="Answered" />
          <SummaryStat icon={CircleSlash} color={Colors.error} value={stats.unanswered} label="Unanswered" />
          <SummaryStat icon={Flag} color={Colors.gold} value={stats.flagged} label="Flagged" />
        </View>

        {stats.unanswered > 0 ? (
          <View style={[styles.warnCard, shadow1]}>
            <AlertTriangle size={18} color={Colors.onWarning} />
            <Text style={styles.warnText}>
              You have {stats.unanswered} unanswered question{stats.unanswered > 1 ? 's' : ''}: {stats.unansweredList.join(', ')}. Unanswered questions score zero.
            </Text>
          </View>
        ) : (
          <View style={[styles.okCard, shadow1]}>
            <CheckCircle2 size={18} color={Colors.teal} />
            <Text style={styles.okText}>All questions answered. You’re ready to submit.</Text>
          </View>
        )}

        {offline ? (
          <View style={styles.offlineCard}>
            <CloudOff size={16} color={Colors.onWarning} />
            <Text style={styles.offlineText}>You’re offline. Your submission is saved and will be graded by the server when you reconnect.</Text>
          </View>
        ) : null}

        <Text style={styles.note}>Once submitted, the server confirms your time and score. Attempts are immutable.</Text>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Back to questions" variant="secondary" onPress={() => router.back()} />
        <PrimaryButton label={offline ? 'Submit (will sync)' : 'Submit exam'} onPress={doSubmit} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

function SummaryStat({ icon: Icon, color, value, label }: { icon: typeof Flag; color: string; value: number; label: string }) {
  return (
    <View style={[styles.statCard, shadow1]}>
      <Icon size={20} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  summaryRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  statValue: { ...Typography.headlineMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  warnCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, padding: Spacing.md, borderRadius: Radius.lg },
  warnText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  okCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, padding: Spacing.md, borderRadius: Radius.lg },
  okText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  offlineCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md, borderRadius: Radius.md },
  offlineText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.sm },
});
