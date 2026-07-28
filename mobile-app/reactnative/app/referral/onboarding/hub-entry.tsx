import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Gift, ShieldCheck, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { COMPLIANT_EARN_LINE } from '@/features/referral/constants/referral.constants';

// M-ONB-01 — Referral hub entry / splash. Compliant intro to the Earn hub.
export default function HubEntry() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Gift size={34} color={Colors.onPrimary} strokeWidth={2} /></View>
          <Text style={styles.title}>Earn when friends use Paymax</Text>
          <Text style={styles.subtitle}>
            Invite people you know. When they join, verify and genuinely transact, you earn — fairly and transparently.
          </Text>
        </View>

        <View style={styles.points}>
          <Point icon={<Wallet size={18} color={Colors.secondary} strokeWidth={2} />} title="Paid to your wallet" body="Rewards land in your Spotlight wallet as they vest." />
          <Point icon={<ShieldCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />} title="KYC-backed & fair" body="One verified identity per person. No fake-account farming." />
        </View>

        <DisclosureCard tone="compliant" body={COMPLIANT_EARN_LINE} />
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Get started" onPress={() => router.push('/referral/onboarding/how-earning-works')} />
        <PrimaryButton label="Skip for now" variant="ghost" onPress={() => router.replace('/referral/(tabs)/home')} />
      </View>
    </SafeAreaView>
  );
}

function Point({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.pointTitle}>{title}</Text>
        <Text style={styles.pointBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background, justifyContent: 'space-between' },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xl, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  points: { gap: Spacing.md },
  point: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  pointIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  pointTitle: { ...Typography.labelLg, color: Colors.onSurface },
  pointBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.sm },
});
