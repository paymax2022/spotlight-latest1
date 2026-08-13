import React from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader } from '@/features/referral/components';
import { showToast } from '@/store/toastStore';
import { useNotificationPrefs, useUpdateNotificationPrefs, useConsent, useRecordConsent } from '@/features/referral/foundation/hooks';
import type { NotificationChannel } from '@/features/referral/foundation/types';

// M-ACC-04 — Referral settings. Sharing, privacy, notification prefs.
const CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: 'push', label: 'Push notifications' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

export default function ReferralSettings() {
  const prefs = useNotificationPrefs();
  const updatePrefs = useUpdateNotificationPrefs();
  const consent = useConsent();
  const recordConsent = useRecordConsent();

  const loading = prefs.isLoading || consent.isLoading;
  const errored = prefs.isError || consent.isError;

  // A settings write that fails silently is worse than one that errors: the
  // switch stays flipped and the user believes the preference was saved. Every
  // mutation here reports failure and refetches, so the UI falls back to
  // whatever the server actually holds.
  const saveFailed = (what: string) => () => {
    showToast({ variant: 'error', title: `Could not save ${what}`, message: 'Please try again.' });
  };

  const toggleChannel = (key: NotificationChannel, v: boolean) => {
    if (!prefs.data) return;
    updatePrefs.mutate(
      { ...prefs.data, channels: { ...prefs.data.channels, [key]: v } },
      { onError: () => { saveFailed('your notification settings')(); void prefs.refetch(); } },
    );
  };

  const setConsent = (kind: 'contacts' | 'nudges', granted: boolean) => {
    recordConsent.mutate(
      { kind, granted },
      { onError: () => { saveFailed('your privacy choice')(); void consent.refetch(); } },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Referral settings" />
      {loading ? (
        <StateView kind="loading" />
      ) : errored ? (
        <StateView kind="error" title="Couldn't load settings" actionLabel="Retry" onAction={() => { prefs.refetch(); consent.refetch(); }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Privacy / sharing */}
          <Text style={styles.sectionTitle}>Privacy & sharing</Text>
          <View style={styles.card}>
            <ToggleRow
              label="Allow contact suggestions"
              sub="Use your contacts to suggest people to invite"
              value={!!consent.data?.contactsConsentAt}
              busy={recordConsent.isPending}
              onChange={(v) => setConsent('contacts', v)}
            />
            <ToggleRow
              label="Earning nudges"
              sub="Reminders about pending invitees and unlocks"
              value={!!consent.data?.nudgesConsentAt}
              busy={recordConsent.isPending}
              onChange={(v) => setConsent('nudges', v)}
              last
            />
          </View>

          {/* Notification channels */}
          <Text style={styles.sectionTitle}>Notification channels</Text>
          <View style={styles.card}>
            {CHANNELS.map((c, i) => (
              <ToggleRow
                key={c.key}
                label={c.label}
                value={!!prefs.data?.channels[c.key]}
                busy={updatePrefs.isPending}
                onChange={(v) => toggleChannel(c.key, v)}
                last={i === CHANNELS.length - 1}
              />
            ))}
          </View>

          {/* Links */}
          <Text style={styles.sectionTitle}>More</Text>
          <View style={styles.card}>
            <LinkRow label="Notification preferences" onPress={() => router.push('/referral/account/notifications')} />
            <LinkRow label="Responsible earning" onPress={() => router.push('/referral/account/responsible-earning')} />
            <LinkRow label="Verification & fraud status" onPress={() => router.push('/referral/account/verification-fraud-status')} />
            <LinkRow label="Help & support" onPress={() => router.push('/referral/account/help-support')} last />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ToggleRow({ label, sub, value, busy, onChange, last }: { label: string; sub?: string; value: boolean; busy?: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Switch value={value} disabled={busy} onValueChange={onChange} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} thumbColor={Colors.white} />
    </View>
  );
}

function LinkRow({ label, onPress, last }: { label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.row, !last && styles.rowBorder]} onPress={onPress} accessibilityRole="button">
      <Text style={styles.rowLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sectionTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: Spacing.md, marginBottom: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, gap: Spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
