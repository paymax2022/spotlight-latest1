import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, ToggleRow, StateView, StatusBadge } from '@/features/doctor/components';
import { usePrivacySettings, useUpdatePrivacySettings, useRequestDataExport, useRequestAccountDeletion } from '@/features/doctor/hooks';
import type { DataSharingPreference, DataRequestStatus } from '@/types/doctor.batch7';

// ── Section AB — Data privacy settings (AB.4) ─────────────────────────────────
// NEW screen: sharing preferences (toggle), data-export request and account-
// deletion request (gated confirm). Reuses ToggleRow + StatusBadge. Account
// deletion uses the single shared useRequestAccountDeletion mutation (AB+AC).

const REQUEST_LABEL: Record<DataRequestStatus, string> = {
  none: 'Not requested', requested: 'Requested', processing: 'Processing',
  ready: 'Ready', completed: 'Completed', rejected: 'Rejected',
};

export default function PrivacySettingsScreen() {
  const { data: settings, isLoading, isError, refetch } = usePrivacySettings();
  const updatePrefs = useUpdatePrivacySettings();
  const exportData = useRequestDataExport();
  const deleteAccount = useRequestAccountDeletion();

  const [prefs, setPrefs] = useState<DataSharingPreference[] | null>(null);
  const current = prefs ?? settings?.sharingPreferences ?? [];

  const toggle = (key: string, value: boolean) => {
    const next = current.map((p) => (p.key === key ? { ...p, enabled: value } : p));
    setPrefs(next);
    updatePrefs.mutate({ sharingPreferences: next });
  };

  const handleExport = async () => {
    try {
      await exportData.mutateAsync(undefined);
      Alert.alert('Export requested', 'We will email you when your data export is ready to download.');
    } catch {
      Alert.alert('Failed', 'Could not request your data export. Please try again.');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete account data?',
      'This requests permanent deletion of your account and data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount.mutateAsync(undefined);
              Alert.alert('Deletion requested', 'Your account deletion request has been received.');
            } catch {
              Alert.alert('Failed', 'Could not submit your deletion request. Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Data & Privacy" />
      {isLoading && !settings ? (
        <StateView variant="loading" label="Loading privacy settings" />
      ) : isError || !settings ? (
        <StateView variant="error" message="We could not load your privacy settings." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.groupTitle}>Data sharing</Text>
          <View style={styles.toggleGroup}>
            {current.map((p) => (
              <ToggleRow
                key={p.key}
                icon={p.locked ? Lock : undefined}
                label={p.label}
                description={p.locked ? 'Required by policy' : undefined}
                value={p.enabled}
                onValueChange={(v) => toggle(p.key, v)}
                disabled={p.locked}
              />
            ))}
          </View>

          <SectionCard title="Export your data" style={styles.card}>
            <View style={styles.statusRow}>
              <Text style={styles.muted}>Request a copy of all your data.</Text>
              <StatusBadge label={REQUEST_LABEL[settings.exportStatus]} tone={settings.exportStatus === 'none' ? 'neutral' : 'info'} />
            </View>
            <PrimaryButton label="Request data export" onPress={handleExport} loading={exportData.isPending} variant="secondary" style={styles.btn} />
          </SectionCard>

          <SectionCard title="Delete account" style={styles.card}>
            <View style={styles.statusRow}>
              <Text style={styles.muted}>Permanently delete your account and data.</Text>
              <StatusBadge label={REQUEST_LABEL[settings.deletionStatus]} tone={settings.deletionStatus === 'none' ? 'neutral' : 'danger'} />
            </View>
            <PrimaryButton label="Request account deletion" onPress={handleDelete} loading={deleteAccount.isPending} variant="ghost" style={styles.btn} />
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  groupTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  toggleGroup: { gap: Spacing.sm, marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  statusRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  btn:         { marginTop: Spacing.xs },
});
