import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatNaira, formatDate } from '@/features/academy/constants';
import { PAYMENT_METHODS } from '@/features/academy/fees/constants';
import { useReceipts } from '@/features/academy/fees/hooks';
import type { Receipt } from '@/features/academy/fees/types';

/** PA-09 — Payment history & receipts. */
export default function FeesReceipts() {
  const receipts = useReceipts();

  if (receipts.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Receipts" />
        <StateView kind="loading" message="Loading receipts…" />
      </SafeAreaView>
    );
  }

  const list = receipts.data ?? [];
  const total = list.reduce((s, r) => s + r.amountKobo, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receipts" subtitle="Payment history" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {list.length ? (
          <>
            <View style={[styles.summary, shadow1]}>
              <Text style={styles.summaryLabel}>Paid all-time</Text>
              <Text style={styles.summaryAmount}>{formatNaira(total)}</Text>
              <Text style={styles.summarySub}>{list.length} payment{list.length === 1 ? '' : 's'}</Text>
            </View>
            {list.map((r) => <ReceiptRow key={r.id} r={r} />)}
          </>
        ) : (
          <StateView kind="empty" icon="ReceiptText" title="No receipts yet" message="Your fee payments and receipts will appear here." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReceiptRow({ r }: { r: Receipt }) {
  const method = PAYMENT_METHODS.find((m) => m.value === r.method);
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[method?.icon ?? 'Wallet'] ?? Icons.Wallet;
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.iconWrap}><Icon size={18} color={Colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{r.schoolName}</Text>
        <Text style={styles.meta}>{r.childName} · {r.term}</Text>
        <Text style={styles.ref}>Ref {r.reference} · {formatDate(r.paidAt)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>{formatNaira(r.amountKobo)}</Text>
        <Pressable style={styles.dl} hitSlop={8} onPress={() => Alert.alert('Receipt', `Downloading receipt ${r.id}…`)}>
          <Download size={14} color={Colors.secondary} /><Text style={styles.dlText}>PDF</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  summaryLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  summaryAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  summarySub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ref: { ...Typography.caption, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.titleMd, color: Colors.teal },
  dl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dlText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' },
});
