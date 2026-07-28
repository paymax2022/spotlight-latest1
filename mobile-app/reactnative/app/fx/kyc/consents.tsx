import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import CheckRow from '@/features/fx/components/CheckRow';
import { kycDraft } from '@/features/fx/utils/kycDraft';

export default function KycConsentsScreen() {
  const [terms, setTerms] = useState(kycDraft.current.consents.terms);
  const [privacy, setPrivacy] = useState(kycDraft.current.consents.privacy);
  const [fxDisclosure, setFx] = useState(kycDraft.current.consents.fxDisclosure);

  const allChecked = terms && privacy && fxDisclosure;

  const next = () => {
    kycDraft.current.consents = { terms, privacy, fxDisclosure };
    router.push('/fx/kyc/permissions');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consents" subtitle="Step 1 of 4" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>Please review and accept the following to continue. You can read the full documents any time in Settings → Legal.</Text>

        <View style={styles.card}>
          <CheckRow checked={terms} onToggle={() => setTerms((v) => !v)} label="I accept the Paymax Terms of Service and acknowledge the fees and charges that apply to FX, transfers and cards." />
          <View style={styles.divider} />
          <CheckRow checked={privacy} onToggle={() => setPrivacy((v) => !v)} label="I consent to the Privacy & Data Policy, including identity verification and processing of my personal data." />
          <View style={styles.divider} />
          <CheckRow checked={fxDisclosure} onToggle={() => setFx((v) => !v)} label="I understand the FX Risk Disclosure: exchange rates fluctuate, quotes are time-boxed, and a converted amount is final once executed." />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Accept & continue" onPress={next} disabled={!allChecked} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
