import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useMemberDetail } from '@/features/referral/agent/hooks';

// M-AGT-03 — Team member detail: member's activity-driven earnings (NOT recruitment).
export default function MemberDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const { data, isLoading, isError, refetch } = useMemberDetail(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Member detail" />
      {isLoading ? (
        <StateView kind="loading" message="Loading member…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="This member could not be found." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{data.name.charAt(0)}</Text></View>
            <View style={styles.headerText}>
              <Text style={styles.name}>{data.name}</Text>
              <Text style={styles.joined}>Joined {relativeTime(data.joinedAt)} · {data.verifiedReferrals} verified referrals</Text>
            </View>
          </View>

          {/* Activity → override */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Verified activity</Text>
              <Text style={styles.statValue}>{formatNaira(data.activityKobo)}</Text>
              <Text style={styles.statSub}>Real transactions in their network</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Your override</Text>
              <Text style={styles.statValue}>{formatNaira(data.overrideKobo)}</Text>
              <Text style={styles.statSub}>From their activity, capped</Text>
            </View>
          </View>

          <DisclosureCard tone="compliant" title="Activity-based, not recruitment" body={data.activityBasis} />

          {/* Activity breakdown */}
          <Text style={styles.sectionTitle}>Activity that generated your override</Text>
          {data.rows.length === 0 ? (
            <StateView kind="empty" icon="Activity" title="No activity yet" message="When this member transacts, their verified activity appears here." compact />
          ) : (
            <View style={styles.list}>
              {data.rows.map((r, i) => (
                <View key={r.id} style={[styles.row, i < data.rows.length - 1 && styles.rowBorder]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>{r.label}</Text>
                    <Text style={styles.rowMeta}>Activity {formatNaira(r.activityKobo)} · {relativeTime(r.at)}</Text>
                  </View>
                  <Text style={styles.rowOverride}>+{formatNaira(r.overrideKobo)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' as const },
  headerText: { flex: 1 },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  joined: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 2 },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const },
  statSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowBody: { flex: 1 },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowOverride: { ...Typography.labelLg, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
