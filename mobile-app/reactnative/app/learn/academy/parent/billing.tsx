import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CreditCard, Receipt, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useSubscriptions, useInvoices } from '@/features/academy/hooks';
import { formatNaira, formatDate } from '@/features/academy/constants';

/** P12 — Billing & subscriptions: active plans, payment methods, invoices. */
export default function BillingScreen() {
  const subs = useSubscriptions();
  const invoices = useInvoices();

  if (subs.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading billing…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Billing & subscriptions" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Active subscriptions</Text>
        {subs.data?.map((s) => (
          <View key={s.id} style={[styles.card, shadow1]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planName}>{s.planName}</Text>
                <Text style={styles.planSub}>{s.childNames.join(', ')} · {s.period}</Text>
              </View>
              <Chip
                label={s.status === 'active' ? 'Active' : s.status === 'past_due' ? 'Past due' : 'Cancelled'}
                color={s.status === 'active' ? Colors.teal : s.status === 'past_due' ? Colors.error : Colors.onSurfaceVariant}
                bg={s.status === 'active' ? Colors.iconBgTeal : s.status === 'past_due' ? Colors.errorContainer : Colors.surfaceContainerHigh}
                small
              />
            </View>
            <View style={styles.planFoot}>
              <View style={styles.renewRow}><RefreshCw size={13} color={Colors.onSurfaceVariant} /><Text style={styles.renewText}>Renews {formatDate(s.renewsAt)}</Text></View>
              <Text style={styles.price}>{s.priceKobo === 0 ? 'Free' : `${formatNaira(s.priceKobo)}/${s.period === 'monthly' ? 'mo' : 'term'}`}</Text>
            </View>
          </View>
        ))}

        {/* Payment method (W8 concept, parent surface) */}
        <Text style={styles.section}>Payment method</Text>
        <View style={[styles.card, shadow1]}>
          <View style={styles.methodRow}>
            <View style={styles.methodIcon}><CreditCard size={18} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Spotlight Wallet</Text>
              <Text style={styles.methodSub}>Default · used for plans & EduPay</Text>
            </View>
            <Chip label="Default" color={Colors.secondary} bg={Colors.iconBgBlue} small />
          </View>
        </View>

        <Text style={styles.section}>Invoices</Text>
        {invoices.data?.map((inv) => (
          <Pressable key={inv.id} style={[styles.invRow, shadow1]}>
            <View style={styles.invIcon}><Receipt size={16} color={Colors.onSurfaceVariant} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.invLabel}>{inv.label}</Text>
              <Text style={styles.invTs}>{formatDate(inv.ts)}</Text>
            </View>
            <Text style={styles.invAmount}>{formatNaira(inv.amountKobo)}</Text>
            <Chip
              label={inv.status === 'paid' ? 'Paid' : inv.status === 'due' ? 'Due' : 'Failed'}
              color={inv.status === 'paid' ? Colors.teal : inv.status === 'due' ? Colors.onWarning : Colors.error}
              bg={inv.status === 'paid' ? Colors.iconBgTeal : inv.status === 'due' ? Colors.iconBgGold : Colors.errorContainer}
              small
            />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  planName: { ...Typography.titleMd, color: Colors.onSurface },
  planSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  planFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  renewRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  renewText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  price: { ...Typography.labelLg, color: Colors.primary },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  methodIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  methodTitle: { ...Typography.labelLg, color: Colors.onSurface },
  methodSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  invRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  invIcon: { width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  invLabel: { ...Typography.labelMd, color: Colors.onSurface },
  invTs: { ...Typography.caption, color: Colors.onSurfaceVariant },
  invAmount: { ...Typography.labelMd, color: Colors.onSurface },
});
