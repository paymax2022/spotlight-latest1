import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SegmentedTabs from '@/components/SegmentedControl';
import CardVisual from '@/features/fx/components/CardVisual';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import CurrencyPickerSheet from '@/features/fx/components/CurrencyPickerSheet';
import { useCreateCard } from '@/features/fx/hooks/useFxCards';
import { useBalances } from '@/features/fx/hooks/useFx';
import {
  CARD_BRANDS, CARD_COLOR_OPTIONS, CARD_GRADIENTS, CARD_CURRENCIES, CARD_FUND_PRESETS,
} from '@/features/fx/constants/fx.constants';
import { formatMoney, parseToMinor, minorToInput } from '@/features/fx/utils/fxFormatters';
import type { CardBrand, CardColor, CurrencyCode, Card } from '@/features/fx/types/fx.types';

export default function CreateCardScreen() {
  const create = useCreateCard();
  const balances = useBalances();

  const [label, setLabel] = useState('');
  const [brand, setBrand] = useState<CardBrand>('visa');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [color, setColor] = useState<CardColor>('purple');
  const [fundInput, setFundInput] = useState('');
  const [picker, setPicker] = useState(false);

  const fundingAmount = parseToMinor(fundInput, currency);
  const sourceBalance = balances.data?.find((b) => b.currency === currency)?.available ?? 0;
  const insufficient = fundingAmount > sourceBalance;
  const presets = CARD_FUND_PRESETS[currency] ?? [];

  // Live preview card.
  const preview: Card = {
    id: 'preview', label: label || 'New card', brand, currency, last4: '••••',
    expMonth: 12, expYear: 28, cardholderName: 'SPOTLIGHT USER', balance: fundingAmount,
    status: 'active', color, spentThisMonth: 0,
    controls: { monthlyLimit: null, perTxLimit: null, online: true, atm: false, international: true, contactless: true },
    provider: 'maplerad', createdAt: new Date().toISOString(),
  };

  const disabled = !label.trim() || fundingAmount <= 0 || insufficient;

  const submit = async () => {
    const card = await create.mutateAsync({ label: label.trim(), brand, currency, color, fundingAmount });
    router.replace(`/fx/cards/${card.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create virtual card" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <CardVisual card={preview} compact />

          <View style={styles.gap} />
          <TextInputField label="Card label" value={label} onChangeText={setLabel} placeholder="e.g. Subscriptions" autoCapitalize="words" />

          <Text style={styles.label}>Brand</Text>
          <SegmentedTabs<CardBrand>
            value={brand}
            onChange={setBrand}
            options={CARD_BRANDS.map((b) => ({ value: b.value, label: b.label }))}
          />

          <View style={styles.currencyRow}>
            <Text style={styles.label}>Currency</Text>
            <CurrencyChip currency={currency} onPress={() => setPicker(true)} />
          </View>

          <Text style={styles.label}>Card colour</Text>
          <View style={styles.colorRow}>
            {CARD_COLOR_OPTIONS.map((c) => (
              <Pressable key={c} onPress={() => setColor(c)} accessibilityRole="button" accessibilityLabel={`${c} card`} accessibilityState={{ selected: color === c }}>
                <LinearGradient colors={CARD_GRADIENTS[c]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.swatch, color === c && styles.swatchActive]}>
                  {color === c ? <Check size={16} color={Colors.onPrimary} strokeWidth={3} /> : null}
                </LinearGradient>
              </Pressable>
            ))}
          </View>

          <View style={styles.fundHead}>
            <Text style={styles.label}>Initial funding</Text>
            <Text style={styles.balance}>Balance: {formatMoney(sourceBalance, currency)}</Text>
          </View>
          <View style={[styles.amountRow, insufficient && styles.amountError]}>
            <CurrencyChip currency={currency} onPress={() => setPicker(true)} compact />
            <TextInput
              style={styles.amountInput}
              value={fundInput}
              onChangeText={setFundInput}
              placeholder="0.00"
              placeholderTextColor={Colors.outline}
              keyboardType="decimal-pad"
              accessibilityLabel="Initial funding amount"
            />
          </View>
          {insufficient ? <Text style={styles.errorText}>Insufficient {currency} balance to fund this card.</Text> : null}
          {presets.length > 0 ? (
            <View style={styles.presetRow}>
              {presets.map((p) => (
                <Pressable key={p} style={styles.preset} onPress={() => setFundInput(minorToInput(p, currency))} accessibilityRole="button">
                  <Text style={styles.presetText}>{formatMoney(p, currency, { decimals: false })}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Create card" onPress={submit} loading={create.isPending} disabled={disabled} />
        </SafeAreaView>
      </KeyboardAvoidingView>

      <CurrencyPickerSheet
        visible={picker}
        title="Card currency"
        value={currency}
        options={CARD_CURRENCIES}
        balances={balances.data}
        onSelect={setCurrency}
        onClose={() => setPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  gap: { height: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm, marginTop: Spacing.md },
  currencyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md },
  colorRow: { flexDirection: 'row', gap: Spacing.md },
  swatch: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.transparent },
  swatchActive: { borderColor: Colors.onSurface },
  fundHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: Spacing.md, marginBottom: Spacing.sm },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.secondary, paddingHorizontal: Spacing.md, height: 60,
  },
  amountError: { borderColor: Colors.error },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.titleLg, color: Colors.onSurface, padding: 0 },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  preset: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  presetText: { ...Typography.labelMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
