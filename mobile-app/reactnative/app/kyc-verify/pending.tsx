import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock, BellRing } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useKycSession } from '@/features/kycverify/hooks';
import { isSessionSettled } from '@/features/kycverify/api';
import { kycVerifyDraft } from '@/features/kycverify/draft';

/**
 * K11 — Submitted / pending review. Shown when a check goes async
 * (PENDING/REVIEW). Polls GET /session/{id}; the result also arrives by push, so
 * this screen resolves to K12 (verified/approved) or K13 (failed/rejected) as
 * soon as the session settles.
 */
export default function KycPendingScreen() {
  const sessionId = kycVerifyDraft.current.sessionId;
  const { data } = useKycSession(sessionId, 5_000);

  useEffect(() => {
    if (!data) return;
    if (data.status === 'TIER_VERIFIED' || data.status === 'APPROVED') {
      router.replace('/kyc-verify/success');
    } else if (data.status === 'TIER_FAILED' || data.status === 'REJECTED') {
      router.replace({ pathname: '/kyc-verify/failed', params: { reason: '' } });
    }
  }, [data]);

  const settled = data ? isSessionSettled(data.status) : false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        <View style={styles.ring}>
          {settled ? <BellRing size={56} color={Colors.secondary} strokeWidth={1.8} /> : <Clock size={56} color={Colors.onPrimaryFixedVariant} strokeWidth={1.8} />}
        </View>
        <Text style={styles.title}>We're reviewing your details</Text>
        <Text style={styles.sub}>
          One of your checks needs a closer look. This usually finishes within a few minutes, but can take up to 24
          hours. You don't need to stay here — we'll send you a notification the moment it's done.
        </Text>

        <View style={styles.pollRow}>
          <ActivityIndicator color={Colors.primary} size="small" />
          <Text style={styles.pollText}>Checking for updates…</Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Done for now" variant="secondary" onPress={() => router.replace('/kyc-verify')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  pollText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
