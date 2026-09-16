import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDownLeft, CheckCircle2, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEvent, useEventWallet, useCloseEventWallet } from '@/features/events/hooks';
import { EventColors, formatNaira, RESIDUAL_REFUND_DISCLOSURE } from '@/features/events/constants/events.constants';

export default function WithdrawResidual() {
  const params = useLocalSearchParams<{ eventId: string; walletId: string }>();
  const eventId = params.eventId ?? 'e_live';
  const walletId = params.walletId ?? '';
  const { data: event } = useEvent(eventId);
  const { data: wallet, isLoading, isError, refetch } = useEventWallet(walletId);
  const closeWallet = useCloseEventWallet(walletId);
  const [refunded, setRefunded] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doWithdraw = async () => {
    setErr(null);
    try {
      const res = await closeWallet.mutateAsync();
      setRefunded(res.refundedKobo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Withdrawal failed.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Withdraw residual" subtitle={event?.title} />
      {isLoading ? (
        <StateView kind="loading" message="Loading wallet…" />
      ) : isError || !wallet ? (
        <StateView kind="error" title="Couldn't load wallet" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : refunded != null ? (
        <View style={styles.successWrap}>
          <CheckCircle2 size={64} color={EventColors.ok} />
          <Text style={styles.successTitle}>Refunded {formatNaira(refunded)}</Text>
          <Text style={styles.successSub}>Your unspent event-wallet balance has been moved to your main Paymax wallet.</Text>
          <PrimaryButton label="Back to event wallet" onPress={() => router.replace({ pathname: '/events/wallet/top-up', params: { eventId } })} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.residualLabel}>Refundable residual</Text>
            <Text style={styles.residualValue}>{formatNaira(wallet.balance_kobo)}</Text>
            <View style={styles.flowRow}>
              <View style={styles.flowNode}><Text style={styles.flowEmoji}>🎟️</Text><Text style={styles.flowText}>Event wallet</Text></View>
              <ArrowDownLeft size={20} color={EventColors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
              <View style={styles.flowNode}><Wallet size={22} color={EventColors.brand} /><Text style={styles.flowText}>Main wallet</Text></View>
            </View>
          </View>

          <View style={styles.disclosure}>
            <Text style={styles.disclosureText}>{RESIDUAL_REFUND_DISCLOSURE}</Text>
          </View>

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <PrimaryButton
            label={wallet.balance_kobo > 0 ? `Refund ${formatNaira(wallet.balance_kobo)} to main wallet` : 'Nothing to withdraw'}
            disabled={wallet.balance_kobo <= 0}
            loading={closeWallet.isPending}
            onPress={doWithdraw}
            style={{ marginTop: Spacing.md }}
          />
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, ...shadow1 },
  residualLabel: { ...Typography.labelMd, color: EventColors.muted },
  residualValue: { ...Typography.displayLg, color: EventColors.brand, fontSize: 38, letterSpacing: -0.76, lineHeight: 44 },
  flowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: Spacing.sm },
  flowNode: { alignItems: 'center', gap: 4 },
  flowEmoji: { fontSize: 22 },
  flowText: { ...Typography.labelSm, color: Colors.onSurface },
  disclosure: { backgroundColor: EventColors.warnBg, borderRadius: Radius.md, padding: Spacing.md },
  disclosureText: { ...Typography.bodySm, color: EventColors.warnText },
  err: { ...Typography.bodySm, color: EventColors.danger },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: EventColors.muted, textAlign: 'center', marginBottom: Spacing.md },
});
