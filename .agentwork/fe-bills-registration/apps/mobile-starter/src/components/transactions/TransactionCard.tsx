import { Pressable } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme';
import { Transaction } from '@/types/billing';
import { formatCurrency, formatDate } from '@/utils/format';

export function TransactionCard({ transaction, onPress }: { transaction: Transaction; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.neutral.white,
        borderColor: colors.neutral.border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: spacing[4],
        gap: spacing[1]
      }}
    >
      <AppText variant="bodyMedium">{transaction.productName || transaction.providerName || transaction.serviceType}</AppText>
      <AppText color={colors.neutral.textMuted}>{transaction.customerIdentifier}</AppText>
      <AppText variant="bodyMedium">{formatCurrency(transaction.totalAmount)}</AppText>
      <AppText variant="caption" color={transaction.status === 'SUCCESSFUL' ? colors.secondary.emerald : transaction.status === 'FAILED' ? colors.secondary.red : colors.secondary.amber}>
        {transaction.status} · {formatDate(transaction.createdAt)}
      </AppText>
    </Pressable>
  );
}
