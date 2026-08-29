// ── AI Trading — Module KYC (Trading Access Verification) — §16A #5/#7 ─────────
// A SEPARATE, mandatory verification for trading, independent of the app's Tier
// 0-3. Submitting routes the case to an admin reviewer; access is granted only on
// approval (or an admin bypass). This screen shows the state and lets the user
// start / resubmit.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldCheck, Clock, XCircle, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useKyc, useSubmitKyc } from '@/features/aitrading/hooks';
import type { TradingKycStatus } from '@/features/aitrading/api';

export default function ModuleKycScreen() {
  const kyc = useKyc();
  const submit = useSubmitKyc();
  const status = kyc.data?.status ?? 'NOT_STARTED';
  const canSubmit = status === 'NOT_STARTED' || status === 'REJECTED' || status === 'EXPIRED';
  const pending = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  const approved = status === 'APPROVED' || status === 'BYPASSED';

  async function onSubmit() {
    try {
      await submit.mutateAsync();
      Alert.alert('Submitted for review', 'Your Trading Access Verification is under review. We’ll notify you when it’s decided.');
    } catch (e) {
      Alert.alert('Could not submit', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/ai-trading')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.topTitle}>Trading Verification</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconWrap}><ShieldCheck size={30} color={Colors.primary} /></View>
        <Text style={styles.h1}>A separate check for trading</Text>
        <Text style={styles.sub}>Trading requires its own verification — <Text style={{ fontWeight: '700' }}>independent of your app verification level</Text>. Being verified elsewhere in the app does not grant trading access, and clearing this does not change your app tier.</Text>

        <View style={styles.statusCard}>
          <StatusIcon status={status} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>Current status</Text>
            <Text style={styles.statusValue}>{humanStatus(status)}</Text>
            {kyc.data?.bypassExpiresAt ? <Text style={styles.statusHint}>Manual approval expires {new Date(kyc.data.bypassExpiresAt).toLocaleDateString('en-NG')}.</Text> : null}
          </View>
        </View>

        <Text style={styles.stepsTitle}>What you'll provide</Text>
        <Step n={1} t="Identity" d="A government ID and a quick selfie to confirm it's you." />
        <Step n={2} t="Eligibility" d="A few questions on experience, risk tolerance, and source of funds." />
        <Step n={3} t="Review" d="Our team reviews and approves — typically within a business day." />

        <View style={{ height: Spacing.md }} />
        {approved ? (
          <PrimaryButton label="Continue to AI Trading" onPress={() => router.replace('/ai-trading' as never)} />
        ) : pending ? (
          <View style={styles.pendingBox}><Clock size={16} color={Colors.primary} /><Text style={styles.pendingText}>Under review — nothing more to do right now.</Text></View>
        ) : (
          <PrimaryButton label={status === 'REJECTED' ? 'Resubmit for review' : 'Start verification'} onPress={onSubmit} loading={submit.isPending} />
        )}
        <Text style={styles.finePrint}>By continuing you agree to the trading risk disclosures and discretionary-management terms. You can lose deposited capital.</Text>
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function humanStatus(s: TradingKycStatus): string {
  return { NOT_STARTED: 'Not started', SUBMITTED: 'Submitted — under review', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', REJECTED: 'Rejected — you may resubmit', BYPASSED: 'Approved (manual)', EXPIRED: 'Expired — re-verify' }[s];
}
function StatusIcon({ status }: { status: TradingKycStatus }) {
  if (status === 'APPROVED' || status === 'BYPASSED') return <CheckCircle2 size={22} color={Colors.teal} />;
  if (status === 'REJECTED' || status === 'EXPIRED') return <XCircle size={22} color={Colors.error} />;
  if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return <Clock size={22} color={Colors.primary} />;
  return <ShieldCheck size={22} color={Colors.onSurfaceVariant} />;
}
function Step({ n, t, d }: { n: number; t: string; d: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.stepT}>{t}</Text><Text style={styles.stepD}>{d}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  topTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  body: { padding: Spacing.lg, gap: Spacing.sm },
  iconWrap: { alignSelf: 'flex-start', marginBottom: 4 },
  h1: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  statusCard: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, marginVertical: Spacing.sm },
  statusLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statusValue: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' },
  statusHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  stepsTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', marginTop: Spacing.sm },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 8 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F3F0FF', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '800' },
  stepT: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' },
  stepD: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pendingBox: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F0FF', borderRadius: Radius.lg, padding: Spacing.md },
  pendingText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '600' },
  finePrint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 10 },
});
