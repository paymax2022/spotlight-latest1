import React from 'react';
import { Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, EdgeStateView } from '@/features/doctor/components';
import { useAppStatus } from '@/features/doctor/hooks';
import { APP_STATUS_MODE_LABELS } from '@/features/doctor/constants';

// ── Section AD — App-status gate (maintenance / forced update, AD.25-26) ───────
// Dedicated full-screen gate. When useAppStatus reports maintenance or
// app_update_required, the matching EDGE_STATES descriptor renders via the shared
// EdgeStateView; otherwise an "up to date" status card is shown. Reachable from
// the settings hub so reviewers can preview both gate states.

export default function AppStatusScreen() {
  const { data: status, isLoading, isError, refetch } = useAppStatus();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="App Status" />
      {isLoading && !status ? (
        <StateView variant="loading" label="Checking app status" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not check the app status." onRetry={() => refetch()} />
      ) : status.mode === 'maintenance' ? (
        <EdgeStateView kind="maintenance_mode" onPrimary={() => refetch()} />
      ) : status.mode === 'app_update_required' ? (
        <EdgeStateView kind="app_update_required" onPrimary={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <SectionCard title="App status" style={styles.card}>
            <InfoRow label="Status" value={APP_STATUS_MODE_LABELS[status.mode]} valueColor={Colors.teal} />
            <InfoRow label="Current version" value={status.currentVersion} />
            <InfoRow label="Minimum version" value={status.minVersion} />
          </SectionCard>
          <Text style={styles.hint}>You are running the latest supported version.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  card:    { marginBottom: Spacing.md },
  hint:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
