import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { User, ShieldCheck, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNaira, StaysColors } from '../constants/stays.constants';
import type { Customer } from '../agent';

interface Props {
  customer: Customer;
  selected?: boolean;
  onPress?: () => void;
  showWallet?: boolean;
}

/** Customer row for agent lookup/select. The booking acts on THIS identity. */
export default function CustomerCard({ customer, selected, onPress, showWallet = true }: Props) {
  return (
    <Pressable style={[styles.card, selected && styles.cardSelected]} onPress={onPress} accessibilityRole="button">
      <View style={styles.avatar}>
        <User size={22} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{customer.fullName}</Text>
          <View style={styles.kyc}>
            <ShieldCheck size={12} color={StaysColors.ok} strokeWidth={2.4} />
            <Text style={styles.kycText}>KYC T{customer.kycTier}</Text>
          </View>
        </View>
        <Text style={styles.line} numberOfLines={1}>{customer.phone} · {customer.city}</Text>
        {showWallet ? (
          <Text style={styles.wallet}>Wallet: {formatNaira(customer.walletKobo)}</Text>
        ) : null}
      </View>
      {onPress ? <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  cardSelected: { borderColor: Colors.primary, borderWidth: 2 },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  kyc: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  kycText: { ...Typography.caption, color: StaysColors.ok, fontWeight: '700' as const },
  line: { ...Typography.caption, color: Colors.onSurfaceVariant },
  wallet: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
});
