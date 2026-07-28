import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useProviderAvailability, useSetProviderAvailability } from '@/features/health/vet/hooks';
import { APPT_TYPE_META } from '@/features/health/vet/constants';
import type { ProviderAvailabilityBlock } from '@/features/health/vet/types';

export default function ProviderAvailabilityScreen() {
  const { data, isLoading, isError, refetch } = useProviderAvailability();
  const save = useSetProviderAvailability();
  const [blocks, setBlocks] = useState<ProviderAvailabilityBlock[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (data && !hydrated) {
      setBlocks(data);
      setHydrated(true);
    }
  }, [data, hydrated]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Availability" />
        <StateView kind="loading" message="Loading calendar…" />
      </SafeAreaView>
    );
  }
  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Availability" />
        <StateView kind="error" title="Couldn't load availability" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const toggle = (id: string) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Availability & calendar" subtitle="Set your weekly hours" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {blocks.length === 0 ? (
          <StateView kind="empty" icon="CalendarClock" title="No blocks yet" message="Add availability blocks to accept bookings." compact />
        ) : (
          blocks.map((b) => {
            const m = APPT_TYPE_META[b.type];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Video;
            return (
              <View key={b.id} style={[styles.card, shadow1]}>
                <View style={[styles.iconBox, { backgroundColor: m.bg }]}>
                  <Icon size={16} color={m.color} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.day}>{b.day} · {m.label}</Text>
                  <Text style={styles.time}>{b.start} – {b.end}</Text>
                </View>
                <Switch
                  value={b.enabled}
                  onValueChange={() => toggle(b.id)}
                  trackColor={{ true: Colors.secondaryContainer, false: Colors.outlineVariant }}
                  thumbColor={Colors.white}
                />
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Save availability" onPress={() => save.mutate(blocks)} loading={save.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  day: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface },
  time: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
