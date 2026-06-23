import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAdminSummary } from '@/features/estateadmin/hooks';
import { ADMIN_ACTIONS } from '@/features/estateadmin/api';
import type { AdminSummary } from '@/features/estateadmin/api';

export default function EstateAdminScreen() {
  const { data, isLoading, isError, refetch } = useAdminSummary();

  const attentionItems = data ? [
    { label: 'Join requests', n: data.attention.pendingJoinRequests },
    { label: 'Open emergencies', n: data.attention.openEmergencies },
    { label: 'Open repairs', n: data.attention.openRepairs },
    { label: 'Unpaid invoices', n: data.attention.pendingInvoices },
    { label: 'Pending bookings', n: data.attention.pendingBookings },
  ].filter((x) => x.n > 0) : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Admin" subtitle="Estate control panel" />
      {isLoading ? <StateView kind="loading" message="Loading…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.row}>
              <Stat label="Residents" value={String(data?.residents ?? 0)} />
              <Stat label="Properties" value={String(data?.properties ?? 0)} />
              <Stat label="Upcoming meetings" value={String(data?.upcomingMeetings ?? 0)} />
            </View>

            {attentionItems.length > 0 ? (
              <View style={styles.attention}>
                <Text style={styles.attentionTitle}>Needs attention</Text>
                {attentionItems.map((x) => (
                  <View key={x.label} style={styles.attentionRow}>
                    <Text style={styles.attentionLabel}>{x.label}</Text>
                    <View style={styles.attentionBadge}><Text style={styles.attentionBadgeText}>{x.n}</Text></View>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.section}>Quick actions</Text>
            <View style={styles.grid}>
              {ADMIN_ACTIONS.map((a) => {
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[a.icon] ?? Icons.Square;
                const badge = a.badgeKey && data ? data.attention[a.badgeKey] : 0;
                return (
                  <Pressable key={a.id} onPress={() => router.push(a.route as never)} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                    <View style={styles.tileIcon}>
                      <Icon size={22} color={Colors.primary} strokeWidth={1.8} />
                      {badge && badge > 0 ? <View style={styles.dot}><Text style={styles.dotText}>{badge}</Text></View> : null}
                    </View>
                    <Text style={styles.tileLabel} numberOfLines={1}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, alignItems: 'center', gap: 2, ...shadow1 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  attention: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  attentionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  attentionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attentionLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  attentionBadge: { minWidth: 26, height: 26, borderRadius: Radius.full, paddingHorizontal: 8, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  attentionBadgeText: { ...Typography.labelSm, color: Colors.onError, fontWeight: '700' },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: '30%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingVertical: Spacing.md, alignItems: 'center', gap: 6, ...shadow1 },
  pressed: { opacity: 0.85 },
  tileIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  dotText: { ...Typography.labelSm, color: Colors.onError, fontWeight: '700', fontSize: 10 },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface },
});
