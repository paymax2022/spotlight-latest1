import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import CurrencyPickerSheet from '@/features/fx/components/CurrencyPickerSheet';
import { useValidateBeneficiary, useCreateBeneficiary, useUpdateBeneficiary, useBeneficiaries } from '@/features/fx/hooks/useFx';
import { RAILS, CURRENCY_ORDER } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode, Rail, NewBeneficiaryDraft } from '@/features/fx/types/fx.types';

const RAIL_LABELS = RAILS.map((r) => r.label);

export default function NewBeneficiaryScreen() {
  // editId → edit mode; returnTo controls where we go after save ('send' | 'hub').
  const { editId, returnTo } = useLocalSearchParams<{ editId?: string; returnTo?: string }>();
  const isEdit = Boolean(editId);
  const validate = useValidateBeneficiary();
  const create = useCreateBeneficiary();
  const update = useUpdateBeneficiary();
  const { data: beneficiaries } = useBeneficiaries();

  const [railLabel, setRailLabel] = useState(RAILS[0].label);
  const rail = (RAILS.find((r) => r.label === railLabel) ?? RAILS[0]);
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [bank, setBank] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('NGN');
  const [country, setCountry] = useState('NG');
  const [picker, setPicker] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; resolvedName?: string; reason?: string } | null>(null);

  // Prefill once when editing an existing beneficiary.
  useEffect(() => {
    if (!isEdit || prefilled) return;
    const b = beneficiaries?.find((x) => x.id === editId);
    if (!b) return;
    setRailLabel(RAILS.find((r) => r.value === b.rail)?.label ?? RAILS[0].label);
    setName(b.name);
    setAccount(b.accountNumber);
    setBank(b.bankName ?? '');
    setCurrency(b.currency);
    setCountry(b.countryCode);
    setValidation({ valid: true, resolvedName: b.name });
    setPrefilled(true);
  }, [isEdit, prefilled, beneficiaries, editId]);

  const accountLabel =
    rail.value === 'mobile_money' ? 'Mobile money number'
    : rail.value === 'iban' ? 'IBAN'
    : rail.value === 'stablecoin' ? 'Wallet address'
    : rail.value === 'wallet' ? 'Paymax tag / email'
    : 'Account number';

  const bankLabel = rail.value === 'mobile_money' ? 'Network / operator' : 'Bank name';
  const showBank = rail.value === 'bank_transfer' || rail.value === 'mobile_money' || rail.value === 'iban';

  const draft = (): NewBeneficiaryDraft => ({
    name, rail: rail.value as Rail, scheme: rail.scheme, currency,
    accountNumber: account, bankName: showBank ? bank : null, countryCode: country,
  });

  const canValidate = name.trim() && account.trim();

  const runValidate = async () => {
    const res = await validate.mutateAsync(draft());
    setValidation(res);
    if (res.resolvedName) setName(res.resolvedName);
  };

  const save = async () => {
    if (!validation?.valid) { await runValidate(); return; }
    if (isEdit && editId) {
      await update.mutateAsync({ id: editId, draft: draft() });
      router.back();
      return;
    }
    const created = await create.mutateAsync(draft());
    if (returnTo === 'hub') { router.back(); return; }
    router.replace({ pathname: '/fx/send/amount', params: { beneficiaryId: created.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={isEdit ? 'Edit beneficiary' : 'Add beneficiary'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <SelectField
            label="Payout rail"
            value={railLabel}
            options={RAIL_LABELS}
            searchable={false}
            onChange={(v) => { setRailLabel(v); setValidation(null); }}
          />

          <View style={styles.currencyField}>
            <Text style={styles.fieldLabel}>Receiving currency</Text>
            <CurrencyChip currency={currency} onPress={() => setPicker(true)} />
          </View>

          <TextInputField
            label="Beneficiary name"
            value={name}
            onChangeText={(t) => { setName(t); setValidation(null); }}
            placeholder="e.g. John Snow"
            autoCapitalize="words"
          />
          <TextInputField
            label={accountLabel}
            value={account}
            onChangeText={(t) => { setAccount(t); setValidation(null); }}
            placeholder={accountLabel}
            autoCapitalize="characters"
            error={validation && !validation.valid ? validation.reason : undefined}
          />
          {showBank ? (
            <TextInputField label={bankLabel} value={bank} onChangeText={setBank} placeholder={bankLabel} autoCapitalize="words" />
          ) : null}

          {validation ? (
            <View style={[styles.validation, validation.valid ? styles.validOk : styles.validBad]}>
              {validation.valid
                ? <BadgeCheck size={16} color={Colors.teal} strokeWidth={2} />
                : <ShieldAlert size={16} color={Colors.error} strokeWidth={2} />}
              <Text style={[styles.validText, { color: validation.valid ? Colors.tertiaryContainer : Colors.error }]}>
                {validation.valid ? `Verified: ${validation.resolvedName}` : validation.reason}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {validation?.valid ? (
            <PrimaryButton
              label={isEdit ? 'Save changes' : returnTo === 'hub' ? 'Save beneficiary' : 'Save & continue'}
              onPress={save}
              loading={create.isPending || update.isPending}
            />
          ) : (
            <PrimaryButton label="Validate account" onPress={runValidate} loading={validate.isPending} disabled={!canValidate} />
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>

      <CurrencyPickerSheet
        visible={picker}
        title="Receiving currency"
        value={currency}
        options={CURRENCY_ORDER}
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
  currencyField: { marginBottom: Spacing.md },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  validation: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.xs },
  validOk: { backgroundColor: Colors.iconBgTeal },
  validBad: { backgroundColor: Colors.errorContainer },
  validText: { ...Typography.labelMd, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
