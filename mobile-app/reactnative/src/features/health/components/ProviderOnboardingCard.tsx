import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ArrowRight, BriefcaseMedical } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';

/**
 * "List your practice" CTA shown on every consumer-facing health vertical
 * (telemedicine, pharmacy, lab, vet) so a provider of any of those types can
 * start onboarding from wherever they land, not only from telemedicine.
 */
export default function ProviderOnboardingCard() {
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.icon}>
        <BriefcaseMedical size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <Text style={styles.eyebrow}>FOR HEALTHCARE PROVIDERS</Text>
      <Text style={styles.title}>List your practice on Paymax</Text>
      <Text style={styles.sub}>
        Doctors, pharmacies, diagnostic labs, HMOs, vets and clinics — get verified, publish
        your services and get paid into your wallet.
      </Text>
      <Pressable
        style={styles.btn}
        onPress={() => router.push('/health/provider-onboarding')}
        accessibilityRole="button"
        accessibilityLabel="List your practice as a healthcare provider"
      >
        <Text style={styles.btnText}>Get started</Text>
        <ArrowRight size={18} color={Colors.onPrimary} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card:    { padding: Spacing.cardPadding, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.xs },
  icon:    { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  eyebrow: { ...Typography.labelSm, color: Colors.secondary },
  title:   { ...Typography.titleLg, color: Colors.onSurface },
  sub:     { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  btn:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: Spacing.lg, borderRadius: Radius.full, backgroundColor: Colors.primary },
  btnText: { ...Typography.labelLg, color: Colors.onPrimary },
});
