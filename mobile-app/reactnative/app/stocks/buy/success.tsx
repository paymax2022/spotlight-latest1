import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useStock } from '@/features/stocks/hooks/useStocks';
import { formatMoney, formatShares } from '@/features/stocks/utils/stockFormatters';

export default function StockBuySuccessScreen() {
  const p = useLocalSearchParams<{
    reference: string; symbol: string; quantity: string; total: string;
    status: string; orderType: string; txId: string;
  }>();
  const asset = useStock(p.symbol);
  const currency = asset.data?.currency ?? 'NGN';
  const filled = p.status === 'Filled';

  const title = filled ? 'Order filled 🎉' : 'Order placed — pending';
  const sub = filled
    ? `You bought ${formatShares(Number(p.quantity))} of ${p.symbol} for ${formatMoney(Number(p.total), currency)}. It's now in your stock portfolio.`
    : `Your order to buy ${formatShares(Number(p.quantity))} of ${p.symbol} is working. We'll update your portfolio once it fills and settles.`;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={2} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>

        <View style={styles.refCard}>
          <Text style={styles.refText}>Reference · {p.reference}</Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.receiptBtn} onPress={() => router.replace(`/stocks/orders/${p.txId}`)} accessibilityRole="button">
          <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.receiptText}>View order</Text>
        </Pressable>
        <PrimaryButton label="Done" onPress={() => router.dismissTo('/stocks')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  refCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, marginTop: Spacing.sm },
  refText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  receiptText: { ...Typography.labelLg, color: Colors.secondary },
});
