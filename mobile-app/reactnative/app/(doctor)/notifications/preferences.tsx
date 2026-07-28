import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { ToggleRow, StateView } from '@/features/doctor/components';
import { useNotificationPreferences, useUpdateNotificationPrefs } from '@/features/doctor/hooks';
import { NOTIFICATION_CATEGORY_ICONS } from '@/features/doctor/constants';
import type { NotificationPreference, NotificationCategory } from '@/types/doctor.batch6';

function categoryIcon(cat: NotificationCategory): LucideIcon {
  const map: Record<NotificationCategory, LucideIcon> = {
    appointments: Icons.CalendarDays,
    messages:     Icons.MessageSquare,
    clinical:     Icons.Activity,
    pharmacy:     Icons.Pill,
    hmo:          Icons.ShieldCheck,
    earnings:     Icons.Wallet,
    compliance:   Icons.AlertCircle,
    reputation:   Icons.Star,
    support:      Icons.LifeBuoy,
  };
  void NOTIFICATION_CATEGORY_ICONS;
  return map[cat];
}

// X: notification preferences (per category × push/email/sms channel).
export default function NotificationPreferencesScreen() {
  const { data: prefs = [], isLoading, isError, refetch } = useNotificationPreferences();
  const update = useUpdateNotificationPrefs();
  const [local, setLocal] = useState<NotificationPreference[]>([]);

  useEffect(() => { if (prefs.length) setLocal(prefs); }, [prefs]);

  const setChannel = (cat: NotificationCategory, channel: 'push' | 'email' | 'sms', value: boolean) => {
    setLocal((prev) => prev.map((p) => (p.category === cat ? { ...p, [channel]: value } : p)));
  };

  const save = async () => {
    try {
      await update.mutateAsync({ preferences: local });
      Alert.alert('Saved', 'Your notification preferences have been updated.');
      router.back();
    } catch {
      Alert.alert('Save failed', 'Please try again in a moment.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Notification Preferences" />

      {isLoading && local.length === 0 ? (
        <StateView variant="loading" label="Loading preferences" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your preferences." onRetry={() => refetch()} />
      ) : local.length === 0 ? (
        <StateView variant="empty" icon={Icons.BellOff} title="No preferences" message="Notification categories will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {local.map((p) => {
            const Icon = categoryIcon(p.category);
            return (
              <View key={p.category} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconBox, { backgroundColor: Colors.iconBgPurple }]}>
                    <Icon size={18} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <Text style={styles.cardTitle}>{p.label}</Text>
                </View>
                <View style={styles.toggles}>
                  <ToggleRow icon={Icons.Bell} label="Push" value={p.push} onValueChange={(v) => setChannel(p.category, 'push', v)} />
                  <ToggleRow icon={Icons.Mail} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Email" value={p.email} onValueChange={(v) => setChannel(p.category, 'email', v)} />
                  <ToggleRow icon={Icons.MessageCircle} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="SMS" value={p.sms} onValueChange={(v) => setChannel(p.category, 'sms', v)} />
                </View>
              </View>
            );
          })}
          <PrimaryButton label="Save preferences" onPress={save} loading={update.isPending} style={styles.saveBtn} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  card:       { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox:    { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  toggles:    { gap: Spacing.sm },
  saveBtn:    { marginTop: Spacing.sm },
});
