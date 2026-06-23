// @ts-nocheck
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Clipboard, Linking, Pressable, RefreshControl, View } from 'react-native';

import { getWallet, getWalletTransactions, initiateWalletFunding } from '@/api/wallet.api';
import { getMyVirtualAccount } from '@/api/virtual-accounts.api';
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
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet, retry: false });
  const transactions = useQuery({ queryKey: ['wallet-transactions'], queryFn: getWalletTransactions });
  const virtualAccount = useQuery({ queryKey: ['virtual-account'], queryFn: getMyVirtualAccount });

  // A 403 on the wallet balance means KYC is required before the wallet can be used.
  const kycRequired = wallet.isError && (wallet.error as { status?: number })?.status === 403;

  const copyAccountNumber = (accountNumber: string) => {
    Clipboard.setString(accountNumber);
    Alert.alert('Copied', 'Account number copied to clipboard.');
  };

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

  if (kycRequired) {
    return (
      <AppScreen>
        <AppText variant="h1">Wallet</AppText>
        <AppCard>
          <AppText variant="h2">Verification required</AppText>
          <AppText color={colors.neutral.textMuted}>
            Complete your identity verification (KYC) to activate your wallet and start
            transacting.
          </AppText>
          <AppButton title="Complete KYC" onPress={() => router.push('/kyc')} />
        </AppCard>
      </AppScreen>
    );
  }

  if (wallet.isError) {
    return (
      <AppScreen>
        <AppText variant="h1">Wallet</AppText>
        <AppCard>
          <AppText variant="h2">Unable to load wallet</AppText>
          <AppText color={colors.neutral.textMuted}>
            {getFriendlyErrorMessage(wallet.error, 'Please check your connection and try again.')}
          </AppText>
          <AppButton title="Retry" onPress={() => wallet.refetch()} loading={wallet.isRefetching} />
        </AppCard>
      </AppScreen>
    );
  }

  const va = virtualAccount.data;

  return (
    <AppScreen
      refreshControl={
        <RefreshControl
          refreshing={wallet.isRefetching || transactions.isRefetching || virtualAccount.isRefetching}
          onRefresh={() => { wallet.refetch(); transactions.refetch(); virtualAccount.refetch(); }}
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
        <AppText variant="h2">Fund via Bank Transfer</AppText>
        {virtualAccount.isLoading ? (
          <AppText color={colors.neutral.textMuted}>Loading account details…</AppText>
        ) : virtualAccount.isError ? (
          <View style={{ gap: spacing[2] }}>
            <AppText color={colors.neutral.textMuted}>
              {getFriendlyErrorMessage(virtualAccount.error, 'Could not load your account details.')}
            </AppText>
            <AppButton
              title="Retry"
              variant="ghost"
              onPress={() => virtualAccount.refetch()}
              loading={virtualAccount.isRefetching}
            />
          </View>
        ) : va ? (
          <View style={{ gap: spacing[2] }}>
            <AppText color={colors.neutral.textMuted}>
              Transfer to this account to top up instantly.
            </AppText>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText color={colors.neutral.textMuted}>Bank</AppText>
              <AppText>{va.bankName || '—'}</AppText>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText color={colors.neutral.textMuted}>Account Name</AppText>
              <AppText>{va.accountName || '—'}</AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy account number"
              onPress={() => copyAccountNumber(va.accountNumber)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <AppText color={colors.neutral.textMuted}>Account Number</AppText>
              <AppText variant="h2">{va.accountNumber}</AppText>
            </Pressable>
            <AppButton title="Copy Account Number" variant="ghost" onPress={() => copyAccountNumber(va.accountNumber)} />
          </View>
        ) : (
          <AppText color={colors.neutral.textMuted}>
            No bank transfer account has been set up yet. Use card funding below, or check back
            shortly — your dedicated account is being provisioned.
          </AppText>
        )}
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
