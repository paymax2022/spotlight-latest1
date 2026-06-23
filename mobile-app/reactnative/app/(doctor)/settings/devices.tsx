import React from 'react';
import { Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Smartphone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, DeviceRow } from '@/features/doctor/components';
import { useDevices, useRevokeDevice } from '@/features/doctor/hooks';

// ── Section AC — Device management (AC.14) ────────────────────────────────────
// NEW screen: lists active devices/sessions; the current device cannot be
// revoked. Reuses DeviceRow with a destructive confirm before revoking.

export default function DeviceManagementScreen() {
  const { data: devices = [], isLoading, isError, refetch } = useDevices();
  const revoke = useRevokeDevice();

  const handleRevoke = (deviceId: string, label: string) => {
    Alert.alert('Revoke device?', `${label} will be signed out immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            await revoke.mutateAsync({ deviceId });
          } catch {
            Alert.alert('Failed', 'Could not revoke the device. Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Devices" />
      {isLoading && devices.length === 0 ? (
        <StateView variant="loading" label="Loading devices" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your devices." onRetry={() => refetch()} />
      ) : devices.length === 0 ? (
        <StateView variant="empty" icon={Smartphone} title="No devices" message="Devices signed in to your account will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.intro}>Devices currently signed in to your account.</Text>
          <SectionCard style={styles.card}>
            {devices.map((d, i) => (
              <DeviceRow key={d.id} device={d} border={i > 0} onRevoke={() => handleRevoke(d.id, d.label)} />
            ))}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  intro:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card:    { marginBottom: Spacing.md },
});
