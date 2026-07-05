import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { usePrivacyPrefs, useUpdatePrivacyPrefs, useBlockedUsers } from '@/features/connect/hooks/useConnect';

// ST-04 — Privacy & visibility. Per-mode controls, location privacy, blocked list.
export default function Privacy() {
  const { data, isLoading, error, refetch } = usePrivacyPrefs();
  const update = useUpdatePrivacyPrefs();
  const { data: blocked } = useBlockedUsers();

  const set = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Privacy & visibility" />
      {isLoading ? (
        <StateView kind="loading" message="Loading privacy…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load settings" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.group}>Per-mode visibility</Text>
          <View style={styles.card}>
            <ToggleRow label="Visible in Dating" sub="Your dating profile is discoverable" value={data.dateVisible} onValueChange={(v) => set({ dateVisible: v })} divider />
            <ToggleRow label="Visible in Networking" sub="Your networking profile is discoverable" value={data.networkVisible} onValueChange={(v) => set({ networkVisible: v })} />
          </View>

          <Text style={styles.group}>Location</Text>
          <View style={styles.card}>
            <View style={styles.locationRow}>
              <MapPin size={18} color={Colors.primary} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.locLabel}>Location precision</Text>
                <Text style={styles.locSub}>Approximate keeps your exact location private (recommended)</Text>
              </View>
            </View>
            <View style={styles.segment}>
              {(['approximate', 'precise'] as const).map((p) => {
                const active = data.locationPrecision === p;
                return (
                  <Pressable key={p} style={[styles.segBtn, active && styles.segBtnActive]} onPress={() => set({ locationPrecision: p })}>
                    <Text style={[styles.segText, active && styles.segTextActive]}>{p === 'approximate' ? 'Approximate' : 'Precise'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text style={styles.group}>Activity</Text>
          <View style={styles.card}>
            <ToggleRow label="Show online status" value={data.showOnlineStatus} onValueChange={(v) => set({ showOnlineStatus: v })} divider />
            <ToggleRow label="Show distance" value={data.showDistance} onValueChange={(v) => set({ showDistance: v })} divider />
            <ToggleRow label="Read receipts" value={data.readReceipts} onValueChange={(v) => set({ readReceipts: v })} />
          </View>

          <Pressable style={styles.blockedRow} onPress={() => router.push('/connect/settings/safety-center')}>
            <Text style={styles.blockedLabel}>Blocked users</Text>
            <Text style={styles.blockedCount}>{blocked?.length ?? 0}</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.md },
  locLabel: { ...Typography.labelLg, color: Colors.onSurface },
  locSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  segBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.sm, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.surfaceContainerLowest },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segTextActive: { color: Colors.primary },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.lg },
  blockedLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  blockedCount: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
