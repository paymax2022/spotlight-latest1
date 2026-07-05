import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, LockOpen, Repeat, ArrowUpFromLine, TrendingUp, Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useVault, useFundVault } from '@/features/savings/hooks';
import { SavingsColors, formatNaira, NO_YIELD_DISCLOSURE } from '@/features/savings/constants/savings.constants';

export default function VaultDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vaultId = String(id);
  const vault = useVault(vaultId);
  const fund = useFundVault(vaultId);
  const pay = usePurchasePayment();
  const [topUp, setTopUp] = useState('');

  if (vault.isLoading) return <Loading />;
  if (vault.isError || !vault.data) return <ErrorState onRetry={() => vault.refetch()} />;

  const v = vault.data;
  const pct = v.targetKobo ? Math.min(100, Math.round((v.balanceKobo / v.targetKobo) * 100)) : null;
  const topUpKobo = topUp ? Math.round(parseFloat(topUp) * 100) : 0;
  const locked = v.status === 'LOCKED';

  const startTopUp = () => {
    if (topUpKobo <= 0) return;
    pay.start({
      amountKobo: topUpKobo,
      title: `Add to ${v.name}`,
      charge: () => fund.mutateAsync(topUpKobo),
      onPaid: () => setTopUp(''),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={v.name} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Vault balance</Text>
          <Text style={styles.heroAmount}>{formatNaira(v.balanceKobo)}</Text>
          {pct !== null ? (
            <>
              <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
              <Text style={styles.heroSub}>{pct}% of {formatNaira(v.targetKobo)}</Text>
            </>
          ) : null}
        </View>

        <View style={styles.metaGrid}>
          <Meta Icon={locked ? Lock : LockOpen} label="Type" value={v.status === 'FLEX' ? 'Flexible' : v.status === 'LOCKED' ? 'Locked' : v.status === 'MATURED' ? 'Matured' : 'Open'} />
          <Meta Icon={TrendingUp} label="Streak" value={`${v.streak} saves`} />
          {v.maturesAtISO ? <Meta Icon={Calendar} label="Matures" value={new Date(v.maturesAtISO).toLocaleDateString()} /> : null}
        </View>

        {/* Top up */}
        {v.status !== 'CLOSED' && v.status !== 'MATURED' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add money</Text>
            <TextInputField placeholder="Amount" keyboardType="numeric" value={topUp} onChangeText={setTopUp} />
            <PrimaryButton label="Add to vault" onPress={startTopUp} disabled={topUpKobo <= 0} loading={fund.isPending} />
          </View>
        ) : null}

        {/* Auto-save summary */}
        <Pressable onPress={() => router.push({ pathname: '/savings/vault/auto-save', params: { id: vaultId } })} style={styles.rowCard}>
          <View style={styles.rowIcon}><Repeat size={18} color={SavingsColors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Auto-save</Text>
            <Text style={styles.rowSub}>
              {v.autoSave?.enabled
                ? `${formatNaira(v.autoSave.amountKobo)} ${v.autoSave.frequency}`
                : 'Not set up — save automatically'}
            </Text>
          </View>
          <Text style={styles.rowAction}>{v.autoSave?.enabled ? 'Edit' : 'Set up'}</Text>
        </Pressable>

        <DisclosureBanner text={NO_YIELD_DISCLOSURE} />

        {/* Withdraw */}
        {v.status === 'MATURED' ? (
          <PrimaryButton label="Withdraw to wallet" onPress={() => router.push({ pathname: '/savings/vault/early-withdraw', params: { id: vaultId, matured: '1' } })} />
        ) : v.status !== 'CLOSED' ? (
          <Pressable onPress={() => router.push({ pathname: '/savings/vault/early-withdraw', params: { id: vaultId } })} style={styles.withdrawBtn}>
            <ArrowUpFromLine size={18} color={SavingsColors.danger} />
            <Text style={styles.withdrawText}>{locked ? 'Break vault early' : 'Withdraw funds'}</Text>
          </Pressable>
        ) : null}

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function Meta({ Icon, label, value }: { Icon: typeof Lock; label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Icon size={16} color={SavingsColors.muted} />
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

const Loading = () => (
  <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Vault" /><StateView kind="loading" message="Loading vault…" /></SafeAreaView>
);
const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Vault" /><StateView kind="error" title="Couldn't load vault" actionLabel="Retry" onAction={onRetry} /></SafeAreaView>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  heroAmount: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginTop: Spacing.xs },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.onPrimary },
  metaGrid: { flexDirection: 'row', gap: Spacing.sm },
  meta: { flex: 1, gap: 4, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: SavingsColors.surface, ...shadow1 },
  metaValue: { ...Typography.titleMd, color: Colors.onSurface },
  metaLabel: { ...Typography.labelSm, color: SavingsColors.muted },
  card: { backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: SavingsColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: SavingsColors.muted },
  rowAction: { ...Typography.labelMd, color: SavingsColors.accent },
  withdrawBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: SavingsColors.dangerBg },
  withdrawText: { ...Typography.labelLg, color: SavingsColors.danger },
});
