import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useAudience } from '@/features/referral/ambassador/hooks';
import type { AudienceStatus } from '@/features/referral/ambassador/types';

// M-AMB-03 — Referred-audience list: status of everyone referred.
const STATUS_META: Record<AudienceStatus, { label: string; color: string; bg: string }> = {
  invited:   { label: 'Invited',   color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
  signed_up: { label: 'Signed up', color: Colors.secondary,         bg: Colors.iconBgBlue },
  kyc:       { label: 'KYC done',  color: Colors.secondary,         bg: Colors.iconBgBlue },
  activated: { label: 'Activated', color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  retained:  { label: 'Retained',  color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  churned:   { label: 'Churned',   color: Colors.error,             bg: Colors.errorContainer },
};

export default function AudienceScreen() {
  const { data, isLoading, isError, refetch } = useAudience();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Referred audience" />
      {isLoading ? (
        <StateView kind="loading" message="Loading audience…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Users" title="No referrals yet" message="People you refer appear here with their status." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.summary}>{data.length} people · {data.filter((m) => m.status === 'activated' || m.status === 'retained').length} activated</Text>
          <View style={styles.list}>
            {data.map((m, i) => {
              const meta = STATUS_META[m.status];
              return (
                <View key={m.id} style={[styles.row, i < data.length - 1 && styles.rowBorder]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{m.name.charAt(0)}</Text></View>
                  <View style={styles.rowBody}>
                    <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
                    <Text style={styles.meta}>{m.channel} · {relativeTime(m.joinedAt)}</Text>
                  </View>
                  <View style={styles.rowRight}>
                    <View style={[styles.statusPill, { backgroundColor: meta.bg }]}><Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text></View>
                    {m.earnedKobo > 0 ? <Text style={styles.earned}>{formatNaira(m.earnedKobo)}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  summary: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' as const },
  rowBody: { flex: 1 },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  statusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
  earned: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
