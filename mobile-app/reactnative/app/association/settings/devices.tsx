import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Smartphone, Monitor, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useDevices, useRevokeDevice } from '@/features/association/hooks/useSettings';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import type { Device } from '@/features/association/types/settings.types';
import { confirmAsync } from '@/lib/confirm';

export default function DevicesScreen() {
  const devices = useDevices();
  const revoke = useRevokeDevice();

  const confirmRevoke = async (d: Device) => {
    const ok = await confirmAsync({ title: 'Sign out device', message: `Sign out ${d.name}? It will need to log in again.`, confirmLabel: 'Sign out', destructive: true });
    if (!ok) return;
    revoke.mutate(d.id);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Devices" />
      {devices.isLoading ? (
        <StateView kind="loading" message="Loading devices…" />
      ) : devices.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => devices.refetch()} />
      ) : (
        <FlatList
          data={devices.data ?? []}
          keyExtractor={(d) => d.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => {
            const Icon = item.platform === 'Web' ? Monitor : Smartphone;
            return (
              <View style={[styles.card, shadow1]}>
                <View style={styles.iconBox}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    {item.current ? <View style={styles.currentChip}><Text style={styles.currentText}>This device</Text></View> : null}
                  </View>
                  <Text style={styles.meta}>{item.platform} · {relativeTime(item.lastActive)}</Text>
                  {item.location ? (
                    <View style={styles.locRow}><MapPin size={11} color={Colors.outline} strokeWidth={2} /><Text style={styles.loc}>{item.location}</Text></View>
                  ) : null}
                </View>
                {!item.current ? (
                  <Pressable onPress={() => confirmRevoke(item)} hitSlop={8} style={styles.revokeBtn} accessibilityRole="button" accessibilityLabel={`Sign out ${item.name}`}>
                    <Text style={styles.revokeText}>Sign out</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  currentChip: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  currentText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  loc: { ...Typography.caption, color: Colors.outline },
  revokeBtn: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  revokeText: { ...Typography.labelMd, color: Colors.error, fontWeight: '600' as const },
});
