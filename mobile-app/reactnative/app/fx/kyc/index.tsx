import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { User, Building2, ShieldCheck, IdCard, ScanFace, FileCheck, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { resetKycDraft } from '@/features/fx/utils/kycDraft';
import type { AccountType } from '@/features/fx/types/fx.types';

const STEPS = [
  { icon: ShieldCheck, label: 'Accept terms & data consents' },
  { icon: IdCard, label: 'Verify your identity document' },
  { icon: ScanFace, label: 'Take a quick selfie (liveness)' },
  { icon: FileCheck, label: 'Submit for review' },
];

export default function KycStartScreen() {
  const [accountType, setAccountType] = useState<AccountType>('individual');

  const begin = () => {
    resetKycDraft(accountType);
    router.push('/fx/kyc/consents');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verify your account" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={30} color={Colors.primary} strokeWidth={1.8} /></View>
          <Text style={styles.heroTitle}>Unlock FX, payouts & cards</Text>
          <Text style={styles.heroSub}>Verification keeps your money safe and is required before you can convert, send or hold balances. It takes about 3 minutes.</Text>
        </View>

        <Text style={styles.label}>I'm opening this account as a</Text>
        <View style={styles.typeRow}>
          <TypeCard icon={<User size={22} color={accountType === 'individual' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />} label="Individual" selected={accountType === 'individual'} onPress={() => setAccountType('individual')} />
          <TypeCard icon={<Building2 size={22} color={accountType === 'business' ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />} label="Business" selected={accountType === 'business'} onPress={() => setAccountType('business')} />
        </View>

        <Text style={[styles.label, styles.stepsLabel]}>What you'll do</Text>
        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepIcon}><s.icon size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <Text style={styles.stepText}>{s.label}</Text>
            </View>
          ))}
          {accountType === 'business' ? (
            <View style={styles.step}>
              <View style={styles.stepIcon}><Building2 size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <Text style={styles.stepText}>Add business details, directors & documents</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Start verification" onPress={begin} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function TypeCard({ icon, label, selected, onPress }: { icon: React.ReactNode; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.typeCard, selected && styles.typeCardOn]} accessibilityRole="button" accessibilityState={{ selected }}>
      <View style={styles.typeIcon}>{icon}</View>
      <Text style={[styles.typeLabel, selected && styles.typeLabelOn]}>{label}</Text>
      {selected ? <View style={styles.typeCheck}><Check size={12} color={Colors.onPrimary} strokeWidth={3} /></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  typeRow: { flexDirection: 'row', gap: Spacing.md },
  typeCard: { flex: 1, alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg },
  typeCardOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  typeIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  typeLabelOn: { color: Colors.primary },
  typeCheck: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepsLabel: {},
  steps: { gap: Spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  stepIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  stepText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
