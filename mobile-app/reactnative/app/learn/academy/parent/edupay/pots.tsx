import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PiggyBank, Plus, X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { usePots, useCreatePot, useFundPot, usePayFromPot, useFeeSchedules, useWallet } from '@/features/academy/hooks';
import { formatNaira } from '@/features/academy/constants';
import { sanitizeMoneyInput } from '@/utils/money';
import type { SavingsPot } from '@/features/academy/types';

const FUND_PRESETS = [500000, 1000000, 2500000, 5000000]; // kobo
const CADENCES: { value: SavingsPot['cadence']; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/** P10 — Save-for-school pots: goal savings toward fees. Create, fund, pay-out. */
export default function PotsScreen() {
  const pots = usePots();
  const fees = useFeeSchedules();
  const wallet = useWallet();
  const createPot = useCreatePot();
  const fundPot = useFundPot();
  const payFromPot = usePayFromPot();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [feeId, setFeeId] = useState<string | undefined>(undefined);
  const [cadence, setCadence] = useState<SavingsPot['cadence']>('monthly');
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800); };

  const submitCreate = () => {
    const targetKobo = Math.round(parseFloat(target.replace(/[^\d.]/g, '') || '0') * 100);
    if (!name.trim() || targetKobo <= 0) return;
    createPot.mutate(
      { name: name.trim(), targetKobo, feeScheduleId: feeId, cadence },
      { onSuccess: () => { setCreating(false); setName(''); setTarget(''); setFeeId(undefined); flash('Pot created'); } },
    );
  };

  if (pots.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading pots…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Save for school"
        rightSlot={
          <Pressable onPress={() => setCreating((c) => !c)} hitSlop={8} accessibilityLabel="New pot">
            {creating ? <X size={22} color={Colors.onSurface} /> : <Plus size={22} color={Colors.onSurface} />}
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Create form */}
        {creating ? (
          <View style={[styles.createCard, shadow1]}>
            <Text style={styles.createTitle}>New savings pot</Text>
            <TextInputField label="Pot name" placeholder="e.g. SSS3 fees" value={name} onChangeText={setName} />
            <TextInputField label="Target amount (₦)" placeholder="13000" value={target} onChangeText={(v) => setTarget(sanitizeMoneyInput(v))} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />
            <Text style={styles.fieldLabel}>Earmark for a fee schedule (optional)</Text>
            <View style={styles.chipRow}>
              {fees.data?.map((f) => (
                <Pressable key={f.id} onPress={() => setFeeId(feeId === f.id ? undefined : f.id)} style={[styles.chip, feeId === f.id && styles.chipActive]}>
                  <Text style={[styles.chipText, feeId === f.id && styles.chipTextActive]}>{f.schoolName}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Auto-save cadence</Text>
            <View style={styles.chipRow}>
              {CADENCES.map((c) => (
                <Pressable key={c.value} onPress={() => setCadence(c.value)} style={[styles.chip, cadence === c.value && styles.chipActive]}>
                  <Text style={[styles.chipText, cadence === c.value && styles.chipTextActive]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            <PrimaryButton label="Create pot" onPress={submitCreate} loading={createPot.isPending} style={{ marginTop: Spacing.sm }} />
          </View>
        ) : null}

        {toast ? <View style={styles.toastRow}><Check size={14} color={Colors.teal} strokeWidth={3} /><Text style={styles.toastText}>{toast}</Text></View> : null}

        {/* Pots */}
        {pots.data?.length ? pots.data.map((p) => (
          <PotCard
            key={p.id}
            p={p}
            busy={fundPot.isPending || payFromPot.isPending}
            walletKobo={wallet.data?.spendableKobo ?? 0}
            onFund={(amt) => fundPot.mutate({ potId: p.id, amountKobo: amt }, { onSuccess: () => flash('Pot funded') })}
            onPayout={() => p.feeScheduleId && payFromPot.mutate({ potId: p.id, feeScheduleId: p.feeScheduleId }, { onSuccess: () => flash('Fees paid from pot'), onError: () => flash('Pot not yet full') })}
          />
        )) : !creating ? (
          <StateView kind="empty" icon="PiggyBank" title="No pots yet" message="Create a pot to start saving toward fees." compact />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PotCard({ p, busy, walletKobo, onFund, onPayout }: { p: SavingsPot; busy: boolean; walletKobo: number; onFund: (amt: number) => void; onPayout: () => void }) {
  const pct = Math.min(100, Math.round((p.savedKobo / (p.targetKobo || 1)) * 100));
  const full = p.savedKobo >= p.targetKobo;
  return (
    <View style={[styles.potCard, shadow1]}>
      <View style={styles.potTop}>
        <View style={styles.potIcon}><PiggyBank size={18} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.potName}>{p.name}</Text>
          {p.schoolName ? <Text style={styles.potMeta}>For {p.schoolName} · {p.cadence}</Text> : <Text style={styles.potMeta}>{p.cadence} auto-save</Text>}
        </View>
        <Text style={styles.potPct}>{pct}%</Text>
      </View>
      <ProgressBar pct={pct} color={full ? Colors.teal : Colors.primary} style={{ marginTop: Spacing.sm }} />
      <Text style={styles.potAmounts}>{formatNaira(p.savedKobo)} of {formatNaira(p.targetKobo)}</Text>

      {/* Fund presets */}
      <View style={styles.fundRow}>
        {FUND_PRESETS.map((amt) => (
          <Pressable key={amt} style={[styles.fundBtn, walletKobo < amt && styles.fundBtnDisabled]} disabled={busy || walletKobo < amt} onPress={() => onFund(amt)}>
            <Text style={styles.fundText}>+{formatNaira(amt)}</Text>
          </Pressable>
        ))}
      </View>

      {p.feeScheduleId ? (
        <Pressable style={[styles.payoutBtn, !full && styles.payoutDisabled]} disabled={!full || busy} onPress={onPayout}>
          <Text style={[styles.payoutText, !full && { color: Colors.onSurfaceVariant }]}>{full ? 'Pay fees from this pot' : 'Reach target to pay out'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  createCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  createTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  toastText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
  potCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  potTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  potIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  potName: { ...Typography.titleMd, color: Colors.onSurface },
  potMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  potPct: { ...Typography.titleLg, color: Colors.primary },
  potAmounts: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 6 },
  fundRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  fundBtn: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.secondary },
  fundBtnDisabled: { opacity: 0.4, borderColor: Colors.outlineVariant },
  fundText: { ...Typography.labelMd, color: Colors.secondary },
  payoutBtn: { marginTop: Spacing.md, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center' },
  payoutDisabled: { backgroundColor: Colors.surfaceContainerHigh },
  payoutText: { ...Typography.labelLg, color: Colors.white },
});
