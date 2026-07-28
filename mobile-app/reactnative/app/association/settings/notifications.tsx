import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/features/association/hooks/useSettings';
import type { NotificationPrefs } from '@/features/association/types/settings.types';

const ROWS: { key: keyof NotificationPrefs; label: string; help: string }[] = [
  { key: 'announcements', label: 'Announcements', help: 'Chapter and national announcements.' },
  { key: 'duesReminders', label: 'Dues reminders', help: 'Upcoming and overdue dues.' },
  { key: 'meetings', label: 'Meetings', help: 'Reminders and RSVPs.' },
  { key: 'tasks', label: 'Tasks', help: 'Assignments and due dates.' },
  { key: 'chat', label: 'Chat messages', help: 'New messages in your channels.' },
  { key: 'events', label: 'Events', help: 'Event reminders and updates.' },
];

export default function NotificationSettings() {
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const value = prefs.data;

  const toggle = (key: keyof NotificationPrefs) => { if (value) update.mutate({ ...value, [key]: !value[key] }); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
      {prefs.isLoading || !value ? (
        <StateView kind="loading" message="Loading…" />
      ) : (
        <View style={styles.body}>
          <View style={[styles.card, shadow1]}>
            {ROWS.map((r, i) => (
              <View key={r.key} style={[styles.row, i > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{r.label}</Text>
                  <Text style={styles.help}>{r.help}</Text>
                </View>
                <Switch value={value[r.key]} onValueChange={() => toggle(r.key)} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} thumbColor={Colors.white} accessibilityLabel={r.label} />
              </View>
            ))}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
