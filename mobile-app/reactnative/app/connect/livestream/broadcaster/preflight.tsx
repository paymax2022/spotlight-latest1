import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, Video, Mic, Radio, Lock, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useBroadcastPreflight } from '@/features/connect/live/hooks';

/**
 * Go-live preflight (PRD §10.7 LB-02). Tier 2+ KYC gate + device permissions.
 * Going live & monetization are tier-gated — block below Tier 2 with upgrade CTA.
 */
export default function BroadcastPreflightScreen() {
  const q = useBroadcastPreflight();

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Go live" /><StateView kind="loading" message="Checking eligibility…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="Go live" /><StateView kind="error" title="Couldn't check eligibility" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;

  const p = q.data;
  const checks = [
    { ok: p.canGoLive, icon: ShieldCheck, label: `Verified ${p.tierLabel}`, sub: p.canGoLive ? 'Eligible to go live and earn' : 'Tier 2+ required to go live and earn' },
    { ok: p.cameraGranted, icon: Video, label: 'Camera access', sub: p.cameraGranted ? 'Granted' : 'Enable camera in settings' },
    { ok: p.micGranted, icon: Mic, label: 'Microphone access', sub: p.micGranted ? 'Granted' : 'Enable microphone in settings' },
    { ok: p.networkOk, icon: Radio, label: 'Network', sub: p.networkOk ? 'Connection looks good' : 'Weak connection — try Wi-Fi' },
  ];
  const allReady = p.canGoLive && p.cameraGranted && p.micGranted && p.networkOk;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Go live" subtitle="Pre-flight checks" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {checks.map((c) => (
          <View key={c.label} style={styles.checkRow}>
            <View style={[styles.checkIcon, c.ok ? styles.checkIconOk : styles.checkIconWarn]}>
              <c.icon size={18} color={c.ok ? ConnectColors.ok : Colors.onWarning} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkLabel}>{c.label}</Text>
              <Text style={styles.checkSub}>{c.sub}</Text>
            </View>
            {c.ok ? <CircleCheck size={20} color={ConnectColors.ok} strokeWidth={2} /> : <Lock size={18} color={Colors.onWarning} strokeWidth={2} />}
          </View>
        ))}

        {!p.canGoLive ? (
          <View style={styles.gateBox}>
            <Text style={styles.gateTitle}>Tier 2 required to go live</Text>
            <Text style={styles.gateBody}>Creators must complete Tier 2 verification (BVN + NIN + photo ID + proof of address) before they can broadcast and earn gift revenue.</Text>
          </View>
        ) : (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>Your stream is moderated. Earnings from gifts and paid votes land in your wallet in real Naira. Payouts follow your tier limits.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {p.canGoLive ? (
          <PrimaryButton label="Continue to setup" onPress={() => router.push('/connect/livestream/broadcaster/setup')} disabled={!allReady} />
        ) : (
          <PrimaryButton label="Upgrade to Tier 2" variant="secondary" onPress={() => router.push('/connect/me' as never)} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  checkIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  checkIconOk: { backgroundColor: ConnectColors.okBg },
  checkIconWarn: { backgroundColor: Colors.iconBgGold },
  checkLabel: { ...Typography.labelLg, color: Colors.onSurface },
  checkSub: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 1 },
  gateBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  gateTitle: { ...Typography.labelLg, color: Colors.error, fontWeight: '700' as const },
  gateBody: { ...Typography.bodySm, color: Colors.error, marginTop: 4 },
  infoBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  infoText: { ...Typography.caption, color: Colors.onSurfaceVariant, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border },
});
