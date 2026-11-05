// The patient's side of the shared room. It carries the intake gate itself, so
// a deep link (or an old link into the legacy screen) can never start the
// server timer before intake is SUBMITTED. Leaving does not end the timer —
// the engine still ends it at `ends_at` or when the doctor completes.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { ConsultRoom } from '@/features/consult';
import { openTelemedicineConsultSession } from '@/features/consult/api';
import { useApptIntake } from '@/features/health/hooks';

export default function TelemedicineConsultRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);

  // PRD §1 structural gate: the consult cannot start until intake is SUBMITTED.
  // Fail-safe — anything other than an explicit SUBMITTED blocks the room, and
  // the session is not opened (so the server clock is not started) until then.
  const intakeQ = useApptIntake(appointmentId);
  const intakeReady = intakeQ.data?.intake.status === 'SUBMITTED';

  const open = useMutation({
    mutationFn: () => openTelemedicineConsultSession(appointmentId),
  });

  useEffect(() => {
    if (appointmentId && intakeReady) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, intakeReady]);

  const leave = () => router.replace(`/services/telemedicine/appointment/${appointmentId}/summary`);

  if (!intakeReady) {
    const loading = intakeQ.isLoading;
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.gateWrap}>
          <View style={styles.gateIcon}>
            <ClipboardList size={40} color={Colors.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.gateTitle}>
            {loading ? 'Checking your intake…' : 'Complete your health intake first'}
          </Text>
          <Text style={styles.gateBody}>
            {loading
              ? 'One moment.'
              : 'Your consultation can’t start until you’ve shared your health details with the doctor. It only takes a minute and helps your doctor prepare.'}
          </Text>
          {!loading && (
            <View style={styles.gateActions}>
              <PrimaryButton
                label="Add your health details"
                onPress={() => router.replace(`/services/telemedicine/appointment/${appointmentId}/intake`)}
              />
              <PrimaryButton
                label="Back to appointment"
                variant="ghost"
                onPress={() => router.replace(`/services/telemedicine/appointment/${appointmentId}`)}
              />
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

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
              onPress={() => router.replace(`/services/telemedicine/consult/${appointmentId}`)}
            />
            <PrimaryButton label="Back to appointment" variant="ghost" onPress={leave} />
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
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  gateIcon: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  gateTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  gateBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  gateActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
