// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { useState } from 'react';

import { getTransactions } from '@/api/transactions.api';
import { TransactionCard } from '@/components/transactions/TransactionCard';
import { AppButton } from '@/components/ui/AppButton';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { ChoiceList } from '@/components/ui/ChoiceList';
import { colors, spacing } from '@/theme';

export default function TransactionsScreen() {
  const router = useRouter();
  const [serviceType, setServiceType] = useState('');
  const [status, setStatus] = useState('');
  const transactions = useQuery({
    queryKey: ['transactions', serviceType, status],
    queryFn: () => getTransactions({ serviceType: serviceType || undefined, status: status || undefined, page: 1, limit: 20 })
  });

  return (
    <AppScreen refreshControl={<RefreshControl refreshing={transactions.isRefetching} onRefresh={transactions.refetch} />}>
      <AppText variant="h1">Transactions</AppText>
      <ChoiceList
        choices={[
          { label: 'All services', value: '' },
          { label: 'Airtime', value: 'AIRTIME' },
          { label: 'Data', value: 'DATA' },
          { label: 'Electricity', value: 'ELECTRICITY' },
          { label: 'Cable TV', value: 'CABLE_TV' }
        ]}
        value={serviceType}
        onChange={setServiceType}
      />
      <ChoiceList
        choices={[
          { label: 'All statuses', value: '' },
          { label: 'Successful', value: 'SUCCESSFUL' },
          { label: 'Processing', value: 'PROCESSING' },
          { label: 'Failed', value: 'FAILED' },
          { label: 'Refunded', value: 'REFUNDED' }
        ]}
        value={status}
        onChange={setStatus}
      />
      {transactions.isError ? (
        <>
          <AppText color={colors.secondary.red}>Unable to load transactions.</AppText>
          <AppButton title="Retry" onPress={() => transactions.refetch()} />
        </>
      ) : null}
      <View style={{ gap: spacing[3] }}>
        {transactions.data?.items?.length ? (
          transactions.data.items.map((item) => <TransactionCard key={item.id} transaction={item} onPress={() => router.push(`/transactions/${item.id}`)} />)
        ) : (
          <AppText color={colors.neutral.textMuted}>No transactions found.</AppText>
        )}
      </View>
    </AppScreen>
  );
}
