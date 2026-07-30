import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Repeat } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { formatNaira } from '@/features/academy/constants';
import { sanitizeMoneyInput } from '@/utils/money';
import { AUTOSAVE_CADENCES } from '@/features/academy/fees/constants';
import { useVaults, useUpdateAutoSave } from '@/features/academy/fees/hooks';

/** PA-08 — Auto-save rules for a fees vault. */
export default function AutoSaveRules() {
  const { vaultId } = useLocalSearchParams<{ vaultId: string }>();
  const vaults = useVaults();
  const update = useUpdateAutoSave();
  const vault = vaults.data?.find((v) => v.id === vaultId);

  const [enabled, setEnabled] = useState(!!vault && vault.autoSaveKobo > 0);
  const [cadence, setCadence] = useState<'manual' | 'weekly' | 'monthly'>(vault && vault.cadence !== 'manual' ? vault.cadence : 'monthly');
  const [amount, setAmount] = useState(vault && vault.autoSaveKobo > 0 ? String(vault.autoSaveKobo / 100) : '');

  if (vaults.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Auto-save" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (!vault) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Auto-save" />
        <StateView kind="error" title="Vault not found" actionLabel="Go back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const pct = vault.targetKobo > 0 ? Math.round((vault.savedKobo / vault.targetKobo) * 100) : 0;
  const amountKobo = Math.round((parseFloat(amount) || 0) * 100);

  const onSave = () => {
    if (enabled && amountKobo <= 0) {
      Alert.alert('Add an amount', 'Enter how much to save each time.');
      return;
    }
    update.mutate(
      { vaultId: vault.id, rule: { cadence, amountKobo, enabled } },
      {
        onSuccess: () => {
          Alert.alert('Auto-save updated', enabled ? `We'll save ${formatNaira(amountKobo)} ${cadence}.` : 'Auto-save turned off.', [
            { text: 'Done', onPress: () => router.back() },
          ]);
        },
        onError: (e) => Alert.alert('Could not update', (e as Error).message),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Auto-save" subtitle={vault.name} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, shadow1]}>
          <Text style={styles.vName}>{vault.name}</Text>
          <View style={styles.progressRow}>
            <Text style={styles.saved}>{formatNaira(vault.savedKobo)}</Text>
            <Text style={styles.target}>of {formatNaira(vault.targetKobo)}</Text>
          </View>
          <ProgressBar pct={pct} style={{ marginTop: 4 }} />
        </View>

        <View style={[styles.toggleRow, shadow1]}>
          <View style={styles.toggleIcon}><Repeat size={18} color={Colors.secondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Automatic saving</Text>
            <Text style={styles.toggleHint}>Move money into this vault on a schedule.</Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} thumbColor={Colors.white} />
        </View>

        {enabled ? (
          <>
            <Text style={styles.section}>How often</Text>
            <View style={styles.cadenceRow}>
              {AUTOSAVE_CADENCES.filter((c) => c.value !== 'manual').map((c) => {
                const active = cadence === c.value;
                return (
                  <Pressable key={c.value} style={[styles.cadenceChip, active && styles.cadenceActive]} onPress={() => setCadence(c.value as 'weekly' | 'monthly')}>
                    <Text style={[styles.cadenceText, active && styles.cadenceTextActive]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.section}>Amount each time</Text>
            <TextInputField placeholder="e.g. 15000" value={amount} onChangeText={(v) => setAmount(sanitizeMoneyInput(v))} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} leftIcon={<Text style={styles.naira}>₦</Text>} />
          </>
        ) : null}

        <PrimaryButton label="Save rule" onPress={onSave} loading={update.isPending} style={{ marginTop: Spacing.md }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  vName: { ...Typography.titleMd, color: Colors.onSurface },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: Spacing.sm },
  saved: { ...Typography.titleLg, color: Colors.primary },
  target: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  toggleIcon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue },
  toggleLabel: { ...Typography.labelLg, color: Colors.onSurface },
  toggleHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  cadenceRow: { flexDirection: 'row', gap: Spacing.sm },
  cadenceChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  cadenceActive: { backgroundColor: Colors.primary },
  cadenceText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  cadenceTextActive: { color: Colors.onPrimary },
  naira: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
});
