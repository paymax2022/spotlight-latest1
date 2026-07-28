import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/features/connect/hooks/useConnect';
import type { NotificationPrefs } from '@/features/connect/types/connect.types';

// ST-05 — Notifications settings. Channel/topic toggles. Safety alerts are locked.
export default function Notifications() {
  const { data, isLoading, error, refetch } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const set = (patch: Partial<NotificationPrefs>) => update.mutate(patch);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
      {isLoading ? (
        <StateView kind="loading" message="Loading notifications…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load settings" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.group}>Channels</Text>
          <View style={styles.card}>
            <ToggleRow label="Push" value={data.push} onValueChange={(v) => set({ push: v })} divider />
            <ToggleRow label="Email" value={data.email} onValueChange={(v) => set({ email: v })} divider />
            <ToggleRow label="SMS" value={data.sms} onValueChange={(v) => set({ sms: v })} />
          </View>

          <Text style={styles.group}>Topics</Text>
          <View style={styles.card}>
            <ToggleRow label="New matches" value={data.matches} onValueChange={(v) => set({ matches: v })} divider />
            <ToggleRow label="Messages" value={data.messages} onValueChange={(v) => set({ messages: v })} divider />
            <ToggleRow label="Gifts" value={data.gifts} onValueChange={(v) => set({ gifts: v })} divider />
            <ToggleRow label="Live streams" value={data.liveStreams} onValueChange={(v) => set({ liveStreams: v })} divider />
            <ToggleRow label="Promotions" value={data.promotions} onValueChange={(v) => set({ promotions: v })} divider />
            <ToggleRow label="Safety alerts" sub="Critical safety notices can't be turned off" value locked onValueChange={() => {}} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
});
