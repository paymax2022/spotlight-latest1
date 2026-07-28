import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, RotateCcw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { usePolicy, useCancelPolicy } from '@/features/insurance/hooks';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

const REASONS = [
  'No longer need this cover',
  'Found a cheaper option',
  'Premium too high',
  'Cover not as expected',
  'Other',
];

export default function CancelPolicy() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policy = usePolicy(id ?? '');
  const cancel = useCancelPolicy(id ?? '');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancel policy" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cancel policy" />
        <StateView kind="error" title="Couldn't load policy" actionLabel="Retry" onAction={() => policy.refetch()} />
      </SafeAreaView>
    );
  }

  const p = policy.data;
  const finalReason = reason === 'Other' ? other.trim() : reason;

  const onCancel = async () => {
    await cancel.mutateAsync(finalReason || 'Cancelled by user');
    router.replace(`/insurance/policies/${p.id}/refund-status`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Cancel policy" subtitle={p.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.warnCard}>
          <Ban size={20} color={Colors.error} />
          <Text style={styles.warnText}>Cancelling ends your cover. This cannot be undone.</Text>
        </View>

        <View style={styles.refundNote}>
          <RotateCcw size={16} color={InsuranceColors.ok} />
          <Text style={styles.refundText}>
            Any eligible refund (per the underwriter's cancellation rules) is returned to your wallet.
          </Text>
        </View>

        <Text style={styles.label}>Why are you cancelling?</Text>
        <View style={styles.reasonList}>
          {REASONS.map((r) => {
            const active = reason === r;
            return (
              <Pressable key={r} style={[styles.reason, active && styles.reasonActive]} onPress={() => setReason(r)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[styles.radio, active && styles.radioOn]} />
                <Text style={[styles.reasonText, active && styles.reasonTextActive]}>{r}</Text>
              </Pressable>
            );
          })}
        </View>

        {reason === 'Other' ? (
          <TextInputField label="Tell us more" value={other} placeholder="Your reason" onChangeText={setOther} multiline />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Cancel policy" variant="danger" onPress={onCancel} disabled={!finalReason} loading={cancel.isPending} />
        <PrimaryButton label="Keep my cover" variant="ghost" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  warnCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  warnText: { ...Typography.labelMd, color: Colors.error, flex: 1 },
  refundNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: InsuranceColors.okBg, borderRadius: Radius.md, padding: Spacing.md },
  refundText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  reasonList: { gap: Spacing.sm },
  reason: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: InsuranceColors.surface, borderWidth: 1, borderColor: InsuranceColors.border, borderRadius: Radius.lg, padding: Spacing.md },
  reasonActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outline },
  radioOn: { borderColor: Colors.primary, borderWidth: 6 },
  reasonText: { ...Typography.bodyMd, color: Colors.onSurface },
  reasonTextActive: { color: Colors.primary, fontWeight: '600' as const },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
