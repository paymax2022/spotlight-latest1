import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleX, LifeBuoy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import type { CheckType } from '@/features/kycverify/types';

const SUPPORT_EMAIL = 'support@paymax.ng';

// Which screen to send the user back to for a given failed check (retry).
const RETRY_ROUTE: Record<CheckType, string> = {
  'id-number': '/kyc-verify/id-number',
  liveness: '/kyc-verify/selfie',
  facial: '/kyc-verify/selfie',
  document: '/kyc-verify/document',
  aml: '/kyc-verify/address',
};

// Plain-language fallback reasons, keyed by check, when the server sends none.
const DEFAULT_REASON: Record<string, string> = {
  'id-number': "We couldn't match the details you entered to your ID. Check the number, name and date of birth and try again.",
  liveness: "The liveness check didn't pass. Make sure you're in good light, hold still and follow the prompts.",
  facial: "Your selfie didn't match your ID photo closely enough. Try again with a clear, front-facing photo.",
  document: "We couldn't read or verify your document. Retake the photos with all corners in frame and no glare.",
  aml: "We couldn't complete the screening automatically. Our team can review this manually.",
  '': "We couldn't verify some of your details. You can try again, or ask us to review it manually.",
};

/**
 * K13 — Failed, retry. Never a dead end: a plain reason + a retry that returns
 * to the exact failed step + a manual-review path + contact support.
 */
export default function KycFailedScreen() {
  const params = useLocalSearchParams<{ reason?: string; check?: string }>();
  const check = (params.check as CheckType | undefined) ?? undefined;
  const reason = params.reason && params.reason.length > 0
    ? params.reason
    : DEFAULT_REASON[params.check ?? ''] ?? DEFAULT_REASON[''];

  const retry = () => {
    if (check && RETRY_ROUTE[check]) router.replace(RETRY_ROUTE[check]);
    else router.replace('/kyc-verify');
  };

  // Manual-review path: send to pending so compliance can pick it up (no dead end).
  const requestReview = () => router.replace('/kyc-verify/pending');

  const contactSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=KYC verification help`).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        <View style={styles.ring}><CircleX size={56} color={Colors.error} strokeWidth={1.8} /></View>
        <Text style={styles.title}>We couldn't verify that</Text>
        <Text style={styles.sub}>{reason}</Text>

        <View style={styles.helpBox}>
          <LifeBuoy size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.helpText}>
            If retrying doesn't work, request a manual review or contact support — we won't leave you stuck.
          </Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Try again" onPress={retry} />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton label="Request manual review" variant="secondary" onPress={requestReview} />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton label="Contact support" variant="ghost" onPress={contactSupport} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  helpBox: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm,
  },
  helpText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
