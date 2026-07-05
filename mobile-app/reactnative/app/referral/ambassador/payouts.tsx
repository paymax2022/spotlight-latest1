import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useAmbassadorPayouts, useWithdrawAmbassadorPayout } from '@/features/referral/ambassador/hooks';

// M-AMB-05 — Ambassador payouts: higher-tier earnings + withdraw.
export default function AmbassadorPayoutsScreen() {
  const { data, isLoading, isError, refetch } = useAmbassadorPayouts();
  const withdraw = useWithdrawAmbassadorPayout();
  const [done, setDone] = useState<string | null>(null);

  const onWithdraw = () => {
    if (!data) return;
    withdraw.mutate(data.eligibleKobo, {
      onSuccess: (res) => {
        if (res.ok) {
          setDone(res.reference);
        } else {
          const msg = res.error === 'below_min' ? 'Amount is below the minimum.' : res.error === 'insufficient' ? 'Not enough eligible balance.' : 'Withdrawal failed.';
          Alert.alert('Withdraw failed', msg);
        }
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ambassador payouts" />
      {isLoading ? (
        <StateView kind="loading" message="Loading payouts…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.balanceCard}>
            <View style={styles.balanceIcon}><Wallet size={20} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.balanceLabel}>Ready to withdraw</Text>
            <Text style={styles.balanceValue}>{formatNaira(data.eligibleKobo)}</Text>
            <View style={styles.split}>
              <View style={styles.col}><Text style={styles.colLabel}>Pending</Text><Text style={styles.colValue}>{formatNaira(data.pendingKobo)}</Text></View>
              <View style={styles.divider} />
              <View style={styles.col}><Text style={styles.colLabel}>Vesting</Text><Text style={styles.colValue}>{formatNaira(data.vestingKobo)}</Text></View>
            </View>
          </View>

          {done ? (
            <DisclosureCard tone="compliant" title="Withdrawal sent" body={`Your payout is on its way to your wallet. Reference ${done}.`} />
          ) : (
            <PrimaryButton
              label={`Withdraw ${formatNaira(data.eligibleKobo)} to wallet`}
              onPress={onWithdraw}
              loading={withdraw.isPending}
              disabled={data.eligibleKobo < data.minWithdrawKobo}
            />
          )}
          <Text style={styles.minNote}>Minimum withdrawal {formatNaira(data.minWithdrawKobo)}. Paid instantly to your Spotlight wallet.</Text>

          <Text style={styles.sectionTitle}>Payout history</Text>
          {data.history.length === 0 ? (
            <StateView kind="empty" icon="Banknote" title="No payouts yet" message="Your withdrawals appear here." compact />
          ) : (
            <View style={styles.list}>
              {data.history.map((h, i) => (
                <View key={h.id} style={[styles.row, i < data.history.length - 1 && styles.rowBorder]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowAmount}>{formatNaira(h.amountKobo)}</Text>
                    <Text style={styles.rowRef}>{h.reference}</Text>
                  </View>
                  <Text style={styles.rowTime}>{relativeTime(h.at)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  balanceCard: { alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  balanceIcon: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  balanceLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  balanceValue: { ...Typography.displayLg, color: Colors.onSurface, fontWeight: '800' as const },
  split: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, alignSelf: 'stretch' },
  col: { flex: 1, alignItems: 'center' },
  colLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  colValue: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { width: 1, height: 28, backgroundColor: Colors.surfaceContainerHigh },
  minNote: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowBody: { gap: 2 },
  rowAmount: { ...Typography.labelLg, color: Colors.onSurface },
  rowRef: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
