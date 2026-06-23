// @ts-nocheck
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useState } from 'react';

import { buyAirtime, getAirtimeNetworks } from '@/api/billing.api';
import { AppButton } from '@/components/ui/AppButton';
import { ChoiceList } from '@/components/ui/ChoiceList';
import { AppCard } from '@/components/ui/AppCard';
import { AppInput } from '@/components/ui/AppInput';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useBillingInvalidation } from '@/hooks/useBillingInvalidation';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency } from '@/utils/format';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { isValidAmount, isValidNigerianPhone } from '@/validation/billing';

export default function AirtimeScreen() {
  const router = useRouter();
  const invalidate = useBillingInvalidation();
  const networks = useQuery({ queryKey: ['airtime-networks'], queryFn: getAirtimeNetworks });
  const [networkCode, setNetworkCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const purchase = useMutation({
    mutationFn: () => buyAirtime({ networkCode, phoneNumber, amount: Number(amount), paymentMethod: 'WALLET', idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (data) => {
      invalidate();
      router.push(`/receipt/${data.transactionId ?? data.id}`);
    },
    onError: (err) => setError(getFriendlyErrorMessage(err, 'Transaction failed. Your wallet was not charged.'))
  });

  if (networks.isLoading) return <AppLoader />;

  const submit = () => {
    if (!networkCode) return setError('Select a network.');
    if (!isValidNigerianPhone(phoneNumber)) return setError('Enter a valid Nigerian phone number.');
    if (!isValidAmount(amount)) return setError('Enter an amount between NGN 50 and NGN 1,000,000.');
    setError('');
    const network = networks.data?.find((item) => item.code === networkCode);
    Alert.alert('Confirm airtime purchase', `${network?.name}\n${phoneNumber}\n${formatCurrency(Number(amount))}\nPayment method: Wallet`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay', onPress: () => purchase.mutate() }
    ]);
  };

  return (
    <AppScreen>
      <AppText variant="h1">Buy Airtime</AppText>
      <AppCard>
        <AppText variant="h2">Network</AppText>
        <ChoiceList choices={(networks.data ?? []).map((item) => ({ label: item.name, value: item.code }))} value={networkCode} onChange={setNetworkCode} />
      </AppCard>
      <AppInput label="Phone Number" value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad" />
      <AppInput label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <AppButton title="Continue" loading={purchase.isPending} onPress={submit} />
      <StatusMessage error={error} />
    </AppScreen>
  );
}
