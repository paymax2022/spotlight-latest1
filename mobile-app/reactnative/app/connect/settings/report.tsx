import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useReportReasons, useSubmitReport } from '@/features/connect/hooks/useConnect';

// ST-07 — Report flow. Multi-step reason → details → submit.
// SAFETY INVARIANT §7: a report always creates a case and must not fail silently.
export default function Report() {
  const { data: reasons, isLoading, error, refetch } = useReportReasons();
  const submit = useSubmitReport();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitError, setSubmitError] = useState<string | undefined>();

  const reasonLabel = reasons?.find((r) => r.code === reason)?.label ?? '';

  const onSubmit = () => {
    if (!reason) return;
    setSubmitError(undefined);
    submit.mutate(
      { reason: reasonLabel, details: details.trim() || undefined },
      { onError: () => setSubmitError('Could not submit your report. Please try again — your report matters.') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Report a problem" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !reasons ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => refetch()} />
      ) : submit.isSuccess ? (
        <View style={styles.success}>
          <View style={styles.successIcon}><CircleCheck size={48} color={Colors.teal} strokeWidth={1.6} /></View>
          <Text style={styles.successTitle}>Report submitted</Text>
          <Text style={styles.successBody}>
            Case {submit.data.id} has been opened. Our safety team will review it. Thank you for keeping
            Connect safe.
          </Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}>
            <PrimaryButton label="Done" onPress={() => router.back()} />
          </View>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.q}>What's happening?</Text>
          <View style={styles.card}>
            {reasons.map((r, i, arr) => {
              const active = reason === r.code;
              return (
                <Pressable
                  key={r.code}
                  style={[styles.reasonRow, i < arr.length - 1 && styles.divider]}
                  onPress={() => setReason(r.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reasonLabel}>{r.label}</Text>
                    {r.description ? <Text style={styles.reasonDesc}>{r.description}</Text> : null}
                  </View>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.q}>Add details (optional)</Text>
          <TextInputField
            value={details}
            onChangeText={setDetails}
            placeholder="Tell us what happened…"
            multiline
            numberOfLines={4}
            style={styles.detailsInput}
          />

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

          <View style={{ marginTop: Spacing.md }}>
            <PrimaryButton label="Submit report" onPress={onSubmit} disabled={!reason} loading={submit.isPending} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  q: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  reasonLabel: { ...Typography.labelLg, color: Colors.onSurface },
  reasonDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  radio: { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  detailsInput: { minHeight: 96, textAlignVertical: 'top' },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.sm },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  successIcon: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
