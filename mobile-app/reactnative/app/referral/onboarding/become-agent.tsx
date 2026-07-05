import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UsersRound } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';

// M-ONB-06 — Become Agent/Team Lead (intro). Override model explained
// (activity-based, capped), with mandatory disclosures.
const BENEFITS = [
  'Build a team of referrers under your network.',
  'Earn a capped override on your team’s verified activity — not on signups.',
  'Tools to track team performance and standing.',
];
const DISCLOSURES = [
  'Overrides are a percentage of your team members’ verified, real activity only.',
  'There is a hard cap. We never pay multi-level "downline" bonuses for recruitment.',
  'House/organic signups are excluded from override chains.',
];

export default function BecomeAgent() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Become an Agent" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><UsersRound size={28} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.title}>Lead a team as an Agent</Text>
          <Text style={styles.subtitle}>Grow a network and earn capped overrides on genuine activity.</Text>
        </View>

        <Section title="What you get" items={BENEFITS} />

        <DisclosureCard
          tone="warn"
          title="How overrides work — read carefully"
          points={DISCLOSURES}
        />
        <DisclosureCard
          tone="compliant"
          body="Every naira of override ties to the verified activity and revenue of your team — never to recruiting people."
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
