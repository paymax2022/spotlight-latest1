import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowDownUp, BellPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/components/SegmentedControl';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import CurrencyPickerSheet from '@/features/fx/components/CurrencyPickerSheet';
import { useBalances } from '@/features/fx/hooks/useFx';
import { buildQuote, formatMoney, formatRate, parseToMinor, minorToInput } from '@/features/fx/utils/fxFormatters';
import { sanitizeMoneyInput } from '@/utils/money';
import { SUGGESTED_AMOUNTS, WALLET_CURRENCIES } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

type Side = 'source' | 'destination';

export default function ConvertScreen() {
  const balances = useBalances();
  const [from, setFrom] = useState<CurrencyCode>('USD');
  const [to, setTo] = useState<CurrencyCode>('NGN');
  const [amountType, setAmountType] = useState<Side>('source');
  const [input, setInput] = useState('');
  const [picker, setPicker] = useState<null | Side>(null);

  const editingCurrency = amountType === 'source' ? from : to;
  const amount = parseToMinor(input, editingCurrency);

  const quote = useMemo(() => {
    if (!amount) return null;
    return buildQuote({ source: from, destination: to, amount, amountType, intent: 'conversion', lock: false });
  }, [from, to, amount, amountType]);

  const fromBalance = balances.data?.find((b) => b.currency === from)?.available ?? 0;
  const insufficient = quote ? quote.source.amount > fromBalance : false;
  const suggestions = SUGGESTED_AMOUNTS[editingCurrency] ?? [];

  const swap = () => {
    setFrom(to);
    setTo(from);
    setInput('');
  };

  const otherSideValue = quote
    ? (amountType === 'source' ? formatMoney(quote.destination.amount, to) : formatMoney(quote.source.amount, from))
    : formatMoney(0, amountType === 'source' ? to : from);

  const continueDisabled = !quote || amount <= 0 || insufficient;

  const onContinue = () => {
    if (!quote) return;
    router.push({
      pathname: '/fx/convert/confirm',
      params: { from, to, amount: String(amount), amountType },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Convert"
        rightSlot={
          <Pressable onPress={() => router.push('/fx/rate-alerts')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Rate alerts">
            <BellPlus size={20} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.toggleWrap}>
          <SegmentedTabs<Side>
            value={amountType}
            onChange={(v) => { setAmountType(v); setInput(''); }}
            options={[{ value: 'source', label: 'I send' }, { value: 'destination', label: 'I receive' }]}
          />
        </View>

        {/* From */}
        <View style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={styles.fieldLabel}>From</Text>
            <Text style={styles.balance}>Balance: {formatMoney(fromBalance, from)}</Text>
          </View>
          <View style={[styles.amountRow, amountType === 'source' && styles.amountActive, insufficient && styles.amountError]}>
            <CurrencyChip currency={from} onPress={() => setPicker('source')} />
            {amountType === 'source' ? (
              <TextInput
                style={styles.amountInput}
                value={input}
                onChangeText={(v) => setInput(sanitizeMoneyInput(v))}
                placeholder="0.00"
                placeholderTextColor={Colors.outline}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={13}
                autoFocus
                accessibilityLabel="Amount to convert"
              />
            ) : (
              <Text style={[styles.amountInput, styles.amountComputed]} numberOfLines={1}>
                {quote ? minorToInput(quote.source.amount, from) : '0.00'}
              </Text>
            )}
          </View>
          {insufficient ? <Text style={styles.errorText}>Insufficient {from} balance for this conversion.</Text> : null}
        </View>

        {/* Swap */}
        <View style={styles.swapWrap}>
          <View style={styles.swapLine} />
          <Pressable onPress={swap} style={styles.swapBtn} accessibilityRole="button" accessibilityLabel="Swap currencies">
            <ArrowDownUp size={18} color={Colors.onPrimary} strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* To */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>To</Text>
          <View style={[styles.amountRow, amountType === 'destination' && styles.amountActive]}>
            <CurrencyChip currency={to} onPress={() => setPicker('destination')} />
            {amountType === 'destination' ? (
              <TextInput
                style={styles.amountInput}
                value={input}
                onChangeText={(v) => setInput(sanitizeMoneyInput(v))}
                placeholder="0.00"
                placeholderTextColor={Colors.outline}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={13}
                autoFocus
                accessibilityLabel="Amount to receive"
              />
            ) : (
              <Text style={[styles.amountInput, styles.amountComputed]} numberOfLines={1}>
                {quote ? minorToInput(quote.destination.amount, to) : '0.00'}
              </Text>
            )}
          </View>
        </View>

        {/* Suggestions */}
        {suggestions.length > 0 ? (
          <View style={styles.suggestRow}>
            {suggestions.map((s) => (
              <Pressable key={s} style={styles.suggestChip} onPress={() => setInput(minorToInput(s, editingCurrency))} accessibilityRole="button">
                <Text style={styles.suggestText}>{formatMoney(s, editingCurrency, { decimals: false })}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Live rate line */}
        {quote ? (
          <View style={styles.rateLine}>
            <Text style={styles.rateText}>{formatRate(from, to, quote.allInRate)}</Text>
            <Text style={styles.rateSub}>You {amountType === 'source' ? 'get' : 'send'} {otherSideValue}</Text>
          </View>
        ) : (
          <StateView kind="empty" icon="ArrowLeftRight" title="Enter an amount" message="We'll show you a live all-in rate before you confirm." compact />
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Get quote" onPress={onContinue} disabled={continueDisabled} />
      </SafeAreaView>

      <CurrencyPickerSheet
        visible={picker !== null}
        title={picker === 'source' ? 'Convert from' : 'Convert to'}
        value={picker === 'source' ? from : to}
        options={WALLET_CURRENCIES}
        balances={balances.data}
        disabled={picker === 'source' ? [to] : [from]}
        onSelect={(c) => { if (picker === 'source') setFrom(c); else setTo(c); }}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingTop: Spacing.sm },
  toggleWrap: { marginHorizontal: -Spacing.containerMargin, marginBottom: Spacing.lg },
  field: { marginBottom: Spacing.xs },
  fieldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent,
    paddingHorizontal: Spacing.md, height: 64,
  },
  amountActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  amountError: { borderColor: Colors.error },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  amountComputed: { color: Colors.onSurfaceVariant },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  swapWrap: { alignItems: 'center', justifyContent: 'center', height: 36, marginVertical: 2 },
  swapLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.surfaceContainerHigh },
  swapBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  suggestChip: {
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  suggestText: { ...Typography.labelMd, color: Colors.onSurface },
  rateLine: {
    marginTop: Spacing.lg, alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  rateText: { ...Typography.titleMd, color: Colors.primary },
  rateSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
