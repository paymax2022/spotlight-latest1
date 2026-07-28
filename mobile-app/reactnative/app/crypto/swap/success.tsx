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
import { useAssets } from '@/features/crypto/hooks/useCrypto';
import { formatCrypto } from '@/features/crypto/utils/cryptoFormatters';

export default function SwapSuccessScreen() {
  const p = useLocalSearchParams<{ reference: string; from: string; to: string; fromAmt: string; toAmt: string; txId: string }>();
  const assets = useAssets();
  const fromDec = assets.data?.find((a) => a.symbol === p.from)?.decimals ?? 8;
  const toDec = assets.data?.find((a) => a.symbol === p.to)?.decimals ?? 8;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Swap complete 🎉</Text>
        <Text style={styles.sub}>
          You swapped {formatCrypto(Number(p.fromAmt), p.from, fromDec)} for {formatCrypto(Number(p.toAmt), p.to, toDec)}. Both balances are updated in your portfolio.
        </Text>
        <View style={styles.refCard}>
          <Text style={styles.refText}>Reference · {p.reference}</Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.receiptBtn} onPress={() => router.replace(`/crypto/transactions/${p.txId}`)} accessibilityRole="button">
          <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.receiptText}>View receipt</Text>
        </Pressable>
        <PrimaryButton label="Done" onPress={() => router.dismissTo('/crypto')} />
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
