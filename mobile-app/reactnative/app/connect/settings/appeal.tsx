import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useSubmitAppeal, useSafetyCases } from '@/features/connect/hooks/useConnect';

// ST-09 — Appeal a strike/ban. Submit appeal, track status.
export default function Appeal() {
  const submit = useSubmitAppeal();
  const { data: cases } = useSafetyCases();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitError, setSubmitError] = useState<string | undefined>();

  const appeals = (cases ?? []).filter((c) => c.kind === 'appeal');

  const onSubmit = () => {
    setSubmitError(undefined);
    submit.mutate(
      { reason: reason.trim(), details: details.trim() || undefined },
      { onError: () => setSubmitError('Could not submit your appeal. Please try again.') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Appeal a decision" />
      {submit.isSuccess ? (
        <View style={styles.success}>
          <View style={styles.successIcon}><CircleCheck size={48} color={Colors.teal} strokeWidth={1.6} /></View>
          <Text style={styles.successTitle}>Appeal submitted</Text>
          <Text style={styles.successBody}>
            Case {submit.data.id} is now under review. We'll notify you when there's an update.
          </Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}>
            <PrimaryButton label="Done" onPress={() => router.back()} />
          </View>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.lead}>
            If you believe a strike, ban or content removal was a mistake, tell us why. Our team reviews
            every appeal.
          </Text>

          <TextInputField label="What are you appealing?" value={reason} onChangeText={setReason} placeholder="e.g. Account restriction" />
          <TextInputField
            label="Explain your case"
            value={details}
            onChangeText={setDetails}
            placeholder="Add any context that helps us review…"
            multiline
            numberOfLines={5}
            style={styles.detailsInput}
          />

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

          <PrimaryButton label="Submit appeal" onPress={onSubmit} disabled={reason.trim().length < 3} loading={submit.isPending} />

          <Text style={styles.group}>Your appeals</Text>
          {appeals.length > 0 ? (
            <View style={styles.card}>
              {appeals.map((c, i, arr) => (
                <View key={c.id} style={[styles.row, i < arr.length - 1 && styles.divider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{c.reason}</Text>
                    <Text style={styles.rowMeta}>{new Date(c.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.pill}><Text style={styles.pillText}>{c.status.replace('_', ' ')}</Text></View>
                </View>
              ))}
            </View>
          ) : (
            <StateView kind="empty" compact icon="Gavel" title="No appeals yet" message="Appeals you submit appear here." />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, paddingTop: Spacing.md },
  lead: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.lg },
  detailsInput: { minHeight: 110, textAlignVertical: 'top' },
  error: { ...Typography.bodySm, color: Colors.error, marginBottom: Spacing.sm },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xl, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  pill: { backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  pillText: { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  successIcon: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
