// @ts-nocheck
import { useMutation, useQuery } from '@tanstack/react-query';
import { Linking, RefreshControl, View } from 'react-native';

import { getWallet, getWalletTransactions, initiateWalletFunding } from '@/api/wallet.api';
import { TransactionCard } from '@/components/transactions/TransactionCard';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppInput } from '@/components/ui/AppInput';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { colors, spacing } from '@/theme';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency } from '@/utils/format';
import { useState } from 'react';

export default function WalletScreen() {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  const transactions = useQuery({ queryKey: ['wallet-transactions'], queryFn: getWalletTransactions });

  const fund = useMutation({
    mutationFn: () => {
      const amountNaira = Number(amount);
      if (!amountNaira || amountNaira < 100) throw new Error('Minimum funding amount is ₦100.');
      return initiateWalletFunding({ amountNaira });
    },
    onSuccess: async (result) => {
      setAmount('');
      if (result.authorizationUrl) {
        setMessage('Opening payment page…');
        await Linking.openURL(result.authorizationUrl);
        setMessage('Complete the payment in your browser. Your balance will update automatically once confirmed.');
      } else {
        setMessage('Wallet funding initiated. Your balance will update once the payment is confirmed.');
      }
    },
    onError: (err) => {
      setMessage('');
    },
  });

  if (wallet.isLoading) return <AppLoader />;

  return (
    <AppScreen
      refreshControl={
        <RefreshControl
          refreshing={wallet.isRefetching || transactions.isRefetching}
          onRefresh={() => { wallet.refetch(); transactions.refetch(); }}
        />
      }
    >
      <AppText variant="h1">Wallet</AppText>

      <AppCard>
        <AppText color={colors.neutral.textMuted}>Available Balance</AppText>
        <AppText variant="h1">{formatCurrency(wallet.data?.balance, wallet.data?.currency)}</AppText>
        {wallet.data?.ledgerBalance != null ? (
          <AppText>Ledger: {formatCurrency(wallet.data.ledgerBalance)}</AppText>
        ) : null}
        {wallet.data?.pendingBalance != null ? (
          <AppText>Pending: {formatCurrency(wallet.data.pendingBalance)}</AppText>
        ) : null}
      </AppCard>

      <AppCard>
        <AppText variant="h2">Fund Wallet</AppText>
        <AppInput
          label="Amount (₦)"
          value={amount}
          onChangeText={(v) => { setAmount(v); setMessage(''); }}
          keyboardType="numeric"
          placeholder="e.g. 5000"
        />
        <AppButton
          title="Fund via Paystack"
          loading={fund.isPending}
          onPress={() => fund.mutate()}
        />
        <StatusMessage
          error={fund.error ? getFriendlyErrorMessage(fund.error, 'Unable to initiate funding. Please try again.') : ''}
          success={message}
        />
      </AppCard>

      <View style={{ gap: spacing[3] }}>
        <AppText variant="h2">Wallet Transactions</AppText>
        {transactions.data?.length ? (
          transactions.data.map((item) => <TransactionCard key={item.id} transaction={item} />)
        ) : (
          <AppText color={colors.neutral.textMuted}>No wallet transactions yet.</AppText>
        )}
      </View>
    </AppScreen>
  );
}
