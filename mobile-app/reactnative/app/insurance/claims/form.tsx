import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { usePolicy } from '@/features/insurance/hooks';
import { useSubmitFnol, claimTypesForLine } from '@/features/insurance/claims';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { ClaimFieldSchema, ClaimType } from '@/features/insurance/claims';

/** Schema-driven FNOL form (PRD §15.1). Submits FNOL with an Idempotency-Key. */
export default function ClaimForm() {
  const { policyId } = useLocalSearchParams<{ policyId: string }>();
  const policy = usePolicy(policyId ?? '');
  const submit = useSubmitFnol();

  const [perilCode, setPerilCode] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Stable idempotency key for this FNOL attempt (PRD §12.1).
  const idemKey = useRef(`ins-fnol-${policyId}-${Math.random().toString(36).slice(2, 10)}`).current;

  const claimTypes: ClaimType[] = useMemo(
    () => (policy.data ? claimTypesForLine(policy.data.productLine) : []),
    [policy.data],
  );
  const activeType = useMemo(
    () => claimTypes.find((t) => t.perilCode === perilCode) ?? claimTypes[0],
    [claimTypes, perilCode],
  );

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim details" />
        <StateView kind="loading" message="Preparing your claim form…" />
      </SafeAreaView>
    );
  }
  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim details" />
        <StateView kind="error" title="Couldn't load policy" actionLabel="Back" onAction={() => goBack('/insurance/claims')} />
      </SafeAreaView>
    );
  }

  const p = policy.data;
  const fields = activeType?.fieldsSchema ?? [];

  const setField = (key: string, val: string) => {
    setValues((v) => ({ ...v, [key]: val }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const val = (values[f.key] ?? '').trim();
      if (f.required && !val) next[f.key] = `${f.label} is required`;
      else if (val && (f.type === 'number' || f.type === 'currency') && Number.isNaN(Number(val))) {
        next[f.key] = 'Enter a valid number';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    const claim = await submit.mutateAsync({
      policyId: p.id,
      perilCode: activeType?.perilCode ?? 'general.loss',
      inputs: values,
      idempotencyKey: idemKey,
    });
    router.replace(`/insurance/claims/evidence?id=${claim.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Claim details" subtitle={p.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <UnderwriterBadge disclosure={p.disclosure} />

        {claimTypes.length > 1 ? (
          <SelectField
            label="What are you claiming for?"
            value={activeType?.perilLabel ?? ''}
            placeholder="Select claim type"
            options={claimTypes.map((t) => t.perilLabel)}
            searchable={false}
            onChange={(label) => {
              const t = claimTypes.find((ct) => ct.perilLabel === label);
              if (t) { setPerilCode(t.perilCode); setValues({}); setErrors({}); }
            }}
          />
        ) : null}

        {fields.map((f) => (
          <Field key={f.key} field={f} value={values[f.key] ?? ''} error={errors[f.key]} onChange={(v) => setField(f.key, v)} />
        ))}

        <Text style={styles.note}>
          Your report is your first notice of loss (FNOL). You'll add evidence next. Filing a false claim may void your cover.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to evidence" onPress={onSubmit} loading={submit.isPending} />
        {submit.isError ? <Text style={styles.err}>Couldn't submit your claim. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function Field({ field, value, error, onChange }: { field: ClaimFieldSchema; value: string; error?: string; onChange: (v: string) => void }) {
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
  const multiline = field.type === 'textarea';
  return (
    <>
      <TextInputField
        label={field.label}
        value={value}
        error={error}
        placeholder={field.placeholder}
        onChangeText={onChange}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        keyboardType={field.type === 'number' || field.type === 'currency' ? 'numeric' : 'default'}
      />
      {field.helper ? <Text style={styles.helper}>{field.helper}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.sm },
  helper: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.sm, marginBottom: Spacing.md },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20, marginTop: Spacing.sm },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.xs },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
});
