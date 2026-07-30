import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, ShieldCheck, ShieldAlert, Check, ChevronRight, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import {
  useCryptoPortfolio, useAssets, useAddresses, useWithdrawalEligibility,
} from '@/features/crypto/hooks/useCrypto';
import {
  formatCrypto, formatFiatObj, parseCryptoToMinor, relativeTime,
} from '@/features/crypto/utils/cryptoFormatters';
import { WITHDRAWAL_MIN_KYC_TIER } from '@/features/crypto/constants/crypto.constants';
import { sanitizeMoneyInput } from '@/utils/money';

function maskAddress(value: string): string {
  const v = value.replace(/\s/g, '');
  return v.length <= 12 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export default function WithdrawEntryScreen() {
  const params = useLocalSearchParams<{ symbol?: string }>();
  const eligibility = useWithdrawalEligibility();
  const portfolio = useCryptoPortfolio();
  const assets = useAssets();

  const held = useMemo(
    () => (portfolio.data?.positions ?? []).filter((p) => (p.quantity.amount ?? 0) > 0),
    [portfolio.data],
  );
  const [symbol, setSymbol] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const position = held.find((p) => p.symbol === symbol) ?? held.find((p) => p.symbol === params.symbol) ?? held[0];
  const asset = assets.data?.find((a) => a.symbol === position?.symbol);
  const addresses = useAddresses(position?.symbol);

  const decimals = asset?.decimals ?? 8;
  const networks = asset?.supportedNetworks ?? [];
  const activeNetwork = networks.find((n) => n.id === networkId) ?? networks[0];
  const heldMinor = position?.quantity.amount ?? 0;
  const amount = parseCryptoToMinor(input, decimals);

  // ── Loading / gate states ──────────────────────────────────────────────────
  if (portfolio.isLoading || eligibility.isLoading || assets.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Withdraw crypto" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  const gate = eligibility.data?.gate;
  if (gate && gate !== 'eligible') {
    const copy =
      gate === 'kyc_tier_required' ? { title: `Tier ${WITHDRAWAL_MIN_KYC_TIER} verification required`, msg: 'Crypto withdrawals need full KYC. Complete verification to continue.', cta: 'Verify account', route: '/fx/kyc' as const }
      : gate === 'withdrawals_disabled' ? { title: 'Withdrawals are paused', msg: eligibility.data!.message, cta: 'Back to Crypto', route: '/crypto' as const }
      : gate === 'cooling_period' ? { title: 'Security cooling period', msg: `For your protection, withdrawals are briefly locked${eligibility.data!.coolingEndsAt ? ` until ${relativeTime(eligibility.data!.coolingEndsAt)}` : ''}.`, cta: 'Back to Crypto', route: '/crypto' as const }
      : { title: 'Withdrawals restricted', msg: eligibility.data!.message, cta: 'Back to Crypto', route: '/crypto' as const };
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Withdraw crypto" />
        <StateView kind="empty" icon="ShieldAlert" title={copy.title} message={copy.msg} actionLabel={copy.cta} onAction={() => router.replace(copy.route)} />
      </SafeAreaView>
    );
  }

  if (held.length === 0 || !position || !asset || !activeNetwork) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Withdraw crypto" />
        <StateView kind="empty" icon="Wallet" title="Nothing to withdraw" message="Buy crypto first — then you can withdraw it to an external wallet." actionLabel="Explore assets" onAction={() => router.replace('/crypto/assets')} />
      </SafeAreaView>
    );
  }

  const addrList = addresses.data ?? [];
  const selectedAddress = addrList.find((a) => a.id === addressId) ?? null;
  const overHolding = amount > heldMinor;
  const error = overHolding ? `You only hold ${formatCrypto(heldMinor, asset.symbol, decimals)}.` : null;
  const fiatValue = Math.round((amount / 10 ** decimals) * asset.price.amount);
  const disabled = !amount || !!error || !selectedAddress;

  const setMax = () => setInput((heldMinor / 10 ** decimals).toString());

  const onContinue = () => {
    if (!selectedAddress) return;
    router.push({
      pathname: '/crypto/withdraw/review',
      params: { assetId: asset.id, symbol: asset.symbol, networkId: activeNetwork.id, addressId: selectedAddress.id, amount: String(amount) },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Withdraw crypto" subtitle="To an external wallet" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Manual-review notice */}
        <View style={styles.reviewNote}>
          <Clock size={15} color={Colors.onPrimaryFixedVariant} strokeWidth={2} />
          <Text style={styles.reviewText}>Withdrawals are reviewed by compliance before broadcast, usually within 30 minutes.</Text>
        </View>

        {/* Asset chooser */}
        <Text style={styles.label}>Asset</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {held.map((p) => {
            const active = p.symbol === position.symbol;
            return (
              <Pressable key={p.assetId} onPress={() => { setSymbol(p.symbol); setNetworkId(null); setAddressId(null); setInput(''); }} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <AssetIcon symbol={p.symbol} color={p.iconColor} size={24} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.symbol}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Network chooser */}
        <Text style={[styles.label, styles.mt]}>Network</Text>
        <View style={styles.netRow}>
          {networks.map((n) => {
            const active = n.id === activeNetwork.id;
            return (
              <Pressable key={n.id} onPress={() => setNetworkId(n.id)} style={[styles.netChip, active && styles.netChipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.netText, active && styles.netTextActive]}>{n.name}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Destination address */}
        <View style={[styles.labelRow, styles.mt]}>
          <Text style={styles.label}>Destination</Text>
          <Pressable onPress={() => router.push({ pathname: '/crypto/addresses/new', params: { symbol: position.symbol } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add address">
            <View style={styles.addRow}>
              <Plus size={14} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.addText}>Add address</Text>
            </View>
          </Pressable>
        </View>

        {addresses.isLoading ? (
          <StateView kind="loading" compact />
        ) : addrList.length === 0 ? (
          <Pressable style={styles.emptyAddr} onPress={() => router.push({ pathname: '/crypto/addresses/new', params: { symbol: position.symbol } })} accessibilityRole="button">
            <ShieldAlert size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.emptyAddrText}>No whitelisted {position.symbol} address yet. Add one to withdraw.</Text>
            <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ) : (
          <View style={styles.addrList}>
            {addrList.map((a) => {
              const active = a.id === (selectedAddress?.id ?? '');
              return (
                <Pressable key={a.id} onPress={() => setAddressId(a.id)} style={[styles.addrCard, active && styles.addrCardActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                  <View style={[styles.radio, active && styles.radioActive]}>{active ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
                  <View style={styles.flex}>
                    <View style={styles.addrTitleRow}>
                      <Text style={styles.addrLabel}>{a.label}</Text>
                      {a.whitelisted ? <ShieldCheck size={13} color={Colors.teal} strokeWidth={2} /> : null}
                    </View>
                    <Text style={styles.addrValue} numberOfLines={1}>{maskAddress(a.address)} · {a.networkName}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Amount */}
        <View style={[styles.labelRow, styles.mt]}>
          <Text style={styles.label}>Amount</Text>
          <Text style={styles.balance}>Holding: {formatCrypto(heldMinor, asset.symbol, decimals)}</Text>
        </View>
        <View style={[styles.amountRow, !!error && styles.amountError]}>
          <AssetIcon symbol={asset.symbol} color={asset.iconColor} size={28} />
          <TextInput
            style={styles.amountInput}
            value={input}
            onChangeText={(v) => setInput(sanitizeMoneyInput(v))}
            placeholder="0.00"
            placeholderTextColor={Colors.outline}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={13}
            accessibilityLabel={`Amount of ${asset.symbol} to withdraw`}
          />
          <Pressable onPress={setMax} hitSlop={8} accessibilityRole="button" accessibilityLabel="Max">
            <Text style={styles.maxText}>MAX</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : <Text style={styles.fiatHint}>≈ {formatFiatObj({ amount: fiatValue, currency: 'NGN' })}</Text>}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Review withdrawal" onPress={onContinue} disabled={disabled} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  flex: { flex: 1 },
  mt: { marginTop: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  reviewNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg,
  },
  reviewText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  chipRow: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.sm + 2, paddingVertical: 6,
  },
  chipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  netRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  netChip: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  netChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  netText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  netTextActive: { color: Colors.primary },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addText: { ...Typography.labelMd, color: Colors.secondary },
  emptyAddr: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  emptyAddrText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  addrList: { gap: Spacing.sm },
  addrCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  addrCardActive: { borderColor: Colors.secondary },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  addrTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addrLabel: { ...Typography.labelLg, color: Colors.onSurface },
  addrValue: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.md, height: 64,
  },
  amountError: { borderColor: Colors.error },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  maxText: { ...Typography.labelMd, color: Colors.secondary },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  fiatHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, textAlign: 'right' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
