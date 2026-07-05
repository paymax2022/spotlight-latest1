import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, Gift, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { LoyaltyColors, formatPoints } from '@/features/loyalty/constants/loyalty.constants';

// Reuses the existing Refer & Earn hub (/referral). This screen frames it from
// the loyalty angle (points earned per referral) and links straight in.
const REFERRAL_POINTS = 500;

export default function LoyaltyReferral() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Refer & earn points" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Users size={32} color={Colors.onPrimary} /></View>
          <Text style={styles.heroTitle}>Earn {formatPoints(REFERRAL_POINTS)} per friend</Text>
          <Text style={styles.heroSub}>When a friend joins Paymax with your link and completes their first transaction, you both earn points.</Text>
        </View>

        <View style={styles.steps}>
          <Step n={1} title="Share your link" desc="Send your unique referral link to friends." />
          <Step n={2} title="They join & transact" desc="Your friend signs up and makes their first payment." />
          <Step n={3} title="You earn points" desc={`${formatPoints(REFERRAL_POINTS)} land in your rewards balance.`} />
        </View>

        <View style={styles.note}>
          <Gift size={16} color={LoyaltyColors.brandText} />
          <Text style={styles.noteText}>Referral points are promotional and not cash. Redeem them in the rewards catalog.</Text>
        </View>

        <View style={{ height: Spacing.lg }} />
        <PrimaryButton label="Open referral hub" onPress={() => router.push('/referral')} />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{desc}</Text>
      </View>
      {n < 3 ? <ArrowRight size={16} color={LoyaltyColors.muted} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary, textAlign: 'center' },
  heroSub: { ...Typography.bodyMd, color: Colors.inverseOnSurface, textAlign: 'center', lineHeight: 22 },
  steps: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: LoyaltyColors.brandBg, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...Typography.labelLg, color: LoyaltyColors.brandText },
  stepTitle: { ...Typography.labelLg, color: Colors.onSurface },
  stepDesc: { ...Typography.bodySm, color: LoyaltyColors.muted, marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: LoyaltyColors.brandBg, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.bodySm, color: LoyaltyColors.brandText, flex: 1 },
});
