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
import { BeneficiaryList } from '@/components/billing/BeneficiaryList';
import { useBeneficiaries } from '@/hooks/useBeneficiaries';
import { useBillingInvalidation } from '@/hooks/useBillingInvalidation';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency } from '@/utils/format';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { isValidAmount, isValidNigerianPhone } from '@/validation/billing';

export default function AirtimeScreen() {
  const router = useRouter();
  const invalidate = useBillingInvalidation();
  const networks = useQuery({ queryKey: ['airtime-networks'], queryFn: getAirtimeNetworks });
  const beneficiaries = useBeneficiaries('AIRTIME');
  const [networkCode, setNetworkCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const offerSaveBeneficiary = () => {
    const network = networks.data?.find((item) => item.code === networkCode);
    const alreadySaved = (beneficiaries.list.data ?? []).some(
      (b) => b.billerId === networkCode || b.customerReference === phoneNumber,
    );
    const proceed = () => router.push(`/receipt/${purchase.data?.transactionId ?? purchase.data?.id ?? ''}`);
    if (alreadySaved) { proceed(); return; }
    Alert.alert('Save beneficiary?', `Save ${phoneNumber} (${network?.name ?? 'this number'}) for quick refills next time?`, [
      { text: 'Not now', style: 'cancel', onPress: proceed },
      {
        text: 'Save',
        onPress: () => {
          beneficiaries.save.mutate(
            { billerId: networkCode, label: phoneNumber, customerReference: phoneNumber },
            { onSettled: proceed },
          );
        },
      },
    ]);
  };

  const purchase = useMutation({
    mutationFn: () => buyAirtime({ networkCode, phoneNumber, amount: Number(amount), paymentMethod: 'WALLET', idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      invalidate();
      offerSaveBeneficiary();
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

  const selectBeneficiary = (b) => {
    setNetworkCode(b.billerId || networkCode);
    setPhoneNumber(b.customerReference);
    setError('');
  };

  return (
    <AppScreen>
      <AppText variant="h1">Buy Airtime</AppText>
      <BeneficiaryList
        isLoading={beneficiaries.list.isLoading}
        isError={beneficiaries.list.isError}
        beneficiaries={beneficiaries.list.data ?? []}
        onSelect={selectBeneficiary}
      />
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
