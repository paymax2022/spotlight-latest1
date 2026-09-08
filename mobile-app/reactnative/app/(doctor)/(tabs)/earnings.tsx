import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, Clock, X, ArrowDownToLine, Landmark, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import { formatKobo } from '@/api/doctor.batch6.api';
import { useEarningsBreakdown, useWalletBalance, useWithdrawEarnings } from '@/features/doctor/hooks';
import { StatCard, StateView, EarningsSourceBar } from '@/features/doctor/components';
import {
  EARNINGS_PERIOD_OPTIONS,
  EARNINGS_SOURCE_LABELS,
  EARNINGS_SOURCE_TONES,
} from '@/features/doctor/constants';
import type { EarningsPeriod, WalletLedgerEntry } from '@/types/doctor.batch6';

export default function DoctorEarningsScreen() {
  const { data: breakdown, isLoading: bLoading, isError: bError, refetch: bRefetch } = useEarningsBreakdown();
  const { data: wallet, isLoading: wLoading } = useWalletBalance();
  const withdraw = useWithdrawEarnings();

  const [period, setPeriod] = useState<EarningsPeriod>('today');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');

  const selected = useMemo(
    () => breakdown?.periods.find((p) => p.period === period),
    [breakdown, period],
  );
  const maxSource = useMemo(
    () => Math.max(1, ...(selected?.bySource.map((s) => s.amountKobo) ?? [1])),
    [selected],
  );

  const handleWithdraw = async () => {
    const naira = Number(amount.replace(/[^0-9.]/g, ''));
    const amountKobo = Math.round(naira * 100);
    if (!wallet || amountKobo <= 0) { Alert.alert('Enter an amount', 'Enter a valid amount to withdraw.'); return; }
    if (amountKobo > wallet.availableKobo) { Alert.alert('Amount too high', 'You cannot withdraw more than your available balance.'); return; }
    try {
      const res = await withdraw.mutateAsync({ amountKobo });
      setWithdrawOpen(false); setAmount('');
      Alert.alert('Withdrawal requested', `Payout ${res.ref} (${formatKobo(amountKobo)}) is ${res.status}.`);
    } catch {
      Alert.alert('Withdrawal failed', 'Please try again in a moment.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Earnings</Text>
      </View>

      {bLoading && !breakdown ? (
        <StateView variant="loading" label="Loading earnings" />
      ) : bError || !breakdown ? (
        <StateView variant="error" message="We could not load your earnings." onRetry={() => bRefetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Wallet hero */}
          <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.balanceCard, shadow2]}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balanceValue}>{wLoading && !wallet ? '—' : formatKobo(wallet?.availableKobo ?? 0)}</Text>
            <Text style={styles.balanceSub}>Pending {formatKobo(wallet?.pendingKobo ?? 0)}</Text>
            <View style={styles.payoutBtnWrap}>
              <PrimaryButton
                label="Withdraw earnings"
                onPress={() => setWithdrawOpen(true)}
                disabled={!wallet || wallet.availableKobo <= 0}
              />
            </View>
          </LinearGradient>

          {/* Period totals */}
          <View style={styles.statsRow}>
            <StatCard icon={Clock} label="Today" value={formatKobo(breakdown.todayKobo)} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
            <StatCard icon={Wallet} label="This month" value={formatKobo(breakdown.monthKobo)} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} />
          </View>

          {/* Period toggle */}
          <View style={styles.periodRow}>
            {EARNINGS_PERIOD_OPTIONS.map((opt) => {
              const active = period === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setPeriod(opt.value)}
                  style={[styles.periodChip, active && styles.periodChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${opt.label}`}
                >
                  <Text style={[styles.periodText, active && styles.periodTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Source breakdown */}
          <SectionHeader title="By source" style={styles.sectionGap} />
          <View style={[styles.sourceCard, shadow1]}>
            <Text style={styles.gross}>{formatKobo(selected?.grossKobo ?? 0)}</Text>
            <Text style={styles.grossLabel}>Gross earnings</Text>
            {selected && selected.bySource.length > 0 ? (
              selected.bySource.map((s) => (
                <EarningsSourceBar
                  key={s.source}
                  label={EARNINGS_SOURCE_LABELS[s.source]}
                  amountKobo={s.amountKobo}
                  maxKobo={maxSource}
                  consultCount={s.consultCount}
                  tint={EARNINGS_SOURCE_TONES[s.source]}
                  formatValue={formatKobo}
                />
              ))
            ) : (
              <Text style={styles.muted}>No earnings in this period.</Text>
            )}
          </View>

          {/* Quick links */}
          <SectionHeader title="Wallet & payouts" style={styles.sectionGap} />
          <View style={styles.list}>
            <QuickLink icon={ArrowDownToLine} label="Payout history & report" onPress={() => router.push('/(doctor)/earnings/report')} />
            <QuickLink icon={Landmark} label="Bank account" onPress={() => router.push('/(doctor)/earnings/bank-account')} />
            <QuickLink icon={FileText} label="Invoices & tax report" onPress={() => router.push('/(doctor)/earnings/report')} />
          </View>

          {/* Wallet ledger */}
          <SectionHeader title="Recent activity" style={styles.sectionGap} />
          {!wallet || wallet.ledger.length === 0 ? (
            <StateView variant="empty" icon={Wallet} title="No activity" message="Your wallet activity will appear here." />
          ) : (
            <View style={styles.list}>
              {wallet.ledger.map((e) => <LedgerRow key={e.id} entry={e} />)}
            </View>
          )}
        </ScrollView>
      )}

      {/* Withdraw sheet */}
      <Modal visible={withdrawOpen} transparent animationType="slide" onRequestClose={() => setWithdrawOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setWithdrawOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <ArrowDownToLine size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Withdraw earnings</Text>
            </View>
            <Pressable onPress={() => setWithdrawOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close withdraw sheet">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={styles.sheetMeta}>Available {formatKobo(wallet?.availableKobo ?? 0)}</Text>
          <TextInputField label="Amount (₦)" placeholder="0.00" value={amount} onChangeText={(v) => setAmount(sanitizeMoneyInput(v))} keyboardType="decimal-pad" maxLength={13} />
          <PrimaryButton label="Request withdrawal" onPress={handleWithdraw} loading={withdraw.isPending} style={styles.sheetBtn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function QuickLink({ icon: Icon, label, onPress }: { icon: typeof Wallet; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.linkRow, shadow1]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.linkIcon, { backgroundColor: Colors.iconBgPurple }]}>
        <Icon size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <Text style={styles.linkLabel}>{label}</Text>
    </Pressable>
  );
}

function LedgerRow({ entry }: { entry: WalletLedgerEntry }) {
  const credit = entry.amountKobo >= 0;
  const date = new Date(entry.at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <View style={styles.ledgerRow}>
      <View style={styles.ledgerBody}>
        <Text style={styles.ledgerLabel} numberOfLines={1}>{entry.label}</Text>
        <Text style={styles.ledgerMeta}>{date}</Text>
      </View>
      <Text style={[styles.ledgerAmount, { color: credit ? Colors.teal : Colors.onSurface }]}>
        {credit ? '+' : '-'}{formatKobo(Math.abs(entry.amountKobo))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  header:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:         { ...Typography.headlineMd, color: Colors.onSurface },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  balanceCard:   { borderRadius: Radius.xl, padding: Spacing.cardPadding, marginBottom: Spacing.lg, gap: 2 },
  balanceLabel:  { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  balanceValue:  { ...Typography.displayLg, fontSize: 36, letterSpacing: -0.72, lineHeight: 44, color: Colors.onPrimary },
  balanceSub:    { ...Typography.labelMd, color: 'rgba(255,255,255,0.85)' },
  payoutBtnWrap: { marginTop: Spacing.md },
  statsRow:      { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  periodRow:     { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  periodChip:    { flex: 1, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  periodChipActive:{ backgroundColor: Colors.primary, borderColor: Colors.primary },
  periodText:    { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '600' },
  periodTextActive:{ color: Colors.onPrimary },
  sectionGap:    { marginTop: Spacing.md, paddingHorizontal: 0 },
  sourceCard:    { borderRadius: Radius.lg, padding: Spacing.cardPadding, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.xs },
  gross:         { ...Typography.headlineMd, color: Colors.onSurface },
  grossLabel:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  muted:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  list:          { gap: Spacing.sm },
  linkRow:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  linkIcon:      { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  linkLabel:     { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  ledgerRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  ledgerBody:    { flex: 1, gap: 2 },
  ledgerLabel:   { ...Typography.labelLg, color: Colors.onSurface },
  ledgerMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  ledgerAmount:  { ...Typography.titleMd, fontWeight: '700' },
  backdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:         { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, gap: Spacing.sm },
  sheetHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.sm },
  sheetHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sheetTitle:    { ...Typography.titleMd, color: Colors.onSurface },
  sheetMeta:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sheetBtn:      { marginTop: Spacing.sm },
});
