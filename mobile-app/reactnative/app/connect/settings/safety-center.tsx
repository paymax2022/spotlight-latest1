import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lightbulb, UserX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import {
  useBlockedUsers,
  useUnblockUser,
  useSafetyCases,
} from '@/features/connect/hooks/useConnect';
import type { SafetyCaseStatus } from '@/features/connect/types/connect.types';

// ST-06 — Safety center. Tips, blocked users, report history.
const TIPS = [
  'Keep conversations on Connect until you trust someone.',
  'Never send money, gift cards or crypto to someone you haven’t met.',
  'Meet in public for first dates and tell a friend your plans.',
  'Report anyone who pressures you — every report opens a case.',
];

function statusLabel(s: SafetyCaseStatus): string {
  return s === 'under_review' ? 'Under review' : s === 'submitted' ? 'Submitted' : s === 'actioned' ? 'Actioned' : s === 'resolved' ? 'Resolved' : 'Rejected';
}

export default function SafetyCenter() {
  const { data: blocked, isLoading: lb } = useBlockedUsers();
  const { data: cases, isLoading: lc, error, refetch } = useSafetyCases();
  const unblock = useUnblockUser();

  const loading = lb || lc;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Safety center" />
      {loading ? (
        <StateView kind="loading" message="Loading safety center…" />
      ) : error ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.tipsCard}>
            <View style={styles.tipsHead}>
              <Lightbulb size={18} color={Colors.gold} strokeWidth={2} />
              <Text style={styles.tipsTitle}>Safety tips</Text>
            </View>
            {TIPS.map((t) => (
              <View key={t} style={styles.tipRow}>
                <View style={styles.dot} />
                <Text style={styles.tipText}>{t}</Text>
              </View>
            ))}
          </View>

          <PrimaryButton label="Report a problem" variant="secondary" onPress={() => router.push('/connect/settings/report')} />

          <Text style={styles.group}>Blocked users</Text>
          {blocked && blocked.length > 0 ? (
            <View style={styles.card}>
              {blocked.map((u, i, arr) => (
                <View key={u.id} style={[styles.blockRow, i < arr.length - 1 && styles.divider]}>
                  <View style={styles.blockIcon}><UserX size={16} color={Colors.error} strokeWidth={2} /></View>
                  <Text style={styles.blockName}>{u.displayName}</Text>
                  <Pressable
                    onPress={() => Alert.alert('Unblock?', `Unblock ${u.displayName}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Unblock', onPress: () => unblock.mutate(u.id) },
                    ])}
                  >
                    <Text style={styles.unblock}>Unblock</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <StateView kind="empty" compact icon="UserX" title="No blocked users" message="People you block appear here." />
          )}

          <Text style={styles.group}>Report history</Text>
          {cases && cases.length > 0 ? (
            <View style={styles.card}>
              {cases.map((c, i, arr) => (
                <View key={c.id} style={[styles.caseRow, i < arr.length - 1 && styles.divider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.caseReason}>{c.reason}</Text>
                    <Text style={styles.caseMeta}>{c.kind === 'appeal' ? 'Appeal' : 'Report'} · {new Date(c.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>{statusLabel(c.status)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <StateView kind="empty" compact icon="Flag" title="No reports yet" message="Your reports and their status appear here." />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md, paddingTop: Spacing.sm },
  tipsCard: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  tipsHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tipsTitle: { ...Typography.titleMd, color: Colors.onSurface },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.onWarning, marginTop: 7 },
  tipText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  blockIcon: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.iconBgRed, alignItems: 'center', justifyContent: 'center' },
  blockName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  unblock: { ...Typography.labelMd, color: Colors.secondary },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  caseRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  caseReason: { ...Typography.labelLg, color: Colors.onSurface },
  caseMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  statusPill: { backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  statusText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
