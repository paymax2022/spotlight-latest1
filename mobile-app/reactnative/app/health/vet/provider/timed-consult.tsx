// The vet's side of the shared room. Ending here stops the session for both
// sides and opens the SOAP note; saving the note is still what completes the
// legacy consult and releases the held payment (HL-9).

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { Colors, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { useAppointment } from '@/features/health/vet/hooks';
import { ConsultRoom, completeConsultSession, openVetConsultSession } from '@/features/consult';

export default function VetProviderTimedConsultScreen() {
  const { id, appointmentId } = useLocalSearchParams<{ id: string; appointmentId?: string }>();
  const apptId = String(appointmentId ?? id);
  const appointment = useAppointment(apptId);

  const open = useMutation({ mutationFn: () => openVetConsultSession(apptId, true) });

  useEffect(() => {
    if (apptId) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId]);

  const notes = () =>
    router.replace({
      pathname: '/health/vet/provider/soap-notes',
      params: { appointmentId: apptId, petId: appointment.data?.petId ?? '' },
    });

  if (open.data) {
    const sessionId = open.data.id;
    return (
      <ConsultRoom
        sessionId={sessionId}
        role="provider"
        onEnd={async () => {
          await completeConsultSession(sessionId);
          notes();
        }}
      />
    );
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
                  pathname: '/health/vet/provider/teleconsult',
                  params: { id: apptId, appointmentId: apptId },
                })
              }
            />
            <PrimaryButton label="Write notes instead" variant="ghost" onPress={notes} />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loading}>Opening the consultation…</Text>
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
