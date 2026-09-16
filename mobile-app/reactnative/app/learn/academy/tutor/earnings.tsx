import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Wallet, Landmark, CheckCircle2, Clock, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { formatNaira, formatDate } from '@/features/academy/constants';
import { sanitizeMoneyInput } from '@/utils/money';
import { useTutorEarnings, useTutorMe, useRequestPayout } from '@/features/academy/hooks';

/**
 * T7 — Earnings & payouts. Earnings ledger + request payout on the payout rail.
 * Fail-closed: payouts require KYC verification (verifyState === 'verified').
 */
export default function TutorEarnings() {
  const earnings = useTutorEarnings();
  const me = useTutorMe();
  const payout = useRequestPayout();

  const [show, setShow] = useState(false);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (earnings.isLoading || me.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading earnings…" /></SafeAreaView>;
  if (!earnings.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Earnings" /><StateView kind="error" title="Could not load earnings" /></SafeAreaView>;

  const e = earnings.data;
  const verified = me.data?.verifyState === 'verified';
  const methods = me.data?.payoutMethods ?? [];
  const defaultMethod = methodId ?? methods.find((m) => m.isDefault)?.id ?? methods[0]?.id;
  const amountKobo = Math.max(0, Math.round(Number(amount) || 0) * 100);

  const withdraw = () => {
    setError(null);
    payout.mutate(
      { amountKobo, methodId: defaultMethod },
      {
        onSuccess: (r) => { setDone(`${formatNaira(r.amountKobo)} on its way to ${r.method.label}. ${r.expectedSettlement}`); setShow(false); setAmount(''); },
        onError: (err) => setError(err instanceof Error ? err.message : 'Payout failed'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings & payouts" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Balance card */}
        <View style={[styles.balanceCard, shadow1]}>
          <Text style={styles.balanceLabel}>Available to withdraw</Text>
          <Text style={styles.balanceAmount}>{formatNaira(e.availableKobo)}</Text>
          <View style={styles.balanceMeta}>
            <View style={styles.metaItem}><Clock size={12} color={Colors.onSurfaceVariant} /><Text style={styles.metaText}>Pending {formatNaira(e.pendingKobo)}</Text></View>
            <View style={styles.metaItem}><CheckCircle2 size={12} color={Colors.onSurfaceVariant} /><Text style={styles.metaText}>Lifetime {formatNaira(e.lifetimeKobo)}</Text></View>
          </View>
        </View>

        {/* Verification gate */}
        {!verified ? (
          <Pressable style={[styles.gate, shadow1]} onPress={() => router.push('/learn/academy/tutor/onboard')}>
            <ShieldAlert size={18} color={Colors.onWarning} />
            <Text style={styles.gateText}>Finish verification (KYC) to unlock payouts. Tap to check status.</Text>
          </Pressable>
        ) : (
          <PrimaryButton label={show ? 'Hide payout' : 'Request payout'} onPress={() => { setShow((s) => !s); setDone(null); }} />
        )}

        {/* Withdraw composer */}
        {show && verified ? (
          <View style={[styles.composer, shadow1]}>
            <Text style={styles.composerTitle}>Withdraw</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} placeholder={`Amount (min ${formatNaira(e.minPayoutKobo)})`} placeholderTextColor={Colors.onSurfaceVariant} value={amount} onChangeText={(v) => setAmount(sanitizeMoneyInput(v))} />
            <Text style={styles.fieldLabel}>To</Text>
            {methods.map((m) => {
              const on = defaultMethod === m.id;
              const Icon = m.kind === 'wallet' ? Wallet : Landmark;
              return (
                <Pressable key={m.id} style={[styles.method, on && styles.methodActive]} onPress={() => setMethodId(m.id)}>
                  <Icon size={18} color={on ? Colors.primary : Colors.onSurfaceVariant} />
                  <Text style={styles.methodLabel}>{m.label}</Text>
                </Pressable>
              );
            })}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label={`Withdraw ${amountKobo > 0 ? formatNaira(amountKobo) : ''}`.trim()} onPress={withdraw} loading={payout.isPending} disabled={amountKobo < e.minPayoutKobo} />
          </View>
        ) : null}

        {done ? <View style={[styles.banner, shadow1]}><CheckCircle2 size={16} color={Colors.teal} /><Text style={styles.bannerText}>{done}</Text></View> : null}

        {/* Ledger */}
        <Text style={styles.section}>Earnings ledger</Text>
        {e.ledger.map((l) => {
          const credit = l.amountKobo >= 0;
          return (
            <View key={l.id} style={[styles.row, shadow1]}>
              <View style={[styles.rowIcon, { backgroundColor: credit ? Colors.iconBgTeal : Colors.iconBgGold }]}>
                {credit ? <ArrowDownLeft size={16} color={Colors.teal} /> : <ArrowUpRight size={16} color={Colors.onWarning} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel} numberOfLines={1}>{l.label}</Text>
                <Text style={styles.rowSub}>{formatDate(l.ts)} · {l.settled ? 'Settled' : 'Pending'}</Text>
              </View>
              <Text style={[styles.rowAmount, { color: credit ? Colors.teal : Colors.onSurface }]}>{credit ? '+' : ''}{formatNaira(l.amountKobo)}</Text>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  balanceCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', gap: 2 },
  balanceLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  balanceAmount: { ...Typography.displayLg, color: Colors.primary, fontSize: 36, letterSpacing: -0.72, lineHeight: 42 },
  balanceMeta: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  gate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md },
  gateText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  composer: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  composerTitle: { ...Typography.titleMd, color: Colors.onSurface },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 48, color: Colors.onSurface, ...Typography.bodyMd },
  fieldLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  method: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  methodActive: { borderColor: Colors.primary },
  methodLabel: { ...Typography.labelMd, color: Colors.onSurface },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurface },
  rowSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowAmount: { ...Typography.labelLg, fontWeight: '700' },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
});
