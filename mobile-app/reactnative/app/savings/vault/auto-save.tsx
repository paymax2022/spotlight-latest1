import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useVault, useSetAutoSave } from '@/features/savings/hooks';
import { SavingsColors, FREQUENCIES, NO_YIELD_DISCLOSURE } from '@/features/savings/constants/savings.constants';
import type { SaveFrequency } from '@/features/savings/types';

export default function AutoSaveSetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vaultId = String(id);
  const vault = useVault(vaultId);
  const save = useSetAutoSave(vaultId);

  const [enabled, setEnabled] = useState(true);
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState<SaveFrequency>('weekly');
  const [seeded, setSeeded] = useState(false);

  React.useEffect(() => {
    if (vault.data && !seeded) {
      const a = vault.data.autoSave;
      if (a) { setEnabled(a.enabled); setAmount(String(a.amountKobo / 100)); setFreq(a.frequency); }
      setSeeded(true);
    }
  }, [vault.data, seeded]);

  if (vault.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Auto-save" /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (vault.isError) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Auto-save" /><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => vault.refetch()} /></SafeAreaView>;

  const amountKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;

  const submit = async () => {
    if (enabled && amountKobo <= 0) return;
    try {
      await save.mutateAsync({ enabled, amountKobo, frequency: freq });
      router.back();
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Auto-save" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.toggleCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Enable auto-save</Text>
            <Text style={styles.toggleSub}>We'll debit your wallet automatically on schedule.</Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: Colors.primary }} />
        </View>

        {enabled ? (
          <>
            <TextInputField label="Amount per cycle" placeholder="0" keyboardType="numeric" value={amount} onChangeText={setAmount} />
            <Text style={styles.label}>Frequency</Text>
            <SegmentedControl<SaveFrequency>
              options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
              value={freq}
              onChange={setFreq}
            />
          </>
        ) : null}

        <DisclosureBanner text={NO_YIELD_DISCLOSURE} />
        <PrimaryButton label="Save settings" onPress={submit} loading={save.isPending} disabled={enabled && amountKobo <= 0} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  toggleCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  toggleTitle: { ...Typography.titleMd, color: Colors.onSurface },
  toggleSub: { ...Typography.bodySm, color: SavingsColors.muted },
  label: { ...Typography.labelLg, color: Colors.onSurface },
});
