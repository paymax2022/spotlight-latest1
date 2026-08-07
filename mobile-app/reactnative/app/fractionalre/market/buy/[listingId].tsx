import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { alertAsync } from '@/lib/confirm';
import { Lock, AlertTriangle, CheckCircle2, ShieldX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMarket, useLimitCheck, useBuyListing } from '@/features/fractionalre/hooks';
import { formatNaira, makeIdempotencyKey } from '@/features/fractionalre/utils';
import MarketListingRow from '@/features/fractionalre/components/MarketListingRow';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

export default function BuyListingScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const market = useMarket();
  const limitCheck = useLimitCheck();
  const buy = useBuyListing();
  const checkout = usePurchasePayment();

  const listing = (market.data ?? []).find((l) => l.id === listingId);
  const [units, setUnits] = useState('');
  const [pin, setPin] = useState('');

  const unitsNum = parseInt(units || '0', 10);
  const overUnits = listing ? unitsNum > listing.units : false;
  const amountKobo = listing ? unitsNum * listing.pricePerUnitKobo : 0;
  const lc = limitCheck.data;
  const blocked = lc?.status === 'block';
  const pinValid = /^\d{4,6}$/.test(pin);

  useEffect(() => {
    if (!listing || unitsNum <= 0 || overUnits) return;
    const t = setTimeout(() => limitCheck.mutate({ offeringId: listing.offeringId, amountKobo }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountKobo, overUnits]);

  const canBuy = !!listing && unitsNum > 0 && !overUnits && !blocked && lc != null && pinValid && !buy.isPending;

  const onBuy = () => {
    if (!listing) return;
    checkout.start({
      amountKobo,
      title: `Buy ${unitsNum} unit${unitsNum === 1 ? '' : 's'}`,
      charge: () => buy.mutateAsync({
        listingId: listing.id,
        req: { units: unitsNum, pin, idempotencyKey: makeIdempotencyKey('fre-mktbuy') },
      }),
      onPaid: () => {
        alertAsync({ title: 'Purchase complete', message: 'The units have been transferred to your portfolio.', buttonLabel: 'View orders' })
          .then(() => router.replace('/fractionalre/market/orders'));
      },
    });
  };

  if (market.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Buy fraction" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (!listing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Buy fraction" />
        <StateView kind="error" title="Listing unavailable" message="This listing may have been filled or withdrawn." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Buy fraction" subtitle={listing.offeringTitle} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <MarketListingRow listing={listing} />

        <Text style={styles.label}>Units to buy (max {listing.units})</Text>
        <TextInput value={units} onChangeText={(t) => setUnits(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor={Colors.onSurfaceVariant} />
        {overUnits ? <Text style={styles.warn}>Only {listing.units} units are available.</Text> : null}

        {/* Limit-check */}
        {unitsNum > 0 && !overUnits ? (
          <View style={[styles.limitRow, blocked && styles.limitBlock, lc?.status === 'warn' && styles.limitWarn, lc?.status === 'pass' && styles.limitPass]}>
            {limitCheck.isPending ? (
              <><ActivityIndicator size="small" color={Colors.secondary} /><Text style={styles.limitText}>Checking limit…</Text></>
            ) : lc ? (
              <>
                {blocked ? <ShieldX size={18} color={Colors.error} strokeWidth={2} />
                  : lc.status === 'warn' ? <AlertTriangle size={18} color={Colors.onWarning} strokeWidth={2} />
                  : <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />}
                <Text style={styles.limitText}>{lc.message ?? `Remaining allowance: ${formatNaira(lc.remainingKobo)}`}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.summary}>
          <View style={styles.row}><Text style={styles.rowLabel}>{unitsNum} units</Text><Text style={styles.rowVal}>{formatNaira(amountKobo)}</Text></View>
          <Text style={styles.feeNote}>Final fees are confirmed by the server at execution.</Text>
        </View>

        <View style={styles.pinBlock}>
          <View style={styles.pinHeader}>
            <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.pinLabel}>Enter your PIN to pay</Text>
          </View>
          <TextInput value={pin} onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} style={styles.pinInput} placeholder="••••" placeholderTextColor={Colors.onSurfaceVariant} />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Buy fraction" onPress={onBuy} disabled={!canBuy} loading={buy.isPending} />
      </SafeAreaView>
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  input: { ...Typography.titleMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  warn: { ...Typography.labelSm, color: Colors.error },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow },
  limitPass: { backgroundColor: Colors.iconBgTeal },
  limitWarn: { backgroundColor: Colors.iconBgGold },
  limitBlock: { backgroundColor: Colors.errorContainer },
  limitText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 6, borderWidth: 1, borderColor: Colors.outlineVariant },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowVal: { ...Typography.labelLg, color: Colors.onSurface },
  feeNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pinBlock: { gap: Spacing.sm },
  pinHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  pinInput: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', letterSpacing: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
