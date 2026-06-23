import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/features/crowdfunding/hooks/useExtras';
import type { NotificationPrefs } from '@/features/crowdfunding/types/crowdfunding.types';

const FIELDS: { key: keyof NotificationPrefs; label: string; sub: string }[] = [
  { key: 'push', label: 'Push notifications', sub: 'On this device' },
  { key: 'email', label: 'Email', sub: 'Receipts and summaries' },
  { key: 'sms', label: 'SMS', sub: 'Critical alerts only' },
  { key: 'contributionAlerts', label: 'Contribution alerts', sub: 'When someone backs your campaign' },
  { key: 'campaignUpdates', label: 'Campaign updates', sub: 'From campaigns you back' },
  { key: 'marketing', label: 'Tips & promotions', sub: 'Occasional product news' },
];

export default function NotificationSettings() {
  const { data, isLoading, isError, refetch } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => { if (data) setPrefs(data); }, [data]);

  const toggle = (key: keyof NotificationPrefs) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    update.mutate(next);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
      {isLoading || !prefs ? (
        isError ? <StateView kind="error" title="Couldn't load settings" actionLabel="Retry" onAction={refetch} /> : <StateView kind="loading" />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            {FIELDS.map((f, i, arr) => (
              <Pressable key={f.key} style={[styles.row, i < arr.length - 1 && styles.rowBorder]} onPress={() => toggle(f.key)} accessibilityRole="switch" accessibilityState={{ checked: prefs[f.key] }}>
                <View style={styles.rowBody}>
                  <Text style={styles.label}>{f.label}</Text>
                  <Text style={styles.sub}>{f.sub}</Text>
                </View>
                <View style={[styles.switch, prefs[f.key] && styles.switchOn]}><View style={[styles.knob, prefs[f.key] && styles.knobOn]} /></View>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>Changes are saved automatically.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowBody: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.md },
});
