import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Share2, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useCreateReferral } from '@/features/health/vet/hooks';
import { VET_SPECIALTIES } from '@/features/health/vet/constants';

export default function ReferralScreen() {
  const { appointmentId, petId } = useLocalSearchParams<{ appointmentId?: string; petId: string }>();
  const createRef = useCreateReferral();
  const [specialty, setSpecialty] = useState('');
  const [toVet, setToVet] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = () => {
    if (!specialty || !reason.trim()) {
      setError('Choose a specialty and add a reason.');
      return;
    }
    setError('');
    createRef.mutate(
      { appointmentId: appointmentId ?? 'appt', petId, specialty, toVetName: toVet.trim() || 'Specialist', reason: reason.trim() },
      { onSuccess: () => setDone(true) },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Referral" />
        <StateView
          kind="empty"
          icon="Share2"
          title="Referral sent"
          message="The specialist referral has been recorded and shared with the owner (consent-gated)."
          actionLabel="Back to requests"
          onAction={() => router.replace('/health/vet/provider/requests')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Specialist referral" subtitle="Refer to another vet" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Share2 size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.introText}>Referrals share relevant records with the receiving vet, with the owner’s consent (HL-8).</Text>
        </View>

        <Text style={styles.sectionTitle}>Specialty</Text>
        <View style={styles.chips}>
          {VET_SPECIALTIES.map((s) => {
            const active = specialty === s;
            return (
              <Pressable key={s} style={[styles.chip, active && styles.chipActive]} onPress={() => setSpecialty(s)}>
                {active ? <Check size={13} color={Colors.secondary} strokeWidth={2.6} /> : null}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField label="Refer to (optional)" placeholder="Specialist or clinic name" value={toVet} onChangeText={setToVet} />
        <TextInputField label="Reason for referral *" placeholder="Clinical summary & what you’d like assessed" value={reason} onChangeText={setReason} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Send referral" onPress={onSubmit} loading={createRef.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  introText: { ...Typography.bodySm, color: Colors.onSecondaryFixed, flex: 1, lineHeight: 18 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  chipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.secondary },
  error: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
