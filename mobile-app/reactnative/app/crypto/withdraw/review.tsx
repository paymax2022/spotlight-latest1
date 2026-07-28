import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowUpFromLine, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import VolatilityWarning from '@/features/crypto/components/VolatilityWarning';
import { useAddresses, useAssets, useQuoteWithdrawal } from '@/features/crypto/hooks/useCrypto';
import { formatCrypto, formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';
import { WITHDRAWAL_DISCLOSURE, MANUAL_REVIEW_NOTE } from '@/features/crypto/constants/crypto.constants';

function maskAddress(value: string): string {
  const v = value.replace(/\s/g, '');
  return v.length <= 16 ? v : `${v.slice(0, 10)}…${v.slice(-6)}`;
}

export default function WithdrawReviewScreen() {
  const p = useLocalSearchParams<{ assetId: string; symbol: string; networkId: string; addressId: string; amount: string }>();
  const assets = useAssets();
  const addresses = useAddresses(p.symbol);
  const quoteM = useQuoteWithdrawal();
  const fired = useRef(false);

  const asset = assets.data?.find((a) => a.id === p.assetId);
  const address = (addresses.data ?? []).find((a) => a.id === p.addressId);

  useEffect(() => {
    if (fired.current || !asset) return;
    fired.current = true;
    quoteM.mutate({ assetId: p.assetId, symbol: p.symbol, networkId: p.networkId, addressId: p.addressId, amount: Number(p.amount) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  const quote = quoteM.data;

  if (assets.isLoading || !asset || quoteM.isPending || !quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review withdrawal" />
        <StateView kind="loading" message="Estimating network fee…" />
      </SafeAreaView>
    );
  }
  if (quoteM.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review withdrawal" />
        <StateView kind="error" title="Couldn't prepare withdrawal" message="Please go back and try again." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const decimals = asset.decimals;

  const toOtp = () => {
    router.push({
      pathname: '/crypto/withdraw/otp',
      params: { assetId: p.assetId, symbol: p.symbol, networkId: p.networkId, addressId: p.addressId, amount: p.amount },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review withdrawal" subtitle={`Send ${asset.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <AssetIcon symbol={asset.symbol} color={asset.iconColor} size={48} />
          </View>
          <Text style={styles.heroLabel}>You're withdrawing</Text>
          <Text style={styles.heroAmount}>{formatCrypto(quote.amount.amount, asset.symbol, decimals)}</Text>
          <Text style={styles.heroFiat}>≈ {formatFiatObj(quote.fiatValue)}</Text>
        </View>

        {/* Destination */}
        <View style={styles.card}>
          <Row label="To" value={address?.label ?? 'Address'} />
          <Row label="Address" value={maskAddress(address?.address ?? '')} mono />
          <Row label="Network" value={quote.networkName} />
        </View>

        {/* Fee breakdown */}
        <View style={styles.card}>
          <Row label="Amount" value={formatCrypto(quote.amount.amount, asset.symbol, decimals)} />
          <Row label="Network fee" value={formatCrypto(quote.networkFee.amount, asset.symbol, decimals)} muted />
          <Row label="Processing fee" value={formatFiatObj(quote.paymaxFee)} muted />
          <View style={styles.divider} />
          <Row label="Recipient gets" value={formatCrypto(quote.receiveAmount.amount, asset.symbol, decimals)} emphasis />
        </View>

        {/* Irreversibility warning */}
        <VolatilityWarning message={WITHDRAWAL_DISCLOSURE} />

        {/* Manual-review note */}
        <View style={styles.note}>
          <Info size={14} color={Colors.onPrimaryFixedVariant} strokeWidth={2} />
          <Text style={styles.noteText}>{MANUAL_REVIEW_NOTE}</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue" onPress={toOtp} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ label, value, emphasis, muted, mono }: { label: string; value: string; emphasis?: boolean; muted?: boolean; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowEmphasis, muted && styles.rowMutedValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg, gap: 4,
  },
  heroIcon: { marginBottom: Spacing.xs },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  heroFiat: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 0 },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  rowEmphasis: { color: Colors.primary },
  rowMuted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowMutedValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  mono: { ...Typography.labelMd },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
