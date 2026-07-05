import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import CheckRow from '@/features/fx/components/CheckRow';
import { useCreateSession, usePostConsent } from '@/features/kycverify/hooks';
import { CONSENT_VERSION } from '@/features/kycverify/constants';
import { kycVerifyDraft } from '@/features/kycverify/draft';
import type { KycTier } from '@/features/kycverify/types';

/**
 * K3 — Consent. Explicit NDPA/CBN consent BEFORE any check runs. This screen:
 *   1. creates the verification session (POST /session)
 *   2. records data-processing consent (POST /consent) — the hard gate
 * Only on success do we persist the session id to the draft and allow the flow
 * to advance to identity checks. Without consent, no check screen is reachable.
 */
export default function KycConsentScreen() {
  const params = useLocalSearchParams<{ target?: string }>();
  const target = (Number(params.target ?? kycVerifyDraft.current.targetTier) || 1) as KycTier;

  const [dataConsent, setDataConsent] = useState(false);
  const [bioConsent, setBioConsent] = useState(false);

  const createSession = useCreateSession();
  const postConsent = usePostConsent();

  // Tier 1 is data-only; Tier 2+ additionally needs biometric consent.
  const needsBio = target >= 2;
  const ready = dataConsent && (!needsBio || bioConsent);
  const busy = createSession.isPending || postConsent.isPending;

  const proceed = async () => {
    try {
      // 1) Ensure a session exists for this target tier (save-as-you-go).
      let sessionId = kycVerifyDraft.current.sessionId;
      if (!sessionId || kycVerifyDraft.current.targetTier !== target) {
        const session = await createSession.mutateAsync(target);
        sessionId = session.id;
        kycVerifyDraft.current.sessionId = session.id;
        kycVerifyDraft.current.targetTier = target;
      }

      // 2) Record consent — MUST precede any check.
      await postConsent.mutateAsync({ scope: 'kyc-data-processing', version: CONSENT_VERSION });
      if (needsBio) {
        await postConsent.mutateAsync({ scope: 'kyc-biometric', version: CONSENT_VERSION });
      }
      kycVerifyDraft.current.consentGiven = true;

      router.push('/kyc-verify/id-type');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not record your consent. Please try again.';
      Alert.alert('Consent failed', message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consent" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={28} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>Your consent to verify</Text>
          <Text style={styles.heroSub}>
            We're required by the CBN and NDPA to confirm your identity before raising your limits. We only collect
            what this tier needs, and we never sell your data.
          </Text>
        </View>

        <View style={styles.card}>
          <CheckRow
            checked={dataConsent}
            onToggle={() => setDataConsent((v) => !v)}
            label={
              'I consent to Paymax and its verification partners processing my personal data (name, ID number, date of birth) to confirm my identity, in line with the Nigeria Data Protection Act (NDPA) and CBN KYC rules.'
            }
          />
          {needsBio ? (
            <>
              <View style={styles.divider} />
              <CheckRow
                checked={bioConsent}
                onToggle={() => setBioConsent((v) => !v)}
                label={
                  'I consent to the capture and processing of my facial image (selfie) for liveness and face-match checks. My biometric data is used only for verification and is retained per the retention policy.'
                }
              />
            </>
          ) : null}
        </View>

        <Text style={styles.legal}>Consent version {CONSENT_VERSION}. You can withdraw consent in Settings → Legal.</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Agree & continue" onPress={proceed} disabled={!ready || busy} loading={busy} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  legal: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
