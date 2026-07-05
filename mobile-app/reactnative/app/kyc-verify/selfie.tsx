import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import CaptureStub from '@/features/kycverify/components/CaptureStub';
import PrivacyNote from '@/features/kycverify/components/PrivacyNote';
import {
  useSdkToken,
  useLivenessCheck,
  useFacialCheck,
} from '@/features/kycverify/hooks';
import { TIER_REQUIREMENTS } from '@/features/kycverify/constants';
import { kycVerifyDraft, markPassed } from '@/features/kycverify/draft';
import { nextStepRoute } from '@/features/kycverify/flow';
import type { KycTier, VerificationCheck } from '@/features/kycverify/types';

/**
 * K7 — Selfie / liveness capture.
 * Flow: request a server-issued SDK token → capture a selfie (STUBBED for
 * sandbox; real Smile/Youverify SDK plugs into CaptureStub) → POST /checks/
 * liveness, then POST /checks/facial when the tier requires face-match. Results
 * route to K11 (review) / K13 (failed) / next step (pass).
 *
 * No provider secret lives in the app — the SDK token comes from /sdk-token.
 */
export default function KycSelfieScreen() {
  const draft = kycVerifyDraft.current;
  const required = TIER_REQUIREMENTS[draft.targetTier as Exclude<KycTier, 0>] ?? [];
  const needsFacial = required.includes('facial');

  const sdkToken = useSdkToken();
  const liveness = useLivenessCheck();
  const facial = useFacialCheck();
  const [submitting, setSubmitting] = useState(false);

  // Fetch the capture token up-front (real SDK needs it before launching).
  useEffect(() => {
    if (!sdkToken.data && !sdkToken.isPending) sdkToken.mutate('smile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const captured = !!draft.selfieB64;

  const handleTerminal = (check: VerificationCheck): boolean => {
    if (check.status === 'PENDING' || check.status === 'REVIEW') {
      router.replace('/kyc-verify/pending');
      return true;
    }
    if (check.status === 'FAILED') {
      router.replace({ pathname: '/kyc-verify/failed', params: { reason: check.reason ?? '', check: check.type } });
      return true;
    }
    return false; // PASSED
  };

  const submit = async () => {
    if (!draft.sessionId || !draft.selfieB64) return;
    setSubmitting(true);
    try {
      // 1) Liveness (anti-spoof) — always part of Tier 2+.
      const live = await liveness.mutateAsync({ sessionId: draft.sessionId, selfieB64: draft.selfieB64 });
      if (handleTerminal(live)) return;
      markPassed('liveness');

      // 2) Face-match against the verified ID, when the tier needs it.
      if (needsFacial) {
        const face = await facial.mutateAsync({
          sessionId: draft.sessionId,
          idType: draft.idType,
          idNumber: draft.idNumber,
          selfieB64: draft.selfieB64,
        });
        if (handleTerminal(face)) return;
        markPassed('facial');
      }

      router.replace(nextStepRoute(kycVerifyDraft.current));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not submit your selfie. Please try again.';
      Alert.alert('Check failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Selfie & liveness" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Take a quick selfie</Text>
        <Text style={styles.sub}>
          Why: we match your face to your verified ID and confirm you're a real, live person (anti-spoof).
        </Text>
        <Text style={styles.how}>
          How: hold your phone at eye level, stay in a well-lit spot, and blink when prompted. Remove hats and glasses.
        </Text>

        {sdkToken.isPending ? (
          <View style={styles.tokenRow}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.tokenText}>Preparing secure capture…</Text>
          </View>
        ) : null}

        <CaptureStub
          round
          label="Tap to start liveness capture"
          hint="Face capture (sandbox)"
          captureKind="selfie"
          captured={captured}
          onCaptured={(b64) => {
            kycVerifyDraft.current.selfieB64 = b64;
          }}
        />

        <PrivacyNote>
          Your selfie is sent securely to our verification partner for liveness and face-match, and is used only for
          this check. We never post it or share it for marketing.
        </PrivacyNote>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={submitting ? 'Checking…' : 'Submit selfie'}
          onPress={submit}
          disabled={!captured || submitting || sdkToken.isPending}
          loading={submitting}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  how: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tokenText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
