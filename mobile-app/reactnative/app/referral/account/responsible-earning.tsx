import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Leaf } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { RESPONSIBLE_EARNING_POINTS, COMPLIANT_EARN_LINE } from '@/features/referral/constants/referral.constants';

// M-ACC-06 — Responsible-earning info. Honest expectations; anti-scam guidance.
export default function ResponsibleEarning() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Responsible earning" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Leaf size={26} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
          <Text style={styles.title}>Earn honestly, earn safely</Text>
          <Text style={styles.subtitle}>What to expect — and how to avoid scams that abuse referral programs.</Text>
        </View>

        <DisclosureCard tone="compliant" title="The one rule that matters" body={COMPLIANT_EARN_LINE} />

        <Text style={styles.sectionTitle}>Set honest expectations</Text>
        <View style={styles.list}>
          {RESPONSIBLE_EARNING_POINTS.map((p, i) => (
            <View key={i} style={styles.row}>
              <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
              <Text style={styles.rowText}>{p}</Text>
            </View>
          ))}
        </View>

        <DisclosureCard
          tone="warn"
          title="Watch out for scams"
          body="If anyone promises guaranteed income, asks you to pay to join, or pushes you to recruit rather than refer real users — that is not how Paymax referrals work. Report it."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.xl, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  num: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  numText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  rowText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
