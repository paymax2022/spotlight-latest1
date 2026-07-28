import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RefreshCw, Bell, TestTube } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { relativeTime } from '@/features/health/constants/health.constants';
import { useResults } from '@/features/health/lab/hooks';

const REMINDERS = [
  { id: 'wellness', title: 'Annual wellness check', detail: 'Due in 2 months' },
  { id: 'hba1c', title: 'HbA1c monitoring', detail: 'Recommended every 3 months' },
  { id: 'lipid', title: 'Lipid profile', detail: 'Recommended every 6 months' },
];

export default function ReorderScreen() {
  const resultsQ = useResults();
  const results = resultsQ.data ?? [];

  // De-dupe past tests by name for a clean "order again" list.
  const seen = new Set<string>();
  const pastTests = results.filter((r) => {
    if (seen.has(r.testName)) return false;
    seen.add(r.testName);
    return true;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reorder" subtitle="Repeat tests & screening reminders" />
      {resultsQ.isLoading ? (
        <StateView kind="loading" title="Loading your history…" />
      ) : resultsQ.isError ? (
        <StateView
          kind="error"
          title="Couldn't load history"
          message="We couldn't load your past tests. Please try again."
          actionLabel="Retry"
          onAction={() => resultsQ.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>Order again</Text>
          {pastTests.length === 0 ? (
            <View style={styles.emptyInline}>
              <Text style={styles.emptyInlineText}>
                No past tests yet. Book your first test to enable quick reordering.
              </Text>
              <Pressable onPress={() => router.push('/health/lab/catalog')}>
                <Text style={styles.linkText}>Browse tests</Text>
              </Pressable>
            </View>
          ) : (
            pastTests.map((r) => (
              <View key={r.id} style={styles.card}>
                <View style={styles.iconCircle}>
                  <TestTube size={18} color={Colors.teal} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.testName} numberOfLines={1}>
                    {r.testName}
                  </Text>
                  <Text style={styles.metaText} numberOfLines={1}>
                    Last taken {relativeTime(r.collectedAt)}
                  </Text>
                </View>
                <Pressable
                  style={styles.reorderBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Reorder ${r.testName}`}
                  onPress={() => router.push('/health/lab/catalog')}
                >
                  <RefreshCw size={16} color={Colors.onPrimary} strokeWidth={2.4} />
                  <Text style={styles.reorderText}>Reorder</Text>
                </Pressable>
              </View>
            ))
          )}

          <Text style={[styles.sectionTitle, { marginTop: Spacing.sectionGap }]}>
            Screening reminders
          </Text>
          {REMINDERS.map((rem) => (
            <View key={rem.id} style={styles.card}>
              <View style={styles.iconCircleGold}>
                <Bell size={18} color={Colors.onWarning} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.testName}>{rem.title}</Text>
                <Text style={styles.metaText}>{rem.detail}</Text>
              </View>
              <Pressable
                style={styles.ghostBtn}
                accessibilityRole="button"
                accessibilityLabel={`Set reminder for ${rem.title}`}
              >
                <Text style={styles.ghostText}>Set reminder</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xl },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...shadow1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleGold: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testName: { ...Typography.labelLg, color: Colors.onSurface },
  metaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  reorderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  reorderText: { ...Typography.labelMd, color: Colors.onPrimary },
  ghostBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outline,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  ghostText: { ...Typography.labelMd, color: Colors.primary },
  emptyInline: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
  },
  emptyInlineText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  linkText: { ...Typography.labelLg, color: Colors.primary },
});
