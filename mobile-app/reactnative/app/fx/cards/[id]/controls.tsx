import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Globe, Banknote, Nfc, ShoppingCart } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/doctor/components/ToggleRow';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import { useCard, useUpdateCardControls } from '@/features/fx/hooks/useFxCards';
import { parseToMinor, minorToInput } from '@/features/fx/utils/fxFormatters';
import { sanitizeMoneyInput } from '@/utils/money';
import type { SpendingControls } from '@/features/fx/types/fx.types';

export default function CardControlsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: card, isLoading } = useCard(id);
  const update = useUpdateCardControls();

  const [controls, setControls] = useState<SpendingControls | null>(null);
  const [monthly, setMonthly] = useState('');
  const [perTx, setPerTx] = useState('');

  useEffect(() => {
    if (card && card.controls && !controls) {
      setControls(card.controls);
      setMonthly(card.controls.monthlyLimit ? minorToInput(card.controls.monthlyLimit, card.currency) : '');
      setPerTx(card.controls.perTxLimit ? minorToInput(card.controls.perTxLimit, card.currency) : '');
    }
  }, [card, controls]);

  if (isLoading || !card || !controls) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Card controls" /><StateView kind="loading" /></SafeAreaView>;
  }

  const set = (patch: Partial<SpendingControls>) => setControls({ ...controls, ...patch });

  const save = async () => {
    await update.mutateAsync({
      id: card.id,
      controls: {
        ...controls,
        monthlyLimit: monthly ? parseToMinor(monthly, card.currency) : null,
        perTxLimit: perTx ? parseToMinor(perTx, card.currency) : null,
      },
    });
    goBack('/fx/cards');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Card controls" subtitle={`${card.label} · •••• ${card.last4}`} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Spending limits</Text>

          <Text style={styles.label}>Monthly limit</Text>
          <View style={styles.limitRow}>
            <CurrencyChip currency={card.currency} compact />
            <TextInput style={styles.limitInput} value={monthly} onChangeText={(v) => setMonthly(sanitizeMoneyInput(v))} placeholder="No limit" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} accessibilityLabel="Monthly limit" />
          </View>

          <Text style={[styles.label, styles.spaced]}>Per-transaction limit</Text>
          <View style={styles.limitRow}>
            <CurrencyChip currency={card.currency} compact />
            <TextInput style={styles.limitInput} value={perTx} onChangeText={(v) => setPerTx(sanitizeMoneyInput(v))} placeholder="No limit" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} accessibilityLabel="Per-transaction limit" />
          </View>

          <Text style={[styles.section, styles.spaced]}>Where this card works</Text>
          <View style={styles.toggles}>
            <ToggleRow label="Online payments" description="E-commerce & subscriptions" icon={ShoppingCart} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} value={controls.online} onValueChange={(v) => set({ online: v })} />
            <ToggleRow label="ATM withdrawals" description="Cash withdrawals" icon={Banknote} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} value={controls.atm} onValueChange={(v) => set({ atm: v })} />
            <ToggleRow label="International" description="Cross-border merchants" icon={Globe} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} value={controls.international} onValueChange={(v) => set({ international: v })} />
            <ToggleRow label="Contactless" description="Tap to pay" icon={Nfc} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} value={controls.contactless} onValueChange={(v) => set({ contactless: v })} />
          </View>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Save controls" onPress={save} loading={update.isPending} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  spaced: { marginTop: Spacing.lg },
  limitRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.md, height: 56,
  },
  limitInput: { flex: 1, textAlign: 'right', ...Typography.titleMd, color: Colors.onSurface, padding: 0 },
  toggles: { gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
