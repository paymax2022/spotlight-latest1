import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Store } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';

// M-ONB-07 — Become Merchant/Partner (intro). Fund-your-own-campaign overview.
const BENEFITS = [
  'Fund campaigns that reward customers for real purchases.',
  'Set your own budget, caps and reward rules.',
  'Settle on the same rails, with transparent reporting.',
];
const REQUIREMENTS = [
  'Business verification (step-up KYC / KYB).',
  'A funding source for your campaign budget.',
];

export default function BecomeMerchant() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Become a Merchant" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Store size={28} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.title}>Fund your own campaigns</Text>
          <Text style={styles.subtitle}>Reward customers for genuine purchases on the Spotlight rails.</Text>
        </View>

        <Section title="What you get" items={BENEFITS} />
        <Section title="What you need" items={REQUIREMENTS} />

        <DisclosureCard
          tone="compliant"
          body="Merchant rewards are funded by you and paid only on verified customer activity — keeping the program fair and compliant."
        />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue to verification" onPress={() => router.push('/referral/onboarding/step-up-verify')} />
      </View>
    </SafeAreaView>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((t, i) => (
        <View key={i} style={styles.row}><View style={styles.dot} /><Text style={styles.rowText}>{t}</Text></View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  section: { gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 8 },
  rowText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
