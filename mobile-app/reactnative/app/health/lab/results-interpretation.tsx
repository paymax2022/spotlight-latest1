import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Stethoscope, TriangleAlert } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';

import { useResult } from '@/features/health/lab/hooks';
import { FLAG_META, CRITICAL_RESULT_COPY } from '@/features/health/lab/constants';
import type { LabResult } from '@/features/health/lab/types';

export default function ResultsInterpretationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: result, isLoading, isError, refetch } = useResult(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Understand your results" subtitle="Talk it through with a clinician" />

      {isLoading ? (
        <StateView kind="loading" title="Loading your results" />
      ) : isError || !result ? (
        <StateView
          kind="error"
          title="Couldn't load results"
          message="We couldn't load these results. Please try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <Body result={result} />
      )}
    </SafeAreaView>
  );
}

function Body({ result }: { result: LabResult }) {
  const abnormal = result.analytes.filter((a) => a.flag !== 'normal');

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {result.hasCritical ? (
        <View style={styles.urgency}>
          <TriangleAlert size={20} color={Colors.error} />
          <Text style={styles.urgencyText}>{CRITICAL_RESULT_COPY}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Stethoscope size={28} color={Colors.teal} />
        </View>
        <Text style={styles.title}>Get your results explained</Text>
        <Text style={styles.body}>
          A licensed doctor can walk you through what these results mean for you in a private
          tele-consult — what's normal, what needs attention, and your next steps.
        </Text>
      </View>

      {abnormal.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Worth discussing</Text>
          {abnormal.map((a) => {
            const meta = FLAG_META[a.flag];
            return (
              <View key={a.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.analyteName}>{a.name}</Text>
                  <Text style={styles.analyteValue}>
                    {a.value}
                    {a.unit ? ` ${a.unit}` : ''}
                  </Text>
                </View>
                {meta ? (
                  <View style={[styles.flagPill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.flagText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.footer}>
        <PrimaryButton label="Book a consult" onPress={() => router.push('/health/consult')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    padding: Spacing.containerMargin,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  urgency: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  urgencyText: {
    ...Typography.bodySm,
    color: Colors.error,
    flex: 1,
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...shadow1,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sectionTitle: {
    ...Typography.titleMd,
    color: Colors.onSurface,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  rowMain: { flex: 1 },
  analyteName: { ...Typography.bodyMd, color: Colors.onSurface },
  analyteValue: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    marginTop: 2,
  },
  flagPill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  flagText: { ...Typography.labelSm },
  footer: { marginTop: Spacing.sm },
});
