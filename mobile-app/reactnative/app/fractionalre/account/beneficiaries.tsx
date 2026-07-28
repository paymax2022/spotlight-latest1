import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserPlus, User, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useBeneficiaries, useAddBeneficiary, useRemoveBeneficiary } from '@/features/fractionalre/hooks';

// Server rules mirrored client-side so users get instant feedback; the server
// (and the mock layer) re-checks everything and 422s on violation.
const MAX_BENEFICIARIES = 10;
const NAME_MIN = 2;
const NAME_MAX = 80;
const REL_MIN = 2;
const REL_MAX = 40;

export default function BeneficiariesScreen() {
  const beneficiaries = useBeneficiaries();
  const addBeneficiary = useAddBeneficiary();
  const removeBeneficiary = useRemoveBeneficiary();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [rel, setRel] = useState('');
  const [share, setShare] = useState('');

  const list = beneficiaries.data ?? [];
  const allocatedPct = list.reduce((sum, b) => sum + b.share_pct, 0);
  const remainingPct = Math.max(0, 100 - allocatedPct);
  const atMax = list.length >= MAX_BENEFICIARIES;

  const pct = parseInt(share || '0', 10);
  const validationError = !adding
    ? null
    : name.trim().length > 0 && name.trim().length < NAME_MIN
      ? `Name must be at least ${NAME_MIN} characters.`
      : name.trim().length > NAME_MAX
        ? `Name must be at most ${NAME_MAX} characters.`
        : rel.trim().length > 0 && rel.trim().length < REL_MIN
          ? `Relationship must be at least ${REL_MIN} characters.`
          : rel.trim().length > REL_MAX
            ? `Relationship must be at most ${REL_MAX} characters.`
            : share.length > 0 && pct < 1
              ? 'Share must be at least 1%.'
              : pct > remainingPct
                ? `Only ${remainingPct}% remains to allocate.`
                : null;
  const canSubmit =
    name.trim().length >= NAME_MIN && name.trim().length <= NAME_MAX &&
    rel.trim().length >= REL_MIN && rel.trim().length <= REL_MAX &&
    pct >= 1 && pct <= remainingPct && !addBeneficiary.isPending;

  const resetForm = () => {
    setName(''); setRel(''); setShare(''); setAdding(false);
  };

  const add = () => {
    if (!canSubmit) return;
    // Optimistic: the hook inserts the row immediately and rolls back on error.
    addBeneficiary.mutate(
      { name: name.trim(), relationship: rel.trim(), share_pct: pct },
      {
        onSuccess: resetForm,
        onError: (err) => {
          Alert.alert('Could not add beneficiary', err instanceof Error ? err.message : 'Please try again.');
        },
      },
    );
  };

  const confirmRemove = (id: string, benName: string) => {
    Alert.alert('Remove beneficiary', `Remove ${benName}? Their share will be freed up.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          removeBeneficiary.mutate(id, {
            onError: () => Alert.alert('Could not remove', 'Please try again.'),
          }),
      },
    ]);
  };

  if (beneficiaries.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Beneficiaries" subtitle="Who inherits your holdings" />
        <StateView kind="loading" message="Loading beneficiaries…" />
      </SafeAreaView>
    );
  }

  if (beneficiaries.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Beneficiaries" subtitle="Who inherits your holdings" />
        <StateView
          kind="error"
          title="Couldn't load beneficiaries"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => beneficiaries.refetch()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Beneficiaries" subtitle="Who inherits your holdings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {list.length === 0 && !adding ? (
          <StateView kind="empty" compact title="No beneficiaries" message="Add a beneficiary so your holdings pass to them." icon="Users" />
        ) : (
          list.map((b) => (
            <View key={b.id} style={styles.row}>
              <View style={styles.iconBox}><User size={18} color={Colors.primary} strokeWidth={2} /></View>
              <View style={styles.text}>
                <Text style={styles.name}>{b.name}</Text>
                <Text style={styles.sub}>{b.relationship} · {b.share_pct}%</Text>
              </View>
              <Pressable hitSlop={8} onPress={() => confirmRemove(b.id, b.name)} disabled={removeBeneficiary.isPending}>
                <Trash2 size={18} color={Colors.error} strokeWidth={2} />
              </Pressable>
            </View>
          ))
        )}

        {list.length > 0 ? (
          <Text style={styles.allocHint}>
            {allocatedPct}% allocated · {remainingPct}% remaining
          </Text>
        ) : null}

        {adding ? (
          <View style={styles.form}>
            <TextInputField label="Full name" value={name} onChangeText={setName} placeholder="e.g. Jane Doe" />
            <TextInputField label="Relationship" value={rel} onChangeText={setRel} placeholder="e.g. Spouse" />
            <TextInputField label="Share %" value={share} onChangeText={(t) => setShare(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="e.g. 50" />
            <Text style={[styles.formHint, validationError ? styles.formHintError : null]}>
              {validationError ?? `${remainingPct}% remaining to allocate`}
            </Text>
            <View style={styles.formBtns}>
              <PrimaryButton label="Cancel" variant="secondary" onPress={resetForm} style={styles.flexBtn} />
              <PrimaryButton label="Add" onPress={add} disabled={!canSubmit} loading={addBeneficiary.isPending} style={styles.flexBtn} />
            </View>
          </View>
        ) : atMax ? (
          <Text style={styles.allocHint}>Maximum of {MAX_BENEFICIARIES} beneficiaries reached.</Text>
        ) : (
          <Pressable style={styles.addBtn} onPress={() => setAdding(true)}>
            <UserPlus size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.addText}>Add beneficiary</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  allocHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 2 },
  form: { gap: Spacing.sm, marginTop: Spacing.sm },
  formHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  formHintError: { color: Colors.error },
  formBtns: { flexDirection: 'row', gap: Spacing.sm },
  flexBtn: { flex: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginTop: Spacing.sm },
  addText: { ...Typography.labelLg, color: Colors.primary },
});
