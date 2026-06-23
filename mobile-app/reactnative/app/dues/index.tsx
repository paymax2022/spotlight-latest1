import React, { useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useInvoices, usePayInvoice } from '@/features/dues/hooks';
import { CATEGORY_META, STATUS_META } from '@/features/dues/api';
import { formatNairaFromKobo } from '@/features/visitor/utils/visitorFormatters';
import type { DuesInvoice, DuesCategory } from '@/features/dues/api';

export default function DuesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useInvoices();
  const pay = usePayInvoice();

  const outstanding = useMemo(() => (data ?? []).filter((i) => i.status === 'pending' || i.status === 'overdue').reduce((s, i) => s + i.amountKobo, 0), [data]);

  const onPay = (inv: DuesInvoice) => Alert.alert(
    'Pay from wallet?',
    `${CATEGORY_META[inv.category as DuesCategory]?.label ?? 'Dues'} — ${formatNairaFromKobo(inv.amountKobo)}`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay now', onPress: () => pay.mutate(inv.id, { onError: (e) => Alert.alert('Payment failed', e instanceof Error ? e.message : 'Please try again.') }) },
    ],
  );

  const renderItem = ({ item }: { item: DuesInvoice }) => {
    const cat = CATEGORY_META[item.category as DuesCategory] ?? CATEGORY_META.other;
    const st = STATUS_META[item.status];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[cat.icon] ?? Icons.Receipt;
    const payable = item.status === 'pending' || item.status === 'overdue';
    const isPaying = pay.isPending && pay.variables === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.iconBox}><Icon size={20} color={Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{cat.label}</Text>
            <View style={[styles.chip, { backgroundColor: st.bg }]}><Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text></View>
          </View>
          <Text style={styles.amount}>{formatNairaFromKobo(item.amountKobo)}</Text>
          <Text style={styles.meta}>Due {new Date(item.dueDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </View>
        {payable ? (
          <Pressable onPress={() => onPay(item)} accessibilityRole="button" disabled={isPaying} style={({ pressed }) => [styles.payBtn, pressed && { opacity: 0.85 }, isPaying && styles.payBtnDisabled]}>
            <Text style={styles.payText}>{isPaying ? '…' : 'Pay'}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Dues & Rent" />
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Outstanding balance</Text>
        <Text style={styles.summaryValue}>{formatNairaFromKobo(outstanding)}</Text>
      </View>
      {isLoading ? <StateView kind="loading" message="Loading invoices…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={data ?? []} keyExtractor={(i) => i.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="ReceiptText" title="No dues" message="You're all settled up." />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  summary: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, ...shadow1 },
  summaryLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  summaryValue: { ...Typography.displayLg, color: Colors.onPrimary, marginTop: 4 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  payBtn: { paddingHorizontal: Spacing.lg, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  payBtnDisabled: { opacity: 0.6 },
  payText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' },
});
