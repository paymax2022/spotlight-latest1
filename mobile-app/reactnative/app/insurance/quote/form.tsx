import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { sanitizeMoneyInput } from '@/utils/money';
import { useProduct, useKycProfile, useCreateQuote } from '@/features/insurance/hooks';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors, TIER_RANK, TIER_LABEL } from '@/features/insurance/constants/insurance.constants';
import type { FieldSchema } from '@/features/insurance/types';

export default function QuoteForm() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const product = useProduct(code ?? '');
  const kyc = useKycProfile();
  const createQuote = useCreateQuote();

  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Prefill from KYC (PRD §6.1 — never re-collect what KYC holds).
  useEffect(() => {
    if (product.data && kyc.data) {
      const init: Record<string, string> = {};
      for (const f of product.data.fieldsSchema) {
        if (f.kycKey && kyc.data[f.kycKey] != null) init[f.key] = String(kyc.data[f.kycKey]);
      }
      setValues((prev) => ({ ...init, ...prev }));
    }
  }, [product.data, kyc.data]);

  // KYC-gap gate (PRD §16 / §24 KYC_TIER_INSUFFICIENT).
  const tierInsufficient = useMemo(() => {
    if (!product.data || !kyc.data) return false;
    return TIER_RANK[kyc.data.tier] < TIER_RANK[product.data.requiredKycTier];
  }, [product.data, kyc.data]);

  if (product.isLoading || kyc.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Get a quote" />
        <StateView kind="loading" message="Preparing your form…" />
      </SafeAreaView>
    );
  }
  if (product.isError || !product.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Get a quote" />
        <StateView kind="error" title="Couldn't load product" actionLabel="Retry" onAction={() => product.refetch()} />
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
      else if (val && (f.type === 'number' || f.type === 'currency')) {
        const n = Number(val);
        if (Number.isNaN(n)) next[f.key] = 'Enter a valid number';
        else if (f.min != null && n < f.min) next[f.key] = `Minimum is ${f.min.toLocaleString()}`;
        else if (f.max != null && n > f.max) next[f.key] = `Maximum is ${f.max.toLocaleString()}`;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    const quote = await createQuote.mutateAsync({ productCode: p.code, inputs: values });
    router.push(`/insurance/quote/review?id=${quote.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Get a quote" subtitle={p.displayName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <UnderwriterBadge disclosure={p.disclosure} />

        {tierInsufficient ? (
          <View style={styles.gapCard}>
            <Text style={styles.gapTitle}>Verification required</Text>
            <Text style={styles.gapText}>
              This product needs {TIER_LABEL[p.requiredKycTier]} verification. You're currently{' '}
              {TIER_LABEL[kyc.data?.tier ?? 'TIER_0']}.
            </Text>
            <PrimaryButton
              label="Upgrade verification"
              onPress={() =>
                router.push(`/insurance/kyc-gap?required=${p.requiredKycTier}&current=${kyc.data?.tier}&code=${encodeURIComponent(p.code)}`)
              }
            />
          </View>
        ) : (
          <>
            {kyc.data ? (
              <View style={styles.prefillNote}>
                <BadgeCheck size={16} color={InsuranceColors.ok} />
                <Text style={styles.prefillText}>Prefilled from your verified profile — edit if needed.</Text>
              </View>
            ) : null}

            {p.fieldsSchema.map((f) => (
              <Field key={f.key} field={f} value={values[f.key] ?? ''} error={errors[f.key]} onChange={(v) => setField(f.key, v)} />
            ))}
          </>
        )}
      </ScrollView>

      {!tierInsufficient ? (
        <View style={styles.footer}>
          <PrimaryButton label="Get quote" onPress={onSubmit} loading={createQuote.isPending} />
          {createQuote.isError ? <Text style={styles.err}>Couldn't get a quote. Please try again.</Text> : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldSchema;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  if (field.type === 'select' && field.options) {
    const labels = field.options.map((o) => o.label);
    const selectedLabel = field.options.find((o) => o.value === value)?.label ?? '';
    return (
      <SelectField
        label={field.label}
        value={selectedLabel}
        error={error}
        placeholder={`Select ${field.label.toLowerCase()}`}
        options={labels}
        searchable={labels.length > 6}
        onChange={(label) => {
          const opt = field.options?.find((o) => o.label === label);
          onChange(opt?.value ?? label);
        }}
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
        onChangeText={(v) => onChange(field.type === 'currency' ? sanitizeMoneyInput(v) : v)}
        keyboardType={field.type === 'currency' ? 'decimal-pad' : field.type === 'number' ? 'numeric' : 'default'}
        maxLength={field.type === 'currency' ? 13 : undefined}
      />
      {field.helper ? <Text style={styles.helper}>{field.helper}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.sm },
  prefillNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginVertical: Spacing.xs },
  prefillText: { ...Typography.labelSm, color: InsuranceColors.muted, flex: 1 },
  helper: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.sm, marginBottom: Spacing.md },
  gapCard: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.lg, gap: Spacing.md, marginTop: Spacing.md },
  gapTitle: { ...Typography.titleMd, color: Colors.onSurface },
  gapText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.xs },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
});
