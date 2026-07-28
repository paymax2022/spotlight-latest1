import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { usePrivacy, useUpdatePrivacy } from '@/features/connect/profile/hooks';
import type { PrivacySettings } from '@/features/connect/profile/types';

// PR — Privacy & visibility. Per-mode walls, location precision (approximate by
// default, §3), and activity signals. Each change is applied optimistically to
// local state then persisted.
const PRECISION_OPTIONS: { value: PrivacySettings['locationPrecision']; label: string }[] = [
  { value: 'approximate', label: 'Approximate' },
  { value: 'precise', label: 'Precise' },
];

export default function ProfilePrivacy() {
  const { data, isLoading, error, refetch } = usePrivacy();
  const update = useUpdatePrivacy();
  const [local, setLocal] = useState<PrivacySettings | null>(null);

  useEffect(() => {
    if (data) setLocal(data);
  }, [data]);

  const apply = (patch: Partial<PrivacySettings>) => {
    if (!local) return;
    const next = { ...local, ...patch };
    setLocal(next);
    update.mutate(next);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Privacy & visibility" />

      {isLoading || (!local && !error) ? (
        <StateView kind="loading" message="Loading privacy…" />
      ) : error || !local ? (
        <StateView
          kind="error"
          title="Couldn't load settings"
          icon="ShieldAlert"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.group}>Per-mode visibility</Text>
          <View style={styles.card}>
            <ToggleRow
              label="Show on Date"
              sub="Your Date profile is discoverable"
              value={local.dateVisible}
              onValueChange={(v) => apply({ dateVisible: v })}
              divider
            />
            <ToggleRow
              label="Show on Network"
              sub="Your Network profile is discoverable"
              value={local.networkVisible}
              onValueChange={(v) => apply({ networkVisible: v })}
            />
          </View>

          <Text style={styles.group}>Location</Text>
          <View style={styles.card}>
            <View style={styles.locationRow}>
              <MapPin size={18} color={Colors.primary} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.locLabel}>Location precision</Text>
                <Text style={styles.locSub}>
                  Approximate keeps your exact location private — recommended for
                  your safety.
                </Text>
              </View>
            </View>
            <View style={styles.segment}>
              {PRECISION_OPTIONS.map((opt) => {
                const active = local.locationPrecision === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.segBtn, active && styles.segBtnActive]}
                    onPress={() => apply({ locationPrecision: opt.value })}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text style={styles.group}>Activity</Text>
          <View style={styles.card}>
            <ToggleRow
              label="Show online status"
              value={local.showOnlineStatus}
              onValueChange={(v) => apply({ showOnlineStatus: v })}
              divider
            />
            <ToggleRow
              label="Show distance"
              value={local.showDistance}
              onValueChange={(v) => apply({ showDistance: v })}
              divider
            />
            <ToggleRow
              label="Read receipts"
              sub="Let people know when you've read their message"
              value={local.readReceipts}
              onValueChange={(v) => apply({ readReceipts: v })}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  group: {
    ...Typography.labelMd,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.md },
  locLabel: { ...Typography.labelLg, color: Colors.onSurface },
  locSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 17 },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: 4,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  segBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.sm, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.surfaceContainerLowest },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segTextActive: { color: Colors.primary, fontWeight: '700' },
});
