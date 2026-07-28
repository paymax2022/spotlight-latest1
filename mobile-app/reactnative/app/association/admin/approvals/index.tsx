import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useApprovalQueue } from '@/features/association/hooks/useAdmin';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import type { ApplicationJurisdiction, AdminApplicationSummary } from '@/features/association/types/admin.types';

const SEGMENTS = [
  { value: 'ALL', label: 'All' },
  { value: 'CHAPTER', label: 'Chapter' },
  { value: 'NATIONAL', label: 'National' },
] as const;

export default function ApprovalQueue() {
  const [seg, setSeg] = useState<string>('ALL');
  const queue = useApprovalQueue(seg as ApplicationJurisdiction | 'ALL');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Approval queue" />
      <View style={styles.segWrap}>
        <SegmentedControl options={SEGMENTS as never} value={seg} onChange={setSeg} />
      </View>
      {queue.isLoading ? (
        <StateView kind="loading" message="Loading applications…" />
      ) : queue.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => queue.refetch()} />
      ) : (queue.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="CheckCircle2" title="Queue clear" message="No applications waiting for review." />
      ) : (
        <FlatList
          data={queue.data ?? []}
          keyExtractor={(a) => a.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => <ApplicationCard app={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function ApplicationCard({ app: a }: { app: AdminApplicationSummary }) {
  const infoRequested = a.status === 'INFO_REQUESTED';
  return (
    <Pressable
      onPress={() => router.push(`/association/admin/approvals/${a.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Review application from ${a.applicantName}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name} numberOfLines={1}>{a.applicantName}</Text>
        <Text style={styles.meta} numberOfLines={1}>{a.category} · {a.chapter}</Text>
        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: a.paid ? Colors.iconBgTeal : Colors.errorContainer }]}>
            <Text style={[styles.chipText, { color: a.paid ? Colors.teal : Colors.error }]}>{a.paid ? 'Paid' : 'Unpaid'}</Text>
          </View>
          {infoRequested ? (
            <View style={[styles.chip, { backgroundColor: Colors.iconBgGold }]}>
              <Text style={[styles.chipText, { color: Colors.gold }]}>Info requested</Text>
            </View>
          ) : null}
          <Text style={styles.time}>{relativeTime(a.submittedAt)}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  pressed: { opacity: 0.9 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  chipText: { ...Typography.caption, fontWeight: '700' as const },
  time: { ...Typography.caption, color: Colors.outline },
});
