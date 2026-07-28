import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useProduct } from '@/features/insurance/hooks';
import { useCustomer, useCreateAssistedQuote } from '@/features/insurance/agent';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { FieldSchema } from '@/features/insurance/types';

/** Agent: assisted quote on the customer's behalf (PRD §15.2). */
export default function AssistedQuote() {
  const { customerId, code } = useLocalSearchParams<{ customerId: string; code: string }>();
  const customer = useCustomer(customerId ?? '');
  const product = useProduct(code ?? '');
  const createQuote = useCreateAssistedQuote();

  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Prefill name/phone from the customer identity (the policy attaches to them).
  useEffect(() => {
    if (customer.data) {
      setValues((prev) => ({ fullName: customer.data!.fullName, phone: customer.data!.phone, ...prev }));
    }
  }, [customer.data]);

  if (product.isLoading || customer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Assisted quote" />
        <StateView kind="loading" message="Preparing the quote…" />
      </SafeAreaView>
    );
  }
  if (product.isError || !product.data || customer.isError || !customer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Assisted quote" />
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => { product.refetch(); customer.refetch(); }} />
      </SafeAreaView>
    );
  }

  const p = product.data;

  const setField = (key: string, val: string) => {
    setValues((v) => ({ ...v, [key]: val }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of p.fieldsSchema) {
      const val = (values[f.key] ?? '').trim();
      if (f.required && !val) next[f.key] = `${f.label} is required`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    const quote = await createQuote.mutateAsync({ customerId: customerId ?? '', productCode: p.code, inputs: values });
    router.push(`/insurance/agent/assisted-bind?customerId=${customerId}&quoteId=${quote.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Assisted quote" subtitle={`${p.displayName} · ${customer.data.fullName}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <UnderwriterBadge disclosure={p.disclosure} />
        <Text style={styles.note}>This policy will be issued to {customer.data.fullName} — not your agent account.</Text>

        {p.fieldsSchema.map((f) => (
          <Field key={f.key} field={f} value={values[f.key] ?? ''} error={errors[f.key]} onChange={(v) => setField(f.key, v)} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Get quote" onPress={onSubmit} loading={createQuote.isPending} />
        {createQuote.isError ? <Text style={styles.err}>Couldn't get a quote. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function Field({ field, value, error, onChange }: { field: FieldSchema; value: string; error?: string; onChange: (v: string) => void }) {
  if (field.type === 'select' && field.options) {
    const labels = field.options.map((o) => o.label);
    const selected = field.options.find((o) => o.value === value)?.label ?? '';
    return (
      <SelectField
        label={field.label}
        value={selected}
        error={error}
        placeholder={`Select ${field.label.toLowerCase()}`}
        options={labels}
        searchable={labels.length > 6}
        onChange={(label) => onChange(field.options?.find((o) => o.label === label)?.value ?? label)}
      />
    );
  }
  return (
    <>
      <TextInputField
        label={field.label}
        value={value}
        error={error}
        placeholder={field.placeholder}
        onChangeText={onChange}
        keyboardType={field.type === 'number' || field.type === 'currency' ? 'numeric' : 'default'}
      />
      {field.helper ? <Text style={styles.helper}>{field.helper}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.sm },
  note: { ...Typography.bodySm, color: InsuranceColors.muted, marginVertical: Spacing.xs },
  helper: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.sm, marginBottom: Spacing.md },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.xs },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
});
