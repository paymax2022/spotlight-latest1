import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Check, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useApptIntake, useSaveApptDraft } from '@/features/health/hooks';
import { NDPA_CONSENT_COPY } from '@/features/health/constants/health.constants';

/**
 * M2 — Consent. First-time consent to share the intake with the assigned doctor.
 * Records the accepted consent version (saved on the draft) before the wizard.
 */
export default function IntakeConsentScreen() {
  const { id, prebooking, doctorId } = useLocalSearchParams<{ id: string; prebooking?: string; doctorId?: string }>();
  const appointmentId = id ?? '';
  const bundleQ = useApptIntake(appointmentId);
  const saveDraft = useSaveApptDraft(appointmentId);
  const [agreed, setAgreed] = useState(false);

  const consent = bundleQ.data?.consent;

  const onContinue = () => {
    if (!consent) return;
    saveDraft.mutate(
      { answers: {}, consentVersion: consent.version },
      {
        onSuccess: () => {
          bundleQ.refetch();
          router.replace({
            pathname: '/services/telemedicine/appointment/[id]/intake',
            params: { id: appointmentId, ...(prebooking === '1' && doctorId ? { prebooking: '1', doctorId: String(doctorId) } : {}) },
          });
        },
      },
    );
  };

  if (bundleQ.isLoading || !consent) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Before we start" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Before we start" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.iconBox}><ShieldCheck size={30} color={Colors.primary} strokeWidth={2} /></View>
        <Text style={styles.title}>Sharing your health details</Text>
        <Text style={styles.body}>{consent.body}</Text>

        <View style={styles.privacy}>
          <Lock size={13} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.privacyText}>{NDPA_CONSENT_COPY}</Text>
        </View>

        <Text style={styles.version}>Consent version {consent.version}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.checkRow} onPress={() => setAgreed((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
          <View style={[styles.check, agreed && styles.checkOn]}>
            {agreed ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.checkLabel}>
            I agree to share these details with the doctor assigned to this appointment.
          </Text>
        </Pressable>
        <PrimaryButton label="Agree & continue" onPress={onContinue} disabled={!agreed} loading={saveDraft.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  iconBox: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  privacyText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 17 },
  version: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: {
    padding: Spacing.containerMargin, gap: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest,
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  check: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 19 },
});
