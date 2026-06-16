// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getTransaction, retryTransaction } from '@/api/transactions.api';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { colors } from '@/theme';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency, formatDate } from '@/utils/format';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const transaction = useQuery({ queryKey: ['transaction', id], queryFn: () => getTransaction(String(id)), enabled: Boolean(id) });
  const retry = useMutation({
    mutationFn: () => retryTransaction(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      transaction.refetch();
    }
  });

  if (transaction.isLoading) return <AppLoader />;

  const data = transaction.data;
  return (
    <AppScreen>
      <AppText variant="h1">Transaction</AppText>
      {transaction.isError ? (
        <>
          <AppText color={colors.secondary.red}>Unable to load transaction.</AppText>
          <AppButton title="Retry" onPress={() => transaction.refetch()} />
        </>
      ) : data ? (
        <AppCard>
          <AppText variant="h2">{data.productName || data.providerName || data.serviceType}</AppText>
          <AppText>Status: {data.status}</AppText>
          <AppText>Reference: {data.reference}</AppText>
          <AppText>Customer: {data.customerIdentifier}</AppText>
          <AppText>Amount: {formatCurrency(data.amount)}</AppText>
          <AppText>Charges: {formatCurrency(data.charges)}</AppText>
          <AppText>Total: {formatCurrency(data.totalAmount)}</AppText>
          {data.token ? <AppText>Token: {data.token}</AppText> : null}
          {data.units ? <AppText>Units: {data.units}</AppText> : null}
          <AppText color={colors.neutral.textMuted}>{formatDate(data.createdAt)}</AppText>
          <AppButton title="View Receipt" onPress={() => router.push(`/receipt/${data.id}`)} />
          {data.status === 'FAILED' ? <AppButton title="Retry Transaction" loading={retry.isPending} onPress={() => retry.mutate()} /> : null}
          {data.status === 'PROCESSING' || data.status === 'PENDING' ? <AppButton title="Refresh Status" variant="secondary" onPress={() => transaction.refetch()} /> : null}
        </AppCard>
      ) : null}
      <StatusMessage error={retry.error ? getFriendlyErrorMessage(retry.error, 'Unable to retry transaction. Please try again.') : ''} />
    </AppScreen>
  );
}
