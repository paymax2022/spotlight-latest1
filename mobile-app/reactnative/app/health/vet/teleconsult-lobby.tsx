import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Wifi, Volume2, Video } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import EmergencyBanner from '@/features/health/components/EmergencyBanner';
import { useAppointment, useConsult } from '@/features/health/vet/hooks';
import { VET_EMERGENCY_DISCLAIMER } from '@/features/health/vet/constants';
import { openVetConsultSession, useConsultSession } from '@/features/consult';

const CHECKS = [
  { icon: Wifi, label: 'Network connection looks good' },
  { icon: Video, label: 'Camera ready' },
  { icon: Volume2, label: 'Microphone ready' },
];

export default function TeleconsultLobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);
  const { data: appt, isLoading, isError, refetch } = useAppointment(appointmentId);
  const { data: consult } = useConsult(appt ? (appt.consultId ?? appt.id) : '');

  // Open the one timed session pinned to this appointment. When the engine's
  // media rail is unavailable the mutation fails and the legacy VideoSDK room
  // stays reachable — that is the rollback path the spec requires.
  const open = useMutation({ mutationFn: () => openVetConsultSession(appointmentId) });

  useEffect(() => {
    open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  const session = open.data;
  const poll = useConsultSession(session?.id);
  const state = poll.data?.state ?? session?.state;
  const timed = Boolean(session);
  const ready = timed ? state === 'live' : Boolean(consult?.providerReady);
  // Hold Join until the open-session call has actually answered. `isPending` is
  // false while the mutation is still `idle`, so a warm-cache mount would paint
  // an enabled button before the effect fires and a fast tap could land in the
  // legacy room after the engine created a timed one.
  const routingSettled = open.isSuccess || open.isError;

  const status = !timed
    ? consult?.providerReady
      ? 'Your vet is ready to start'
      : 'Waiting for your vet to join…'
    : state === 'live'
      ? 'Your vet is ready to start'
      : state === 'ended' || state === 'cancelled'
        ? 'This consultation has ended'
        : 'Waiting for your vet to join…';

  const join = () => {
    if (timed) {
      router.replace({ pathname: '/health/vet/timed-consult', params: { appointmentId } });
      return;
    }
    router.replace({
      pathname: '/health/vet/teleconsult',
      params: { id: appt?.consultId ?? appt?.id ?? appointmentId, appointmentId },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Consult lobby" />
        <StateView kind="loading" message="Preparing your lobby…" />
      </SafeAreaView>
    );
  }
  if (isError || !appt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Consult lobby" />
        <StateView kind="error" title="Couldn't load this consult" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consult lobby" subtitle={appt.vetName} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{appt.vetName.replace(/^Dr\.?\s*/, '').charAt(0)}</Text>
          </View>
          <Text style={styles.name}>{appt.vetName}</Text>
          <Text style={styles.sub}>Tele-consult for {appt.petName}</Text>
          <View style={[styles.statusChip, ready ? styles.statusOn : styles.statusOff]}>
            <Text style={[styles.statusText, { color: ready ? Colors.teal : Colors.onSurfaceVariant }]}>
              {status}
            </Text>
          </View>
          {open.isError ? (
            <Text style={styles.fallback}>
              The live timed room is unavailable right now, so the standard room opens instead.
            </Text>
          ) : null}
        </View>

        <EmergencyBanner message={VET_EMERGENCY_DISCLAIMER} />

        {session?.mode === 'chat' ? (
          <Text style={styles.sectionTitle}>
            This is a timed chat consultation — video and audio are not used.
          </Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Pre-call checks</Text>
            <View style={styles.checks}>
              {CHECKS.map((c) => (
                <View key={c.label} style={styles.checkRow}>
                  <View style={styles.checkIcon}>
                    <c.icon size={16} color={Colors.teal} strokeWidth={2} />
                  </View>
                  <Text style={styles.checkText}>{c.label}</Text>
                  <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={!routingSettled ? 'Opening your room…' : ready ? 'Join consult' : 'Join when ready'}
          onPress={join}
          disabled={!routingSettled}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  // letterSpacing re-stated: displayLg's -0.96 is -0.02em at its own 48px, and
  // spreading the style while overriding only the size keeps that ABSOLUTE
  // value, which is tighter than the scale intends at 40px. -0.8 is the same -0.02em.
  avatarText: { ...Typography.displayLg, fontSize: 40, letterSpacing: -0.8, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusChip: { marginTop: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full },
  statusOn: { backgroundColor: Colors.iconBgTeal },
  statusOff: { backgroundColor: Colors.surfaceContainerHigh },
  statusText: { ...Typography.labelMd },
  fallback: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm, paddingHorizontal: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  checks: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm },
  checkIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  checkText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
