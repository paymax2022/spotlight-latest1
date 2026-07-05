import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Send, UserRound, ShieldCheck, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { COMPLIANT_EARN_LINE } from '@/features/referral/constants/referral.constants';

// M-ONB-02 — "How earning works" explainer. Earnings tie to friends' REAL
// activity (the pyramid-line message), never to recruitment.
const STEPS = [
  { icon: Send,       title: 'You invite a friend',      body: 'Share your link, code or QR with people you actually know.' },
  { icon: UserRound,  title: 'They join & verify',        body: 'Your friend signs up and completes KYC (BVN/NIN) — one identity, one person.' },
  { icon: Wallet,     title: 'They genuinely transact',   body: 'You earn from their real, verified product activity — not from the signup itself.' },
  { icon: ShieldCheck, title: 'Rewards vest, then pay',   body: 'Earnings release in stages as your friend proves real value, then land in your wallet.' },
];

export default function HowEarningWorks() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="How earning works" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <View key={s.title} style={styles.step}>
              <View style={styles.stepIndex}>
                <View style={styles.stepIconBox}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                {i < STEPS.length - 1 && <View style={styles.connector} />}
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepText}>{s.body}</Text>
              </View>
            </View>
          );
        })}

        <DisclosureCard tone="compliant" title="The fair-earning rule" body={COMPLIANT_EARN_LINE} style={styles.note} />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={() => router.push('/referral/onboarding/disclosure-terms')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  step: { flexDirection: 'row', gap: Spacing.md },
  stepIndex: { alignItems: 'center' },
  stepIconBox: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 2, flex: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 4 },
  stepBody: { flex: 1, paddingBottom: Spacing.lg },
  stepTitle: { ...Typography.labelLg, color: Colors.onSurface },
  stepText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  note: { marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
