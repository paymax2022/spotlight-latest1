import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Wallet, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow2 } from '@/constants/shadows';
import { formatKobo } from '@/api/doctor.batch6.api';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, PayoutDetailRow, InvoiceRow, EarningsSourceBar } from '@/features/doctor/components';
import {
  usePayoutDetails,
  useCommissionBreakdown,
  useTaxVatReport,
  useInvoices,
} from '@/features/doctor/hooks';
import {
  PAYOUT_DETAIL_STATUS_LABELS,
  PAYOUT_DETAIL_STATUS_TONES,
  INVOICE_STATUS_LABELS,
  EARNINGS_SOURCE_LABELS,
  EARNINGS_SOURCE_TONES,
} from '@/features/doctor/constants';

type Tab = 'payouts' | 'commission' | 'tax' | 'invoices';
const TABS: { value: Tab; label: string }[] = [
  { value: 'payouts',    label: 'Payouts' },
  { value: 'commission', label: 'Commission' },
  { value: 'tax',        label: 'Tax/VAT' },
  { value: 'invoices',   label: 'Invoices' },
];

export default function EarningsReportScreen() {
  const [tab, setTab] = useState<Tab>('payouts');

  const payouts = usePayoutDetails();
  const commission = useCommissionBreakdown();
  const tax = useTaxVatReport();
  const invoices = useInvoices();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Earnings Report" />

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.value;
          return (
            <Pressable key={t.value} onPress={() => setTab(t.value)} style={[styles.tab, active && styles.tabActive]} accessibilityRole="button" accessibilityLabel={t.label}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tab === 'payouts' && (
          payouts.isLoading && !payouts.data ? (
            <StateView variant="loading" label="Loading payouts" />
          ) : payouts.isError ? (
            <StateView variant="error" message="We could not load payouts." onRetry={() => payouts.refetch()} />
          ) : !payouts.data || payouts.data.length === 0 ? (
            <StateView variant="empty" icon={Wallet} title="No payouts" message="Your payouts will appear here." />
          ) : (
            <View style={styles.list}>
              {payouts.data.map((p) => (
                <PayoutDetailRow
                  key={p.id}
                  payoutRef={p.ref}
                  periodLabel={p.periodLabel}
                  consultCount={p.consultCount}
                  amount={formatKobo(p.netKobo)}
                  statusLabel={PAYOUT_DETAIL_STATUS_LABELS[p.status]}
                  statusTone={PAYOUT_DETAIL_STATUS_TONES[p.status]}
                  failed={p.status === 'failed'}
                  onPress={() => router.push(`/(doctor)/earnings/payout/${p.id}`)}
                />
              ))}
            </View>
          )
        )}

        {tab === 'commission' && (
          commission.isLoading && !commission.data ? (
            <StateView variant="loading" label="Loading commission" />
          ) : commission.isError || !commission.data ? (
            <StateView variant="error" message="We could not load the commission breakdown." onRetry={() => commission.refetch()} />
          ) : (
            <>
              <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow2]}>
                <Text style={styles.heroLabel}>Net after commission · {commission.data.rangeLabel}</Text>
                <Text style={styles.heroValue}>{formatKobo(commission.data.netKobo)}</Text>
              </LinearGradient>
              <SectionCard title="Summary" style={styles.card}>
                <InfoRow label="Gross earnings" value={formatKobo(commission.data.grossKobo)} />
                <InfoRow label="Commission" value={`- ${formatKobo(commission.data.commissionKobo)}`} valueColor={Colors.error} />
                <InfoRow label="Net" value={formatKobo(commission.data.netKobo)} valueColor={Colors.teal} />
              </SectionCard>
              <SectionCard title="By source" style={styles.card}>
                {commission.data.tiers.map((tier) => (
                  <View key={tier.source} style={styles.tier}>
                    <EarningsSourceBar
                      label={`${EARNINGS_SOURCE_LABELS[tier.source]} · ${tier.commissionRatePct}%`}
                      amountKobo={tier.netKobo}
                      maxKobo={commission.data.grossKobo}
                      tint={EARNINGS_SOURCE_TONES[tier.source]}
                      formatValue={formatKobo}
                    />
                    <Text style={styles.tierMeta}>Gross {formatKobo(tier.grossKobo)} · Comm {formatKobo(tier.commissionKobo)}</Text>
                  </View>
                ))}
              </SectionCard>
            </>
          )
        )}

        {tab === 'tax' && (
          tax.isLoading && !tax.data ? (
            <StateView variant="loading" label="Loading tax report" />
          ) : tax.isError || !tax.data ? (
            <StateView variant="error" message="We could not load the tax report." onRetry={() => tax.refetch()} />
          ) : (
            <>
              <SectionCard title={`Tax & VAT · ${tax.data.rangeLabel}`} style={styles.card}>
                <InfoRow label="Gross earnings" value={formatKobo(tax.data.grossKobo)} />
                <InfoRow label="VATable amount" value={formatKobo(tax.data.vatableKobo)} />
                <InfoRow label={`VAT (${tax.data.vatRatePct}%)`} value={formatKobo(tax.data.vatKobo)} valueColor={Colors.error} />
                <InfoRow label={`Withholding tax (${tax.data.whtRatePct}%)`} value={formatKobo(tax.data.whtKobo)} valueColor={Colors.error} />
              </SectionCard>
              <SectionCard title="Tax identifiers" style={styles.card}>
                <InfoRow label="TIN" value={tax.data.tin ?? 'Not set'} />
                <InfoRow label="VAT number" value={tax.data.vatNumber ?? 'Not set'} />
              </SectionCard>
            </>
          )
        )}

        {tab === 'invoices' && (
          invoices.isLoading && !invoices.data ? (
            <StateView variant="loading" label="Loading invoices" />
          ) : invoices.isError ? (
            <StateView variant="error" message="We could not load invoices." onRetry={() => invoices.refetch()} />
          ) : !invoices.data || invoices.data.length === 0 ? (
            <StateView variant="empty" icon={Receipt} title="No invoices" message="Your invoices will appear here." />
          ) : (
            <View style={styles.list}>
              {invoices.data.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  invoiceRef={inv.ref}
                  periodLabel={inv.periodLabel}
                  total={formatKobo(inv.totalKobo)}
                  statusLabel={INVOICE_STATUS_LABELS[inv.status]}
                  onPress={() => router.push(`/(doctor)/earnings/invoice/${inv.id}`)}
                />
              ))}
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  tabs:        { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  tab:         { flex: 1, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tabActive:   { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '600' },
  tabTextActive:{ color: Colors.onPrimary },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, paddingBottom: Platform.OS === 'ios' ? 40 : 24, flexGrow: 1 },
  hero:        { borderRadius: Radius.xl, padding: Spacing.cardPadding, marginBottom: Spacing.md, gap: Spacing.xs },
  heroLabel:   { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  heroValue:   { ...Typography.displayLg, fontSize: 32, letterSpacing: -0.64, lineHeight: 40, color: Colors.onPrimary },
  card:        { marginBottom: Spacing.md },
  list:        { gap: Spacing.sm },
  tier:        { gap: Spacing.xs, paddingVertical: Spacing.xs },
  tierMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
});
