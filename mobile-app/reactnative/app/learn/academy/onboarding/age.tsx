import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import DatePickerField from '@/components/DatePickerField';
import { useUpdateProfile } from '@/features/academy/hooks';

/**
 * A6 — Age / KYC tier capture. DOB → minor classification & child-safety rules.
 * Minors are routed to the guardian-consent path (A7); adults skip to class (A9).
 */
export default function AgeKycScreen() {
  const [dob, setDob] = useState('');           // YYYY-MM-DD
  const updateProfile = useUpdateProfile();

  const { valid, age, isMinor } = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
    if (!m) return { valid: false, age: 0, isMinor: false };
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return { valid: false, age: 0, isMinor: false };
    const a = Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
    return { valid: a > 2 && a < 100, age: a, isMinor: a < 18 };
  }, [dob]);

  const next = () => {
    updateProfile.mutate(
      { dob },
      { onSuccess: () => router.push(isMinor ? '/learn/academy/onboarding/consent' : '/learn/academy/onboarding/class') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your date of birth" subtitle="Step 2 of 4 · Age & safety" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.tierCard}>
          <ShieldCheck size={20} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.tierText}>
            We collect the minimum needed. Your age sets your KYC tier and, for under-18s, turns on child-safety protections.
          </Text>
        </View>

        <DatePickerField
          label="Date of birth"
          value={dob}
          onChange={setDob}
          minYear={1920}
          maxYear={new Date().getFullYear()}
        />

        {valid ? (
          <View style={[styles.resultCard, isMinor ? styles.minorCard : styles.adultCard]}>
            <Text style={styles.resultTitle}>{age} years old</Text>
            <Text style={styles.resultSub}>
              {isMinor
                ? 'You’re a minor. We’ll ask a parent or guardian to give consent before purchases, redemptions or community features.'
                : 'You’re an adult learner. KYC Tier 1 unlocked — you can purchase and redeem rewards.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={!valid} loading={updateProfile.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  tierCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, padding: Spacing.md, borderRadius: Radius.md, marginBottom: Spacing.lg },
  tierText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  resultCard: { padding: Spacing.cardPadding, borderRadius: Radius.lg, marginTop: Spacing.sm },
  minorCard: { backgroundColor: Colors.iconBgGold },
  adultCard: { backgroundColor: Colors.iconBgTeal },
  resultTitle: { ...Typography.titleMd, color: Colors.onSurface },
  resultSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
