// The pet owner's side of the shared room. Opening is idempotent server-side,
// so a reload re-attaches to the same session. Leaving does not end the timer:
// the engine ends it at `ends_at` or when the vet completes the consult.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { Colors, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { useAppointment } from '@/features/health/vet/hooks';
import { ConsultRoom, openVetConsultSession } from '@/features/consult';

export default function VetTimedConsultScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const apptId = String(appointmentId);
  const appointment = useAppointment(apptId);

  const open = useMutation({ mutationFn: () => openVetConsultSession(apptId) });

  useEffect(() => {
    if (apptId) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId]);

  const leave = () => router.replace('/health/vet/appointments');

  if (open.data) {
    return <ConsultRoom sessionId={open.data.id} role="patient" onBack={leave} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {open.error ? (
          <>
            <Text style={styles.error}>
              {open.error instanceof Error ? open.error.message : 'This consultation is unavailable.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => open.mutate()} />
            <PrimaryButton
              label="Use the standard room"
              variant="ghost"
              onPress={() =>
                router.replace({
                  pathname: '/health/vet/teleconsult',
                  params: { id: appointment.data?.consultId ?? apptId, appointmentId: apptId },
                })
              }
            />
            <PrimaryButton label="Back to appointments" variant="ghost" onPress={leave} />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loading}>Opening your consultation…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loading: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
});
