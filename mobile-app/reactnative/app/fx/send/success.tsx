import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Clock, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { formatMoney } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

export default function SendSuccessScreen() {
  const p = useLocalSearchParams<{ reference: string; txId: string; name: string; dest: string; destCur: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Payout sent 🎉</Text>
        <Text style={styles.sub}>
          {formatMoney(Number(p.dest), p.destCur as CurrencyCode)} is on its way to {p.name}.
        </Text>

        <View style={styles.statusPill}>
          <Clock size={14} color={Colors.onPrimaryFixedVariant} strokeWidth={2} />
          <Text style={styles.statusText}>Processing · settles shortly</Text>
        </View>
        <Text style={styles.ref}>Reference · {p.reference}</Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.receiptBtn} onPress={() => router.replace(`/fx/transactions/${p.txId}`)} accessibilityRole="button">
          <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.receiptText}>View transfer details</Text>
        </Pressable>
        <PrimaryButton label="Done" onPress={() => router.dismissTo('/fx')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6, marginTop: Spacing.sm },
  statusText: { ...Typography.labelSm, color: Colors.onPrimaryFixedVariant, fontWeight: '600' },
  ref: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  receiptText: { ...Typography.labelLg, color: Colors.secondary },
});
