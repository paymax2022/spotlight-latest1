import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, ChevronRight, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { relativeTime } from '@/features/health/constants/health.constants';
import { RESULT_STATUS_META } from '@/features/health/lab/constants';
import { useResults } from '@/features/health/lab/hooks';
import type { LabResult } from '@/features/health/lab/types';

function indicatorColor(r: LabResult): string {
  if (r.hasCritical) return Colors.error;
  if (r.hasAbnormal) return Colors.gold;
  return Colors.teal;
}

export default function ReportsScreen() {
  const resultsQ = useResults();
  const results = resultsQ.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Records" subtitle="Your secure results vault" />
      {resultsQ.isLoading ? (
        <StateView kind="loading" title="Loading your results…" />
      ) : resultsQ.isError ? (
        <StateView
          kind="error"
          title="Couldn't load results"
          message="We couldn't open your records vault. Please try again."
          actionLabel="Retry"
          onAction={() => resultsQ.refetch()}
        />
      ) : results.length === 0 ? (
        <StateView
          kind="empty"
          icon="FileText"
          title="No results yet"
          message="Once a lab releases your results they'll be stored here, encrypted and ready to view."
          actionLabel="Browse tests"
          onAction={() => router.push('/health/lab/catalog')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.trustRow}>
            <ShieldCheck size={16} color={Colors.teal} strokeWidth={2.2} />
            <Text style={styles.trustText}>
              Results are encrypted and consent-gated. Access is logged under NDPA (HL-8).
            </Text>
          </View>

          {results.map((r) => {
            const meta = RESULT_STATUS_META[r.status];
            return (
              <Pressable
                key={r.id}
                style={styles.card}
                accessibilityRole="button"
                accessibilityLabel={`View ${r.testName} result`}
                onPress={() =>
                  router.push({ pathname: '/health/lab/results/[id]', params: { id: r.id } })
                }
              >
                <View style={[styles.dot, { backgroundColor: indicatorColor(r) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.testName} numberOfLines={1}>
                    {r.testName}
                  </Text>
                  <Text style={styles.labName} numberOfLines={1}>
                    {r.labName} · {relativeTime(r.collectedAt)}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  trustText: { ...Typography.bodySm, color: Colors.teal, flex: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...shadow1,
  },
  dot: { width: 10, height: 10, borderRadius: Radius.full },
  testName: { ...Typography.titleMd, color: Colors.onSurface },
  labName: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    marginTop: Spacing.sm,
  },
  pillText: { ...Typography.labelSm },
});
