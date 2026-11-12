// The doctor's side of the shared room. Opening is idempotent server-side, so
// re-entering this route after a reload re-attaches to the same session.
// Ending goes through the module's own complete route, which also ends the
// consult session and settles the appointment in one transaction.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { Colors, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { ConsultRoom } from '@/features/consult';
import { openTelemedicineConsultSession } from '@/features/consult/api';
import { completeAppointment } from '@/api/telemedicine.api';

export default function DoctorConsultRoomScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const appointmentId = String(id);

  const open = useMutation({
    mutationFn: () => openTelemedicineConsultSession(appointmentId),
  });

  useEffect(() => {
    if (appointmentId) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  if (open.data) {
    return (
      <ConsultRoom
        sessionId={open.data.id}
        role="provider"
        onEnd={() => completeAppointment(appointmentId)}
        onBack={() => router.replace(`/(doctor)/consult/${appointmentId}/notes`)}
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
                router.replace(
                  `/(doctor)/consult/${appointmentId}/call${mode ? `?mode=${mode}` : ''}`,
                )
              }
            />
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
