import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Wifi, Volume2, Video } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import EmergencyBanner from '@/features/health/components/EmergencyBanner';
import { useAppointment, useConsult } from '@/features/health/vet/hooks';
import { VET_EMERGENCY_DISCLAIMER } from '@/features/health/vet/constants';

const CHECKS = [
  { icon: Wifi, label: 'Network connection looks good' },
  { icon: Video, label: 'Camera ready' },
  { icon: Volume2, label: 'Microphone ready' },
];

export default function TeleconsultLobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: appt, isLoading, isError, refetch } = useAppointment(id);
  const { data: consult } = useConsult(appt?.consultId ?? 'vcns_001');

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

  const ready = consult?.providerReady ?? false;

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
              {ready ? 'Your vet is ready to start' : 'Waiting for your vet to join…'}
            </Text>
          </View>
        </View>

        <EmergencyBanner message={VET_EMERGENCY_DISCLAIMER} />

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
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={ready ? 'Join consult' : 'Join when ready'}
          onPress={() => router.replace({ pathname: '/health/vet/teleconsult', params: { id: appt.consultId ?? 'vcns_001', appointmentId: appt.id } })}
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
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  checks: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm },
  checkIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  checkText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
