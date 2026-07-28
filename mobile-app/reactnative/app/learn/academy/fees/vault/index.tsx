import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { PiggyBank, Plus, Repeat, Target, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { formatNaira } from '@/features/academy/constants';
import { AUTOSAVE_CADENCES } from '@/features/academy/fees/constants';
import {
  useVaults, useFundVault, useCreateVault, useFeesChildren,
} from '@/features/academy/fees/hooks';
import type { FeesVault } from '@/features/academy/fees/types';

/** PA-07 — Fees vault home: segregated savings pots with progress to target (SF-5). */
export default function FeesVaultHome() {
  const vaults = useVaults();
  const children = useFeesChildren();
  const fund = useFundVault();
  const create = useCreateVault();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [childName, setChildName] = useState('');
  const [cadence, setCadence] = useState<'manual' | 'weekly' | 'monthly'>('monthly');

  if (vaults.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Fees vault" />
        <StateView kind="loading" message="Loading vaults…" />
      </SafeAreaView>
    );
  }

  const list = vaults.data ?? [];
  const totalSaved = list.reduce((s, v) => s + v.savedKobo, 0);
  const totalTarget = list.reduce((s, v) => s + v.targetKobo, 0);
  const kidOptions = (children.data ?? []).map((c) => `${c.firstName} ${c.lastName}`);

  const onQuickFund = (v: FeesVault) => {
    Alert.prompt?.('Save to vault', `Add to "${v.name}" (₦)`, (val) => {
      const kobo = Math.round((parseFloat(val || '') || 0) * 100);
      if (kobo > 0) fund.mutate({ vaultId: v.id, amountKobo: kobo }, { onError: (e) => Alert.alert('Could not save', (e as Error).message) });
    }, 'plain-text', '', 'numeric');
    // Fallback when Alert.prompt is unavailable (Android): route to auto-save screen.
    if (!Alert.prompt) router.push(`/learn/academy/fees/vault/auto-save/${v.id}`);
  };

  const onCreate = () => {
    const targetKobo = Math.round((parseFloat(target) || 0) * 100);
    if (name.trim().length < 3 || targetKobo <= 0) {
      Alert.alert('Add details', 'Give the vault a name and a target amount.');
      return;
    }
    const child = children.data?.find((c) => `${c.firstName} ${c.lastName}` === childName);
    create.mutate(
      { name: name.trim(), targetKobo, childId: child?.id, cadence, autoSaveKobo: cadence === 'manual' ? 0 : Math.round(targetKobo / 6) },
      {
        onSuccess: () => { setCreating(false); setName(''); setTarget(''); setChildName(''); setCadence('monthly'); },
        onError: (e) => Alert.alert('Could not create vault', (e as Error).message),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Fees vault"
        subtitle="Save ahead for fees"
        rightSlot={<Pressable onPress={() => setCreating((v) => !v)} hitSlop={8}><Plus size={22} color={Colors.primary} /></Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Total */}
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.total, shadow3]}>
          <PiggyBank size={22} color={Colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.totalKicker}>TOTAL SAVED</Text>
            <Text style={styles.totalAmount}>{formatNaira(totalSaved)}</Text>
            <Text style={styles.totalSub}>of {formatNaira(totalTarget)} across {list.length} vault{list.length === 1 ? '' : 's'}</Text>
          </View>
        </LinearGradient>

        {/* Create form */}
        {creating ? (
          <View style={[styles.createCard, shadow1]}>
            <Text style={styles.createTitle}>New vault</Text>
            <TextInputField label="Name" placeholder="e.g. Ada — next term" value={name} onChangeText={setName} />
            <TextInputField label="Target (₦)" placeholder="e.g. 130000" value={target} onChangeText={setTarget} keyboardType="numeric" />
            <SelectField label="For child (optional)" placeholder="Select a child" value={childName} options={kidOptions} onChange={setChildName} />
            <SelectField label="Auto-save" placeholder="Cadence" value={AUTOSAVE_CADENCES.find((c) => c.value === cadence)?.label} options={AUTOSAVE_CADENCES.map((c) => c.label)} onChange={(l) => setCadence(AUTOSAVE_CADENCES.find((c) => c.label === l)?.value ?? 'manual')} searchable={false} />
            <PrimaryButton label="Create vault" onPress={onCreate} loading={create.isPending} style={{ marginTop: Spacing.xs }} />
          </View>
        ) : null}

        {/* Vaults */}
        {list.length ? list.map((v) => <VaultCard key={v.id} v={v} onFund={() => onQuickFund(v)} funding={fund.isPending} />) : (
          !creating ? <StateView kind="empty" icon="PiggyBank" title="No vaults yet" message="Create a vault to save ahead for your child's fees." actionLabel="Create vault" onAction={() => setCreating(true)} compact /> : null
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function VaultCard({ v, onFund, funding }: { v: FeesVault; onFund: () => void; funding: boolean }) {
  const pct = v.targetKobo > 0 ? Math.round((v.savedKobo / v.targetKobo) * 100) : 0;
  const done = v.savedKobo >= v.targetKobo;
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.vTop}>
        <Text style={styles.vName} numberOfLines={1}>{v.name}</Text>
        {done ? <Chip label="Target met" color={Colors.teal} bg={Colors.iconBgTeal} small /> : v.autoSaveKobo > 0 ? <Chip label={`Auto ${v.cadence}`} color={Colors.secondary} bg={Colors.iconBgBlue} small /> : null}
      </View>
      {v.childName || v.schoolName ? <Text style={styles.vMeta}>{[v.childName, v.schoolName].filter(Boolean).join(' · ')}</Text> : null}

      <View style={styles.vAmountRow}>
        <Text style={styles.vSaved}>{formatNaira(v.savedKobo)}</Text>
        <View style={styles.vTargetRow}><Target size={12} color={Colors.onSurfaceVariant} /><Text style={styles.vTarget}>{formatNaira(v.targetKobo)}</Text></View>
      </View>
      <ProgressBar pct={pct} color={done ? Colors.teal : Colors.primary} style={{ marginTop: 4 }} />
      <Text style={styles.vPct}>{pct}% saved</Text>

      <View style={styles.vActions}>
        {!done ? (
          <Pressable style={styles.fundBtn} onPress={onFund} disabled={funding}>
            <Plus size={15} color={Colors.onPrimary} /><Text style={styles.fundText}>Add money</Text>
          </Pressable>
        ) : (
          <View style={styles.doneRow}><CheckCircle2 size={15} color={Colors.teal} /><Text style={styles.doneText}>Ready for fees</Text></View>
        )}
        <Pressable style={styles.autoBtn} onPress={() => router.push(`/learn/academy/fees/vault/auto-save/${v.id}`)}>
          <Repeat size={15} color={Colors.secondary} /><Text style={styles.autoText}>Auto-save</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  total: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  totalKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1, fontWeight: '700' },
  totalAmount: { ...Typography.headlineMd, color: Colors.onPrimary },
  totalSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  createCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  createTitle: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  vTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  vName: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  vMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  vAmountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: Spacing.sm },
  vSaved: { ...Typography.titleLg, color: Colors.primary },
  vTargetRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vTarget: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  vPct: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  vActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  fundBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  fundText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
  autoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue },
  autoText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
});
