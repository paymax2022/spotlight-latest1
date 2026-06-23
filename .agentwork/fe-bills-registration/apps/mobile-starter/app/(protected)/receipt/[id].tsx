// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Share } from 'react-native';

import { getReceipt } from '@/api/transactions.api';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme';
import { formatCurrency, formatDate } from '@/utils/format';

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams();
  const receipt = useQuery({ queryKey: ['receipt', id], queryFn: () => getReceipt(String(id)), enabled: Boolean(id) });

  if (receipt.isLoading) return <AppLoader />;

  const data = receipt.data;
  const shareReceipt = async () => {
    if (!data) return;
    await Share.share({
      message: `Paymax receipt\nReference: ${data.reference}\nStatus: ${data.status}\nTotal: ${formatCurrency(data.totalAmount)}${data.token ? `\nToken: ${data.token}` : ''}`
    });
  };

  return (
    <AppScreen>
      <AppText variant="h1">Receipt</AppText>
      {receipt.isError ? (
        <>
          <AppText color={colors.secondary.red}>Unable to load receipt.</AppText>
          <AppButton title="Retry" onPress={() => receipt.refetch()} />
        </>
      ) : data ? (
        <AppCard>
          <AppText variant="h2">{data.status}</AppText>
          <AppText>Service: {data.serviceType}</AppText>
          <AppText>Reference: {data.reference}</AppText>
          <AppText>Customer: {data.customerName || data.customerIdentifier}</AppText>
          {data.providerName ? <AppText>Provider: {data.providerName}</AppText> : null}
          {data.productName ? <AppText>Product: {data.productName}</AppText> : null}
          <AppText>Amount: {formatCurrency(data.amount)}</AppText>
          <AppText>Charges: {formatCurrency(data.charges)}</AppText>
          <AppText>Total: {formatCurrency(data.totalAmount)}</AppText>
          {data.token ? <AppText variant="h2">Token: {data.token}</AppText> : null}
          {data.units ? <AppText>Units: {data.units}</AppText> : null}
          <AppText color={colors.neutral.textMuted}>{formatDate(data.createdAt)}</AppText>
          {data.supportMessage ? <AppText color={colors.neutral.textMuted}>{data.supportMessage}</AppText> : null}
          <AppButton title="Share Receipt" variant="secondary" onPress={shareReceipt} />
        </AppCard>
      ) : null}
    </AppScreen>
  );
}
