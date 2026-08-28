import React, { useEffect, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { UserPlus, Trash2, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { usePolicy, useSaveBeneficiaries } from '@/features/insurance/hooks';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { Beneficiary } from '@/features/insurance/types';

let localSeq = 0;
const newId = () => `ben-new-${localSeq++}`;

export default function Beneficiaries() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policy = usePolicy(id ?? '');
  const save = useSaveBeneficiaries(id ?? '');

  const [items, setItems] = useState<Beneficiary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (policy.data) setItems(policy.data.beneficiaries);
  }, [policy.data]);

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Beneficiaries" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Beneficiaries" />
        <StateView kind="error" title="Couldn't load policy" actionLabel="Retry" onAction={() => policy.refetch()} />
      </SafeAreaView>
    );
  }

  const update = (idx: number, patch: Partial<Beneficiary>) =>
    setItems((arr) => arr.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  const add = () => setItems((arr) => [...arr, { id: newId(), fullName: '', relationship: '', sharePercent: 0 }]);
  const remove = (idx: number) => setItems((arr) => arr.filter((_, i) => i !== idx));

  const totalShare = items.reduce((s, b) => s + (Number(b.sharePercent) || 0), 0);

  const onSave = async () => {
    setError(null);
    if (items.some((b) => !b.fullName.trim() || !b.relationship.trim())) {
      setError('Each beneficiary needs a name and relationship.');
      return;
    }
    if (items.length > 0 && totalShare !== 100) {
      setError(`Shares must total 100% (currently ${totalShare}%).`);
      return;
    }
    await save.mutateAsync(items);
    goBack('/insurance/policies');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Beneficiaries" subtitle={policy.data.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Beneficiaries receive the payout for this policy. Shares must total 100%.
        </Text>

        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}><Users size={26} color={InsuranceColors.muted} /></View>
            <Text style={styles.emptyTitle}>No beneficiaries yet</Text>
            <Text style={styles.emptyText}>Add at least one to direct any payout.</Text>
          </View>
        ) : (
          items.map((b, idx) => (
            <View key={b.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Beneficiary {idx + 1}</Text>
                <Pressable onPress={() => remove(idx)} hitSlop={8} accessibilityLabel="Remove beneficiary">
                  <Trash2 size={18} color={Colors.error} />
                </Pressable>
              </View>
              <TextInputField label="Full name" value={b.fullName} placeholder="Full name" onChangeText={(v) => update(idx, { fullName: v })} />
              <TextInputField label="Relationship" value={b.relationship} placeholder="e.g. Spouse, Child" onChangeText={(v) => update(idx, { relationship: v })} />
              <PhoneNumberInput label="Phone (optional)" value={b.phone ?? ''} onChange={({ e164, nsn }) => ((v) => update(idx, { phone: v }))(e164 || nsn)} />
              <TextInputField label="Share %" value={b.sharePercent ? String(b.sharePercent) : ''} placeholder="0" keyboardType="numeric" onChangeText={(v) => update(idx, { sharePercent: Number(v) || 0 })} />
            </View>
          ))
        )}

        <Pressable style={styles.addBtn} onPress={add} accessibilityRole="button" accessibilityLabel="Add beneficiary">
          <UserPlus size={18} color={InsuranceColors.brand} />
          <Text style={styles.addLabel}>Add beneficiary</Text>
        </Pressable>

        {items.length > 0 ? (
          <Text style={[styles.total, totalShare !== 100 && styles.totalBad]}>Total share: {totalShare}%</Text>
        ) : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Save beneficiaries" onPress={onSave} loading={save.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  emptyBox: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1.5, borderColor: InsuranceColors.brand, borderRadius: Radius.lg, paddingVertical: Spacing.md, borderStyle: 'dashed' },
  addLabel: { ...Typography.labelLg, color: InsuranceColors.brand },
  total: { ...Typography.labelMd, color: InsuranceColors.ok, textAlign: 'right' },
  totalBad: { color: Colors.error },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
