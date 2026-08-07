import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2, XCircle, ShieldCheck } from 'lucide-react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { verifyExisting, isBusinessActive } from '@/api/business.api';
import { statusChip, toneColors } from '@/features/business/statusDisplay';
import { getErrorMessage } from '@/utils/errorMapper';
import type { BusinessEntityType, BusinessProfile } from '@/types/business';

const ENTITY_OPTIONS: { value: BusinessEntityType; label: string }[] = [
  { value: 'business_name',        label: 'Business name' },
  { value: 'company',              label: 'Company' },
  { value: 'incorporated_trustee', label: 'Trustee' },
];

const ENTITY_LABEL: Record<BusinessEntityType, string> = {
  business_name:        'Business name',
  company:              'Limited company',
  incorporated_trustee: 'Incorporated trustee',
};

// RC/BN: alphanumeric, 4–15 chars (RC1234567, BN1234567, or bare digits).
const schema = z.object({
  rcOrBnNumber: z
    .string()
    .trim()
    .min(4, 'Enter a valid RC/BN number')
    .max(15, 'RC/BN number looks too long')
    .regex(/^[A-Za-z0-9-]+$/, 'Only letters, numbers and dashes are allowed'),
});
type Form = z.infer<typeof schema>;

export default function VerifyBusinessScreen() {
  const qc = useQueryClient();
  const [entityType, setEntityType] = React.useState<BusinessEntityType>('business_name');
  const [result, setResult] = React.useState<BusinessProfile | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { rcOrBnNumber: '' },
  });

  const verify = useMutation({
    mutationFn: (values: Form) => verifyExisting({ rcOrBnNumber: values.rcOrBnNumber, entityType }),
    onSuccess: (business) => {
      setResult(business);
      qc.invalidateQueries({ queryKey: ['business', 'me'] });
    },
  });

  const onSubmit = handleSubmit((values) => {
    setResult(null);
    verify.mutate(values);
  });

  const rejected = result && (result.status === 'rejected' || result.status === 'failed');
  const active = result && isBusinessActive(result);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verify existing business" subtitle="Confirm your RC/BN with CAC" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.intro, shadow1]}>
            <ShieldCheck size={20} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.introText}>
              Enter the registration number printed on your CAC certificate. We'll confirm the
              business exists and pull its registered details.
            </Text>
          </View>

          <Text style={styles.fieldLabel}>Entity type</Text>
          <SegmentedControl
            options={ENTITY_OPTIONS}
            value={entityType}
            onChange={(v) => setEntityType(v)}
          />

          <View style={styles.field}>
            <Controller
              name="rcOrBnNumber"
              control={control}
              render={({ field }) => (
                <TextInputField
                  label="RC / BN number"
                  placeholder="e.g. BN1234567 or RC1234567"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  error={errors.rcOrBnNumber?.message}
                  value={field.value}
                  onChangeText={(v) => { field.onChange(v); setResult(null); }}
                />
              )}
            />
          </View>

          {verify.isError ? (
            <Text style={styles.apiError}>{getErrorMessage(verify.error)}</Text>
          ) : null}

          {result ? (
            <View style={[styles.resultCard, shadow1, rejected && styles.resultCardError, active && styles.resultCardOk]}>
              <View style={styles.resultHeader}>
                {rejected
                  ? <XCircle size={22} color={Colors.error} strokeWidth={2} />
                  : <CheckCircle2 size={22} color="#15803D" strokeWidth={2} />}
                <Text style={styles.resultTitle}>
                  {rejected ? 'Could not verify' : 'Business verified'}
                </Text>
                {(() => {
                  const chip = statusChip(result.status);
                  const tc = toneColors(chip.tone);
                  return <Text style={[styles.chip, { backgroundColor: tc.bg, color: tc.fg }]}>{chip.label}</Text>;
                })()}
              </View>

              {rejected ? (
                <Text style={styles.resultReason}>
                  {(result.metadata?.reason as string | undefined)
                    ?? 'We could not confirm this registration number with CAC. Double-check the number and try again.'}
                </Text>
              ) : (
                <View style={styles.resultRows}>
                  <ResultRow label="Legal name" value={result.legalName ?? result.proposedName ?? '—'} />
                  <ResultRow label="Entity type" value={ENTITY_LABEL[result.entityType]} />
                  <ResultRow label="RC / BN" value={result.rcOrBnNumber ?? '—'} />
                  {result.lineOfBusiness ? <ResultRow label="Line of business" value={result.lineOfBusiness} /> : null}
                  {result.verificationSource ? <ResultRow label="Source" value={result.verificationSource} /> : null}
                </View>
              )}
            </View>
          ) : null}

          {active ? (
            <PrimaryButton label="Done" onPress={() => router.replace('/profile/business' as never)} />
          ) : (
            <PrimaryButton
              label={verify.isPending ? 'Verifying…' : 'Verify business'}
              onPress={onSubmit}
              loading={verify.isPending}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  intro:       { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  introText:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  fieldLabel:  { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm, marginHorizontal: Spacing.containerMargin },
  field:       { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
  apiError:    { ...Typography.labelSm, color: Colors.error, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  resultCard:  { marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  resultCardOk:{ borderColor: 'rgba(22,163,74,0.4)' },
  resultCardError:{ borderColor: Colors.error },
  resultHeader:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  resultTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  chip:        { ...Typography.labelSm, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, overflow: 'hidden', fontWeight: '700' },
  resultReason:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  resultRows:  { gap: Spacing.xs },
  row:         { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.xs },
  rowLabel:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue:    { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
});
