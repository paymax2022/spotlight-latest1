// @ts-nocheck
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useState } from 'react';

import { buyData, getDataNetworks, getDataPlans } from '@/api/billing.api';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppInput } from '@/components/ui/AppInput';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { ChoiceList } from '@/components/ui/ChoiceList';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { BeneficiaryList } from '@/components/billing/BeneficiaryList';
import { useBeneficiaries } from '@/hooks/useBeneficiaries';
import { useBillingInvalidation } from '@/hooks/useBillingInvalidation';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency } from '@/utils/format';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { isValidNigerianPhone } from '@/validation/billing';

export default function DataScreen() {
  const router = useRouter();
  const invalidate = useBillingInvalidation();
  const [networkCode, setNetworkCode] = useState('');
  const [planId, setPlanId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');
  const networks = useQuery({ queryKey: ['data-networks'], queryFn: getDataNetworks });
  const plans = useQuery({ queryKey: ['data-plans', networkCode], queryFn: () => getDataPlans(networkCode), enabled: Boolean(networkCode) });
  const beneficiaries = useBeneficiaries('DATA');

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
    mutationFn: () => buyData({ networkCode, phoneNumber, planId, paymentMethod: 'WALLET', idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      invalidate();
      offerSaveBeneficiary();
    },
    onError: (err) => setError(getFriendlyErrorMessage(err, 'Transaction failed. Your wallet was not charged.'))
  });

  if (networks.isLoading) return <AppLoader />;

  const selectedPlan = plans.data?.find((item) => item.id === planId);
  const submit = () => {
    if (!networkCode) return setError('Select a network.');
    if (!planId) return setError('Select a data plan.');
    if (!isValidNigerianPhone(phoneNumber)) return setError('Enter a valid Nigerian phone number.');
    setError('');
    Alert.alert('Confirm data purchase', `${selectedPlan?.name}\n${phoneNumber}\n${formatCurrency(selectedPlan?.sellingPrice)}\nPayment method: Wallet`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay', onPress: () => purchase.mutate() }
    ]);
  };

  const selectBeneficiary = (b) => {
    setNetworkCode(b.billerId || networkCode);
    setPlanId('');
    setPhoneNumber(b.customerReference);
    setError('');
  };

  return (
    <AppScreen>
      <AppText variant="h1">Buy Data</AppText>
      <BeneficiaryList
        isLoading={beneficiaries.list.isLoading}
        isError={beneficiaries.list.isError}
        beneficiaries={beneficiaries.list.data ?? []}
        onSelect={selectBeneficiary}
      />
      <AppCard>
        <AppText variant="h2">Network</AppText>
        <ChoiceList choices={(networks.data ?? []).map((item) => ({ label: item.name, value: item.code }))} value={networkCode} onChange={(value) => { setNetworkCode(value); setPlanId(''); }} />
      </AppCard>
      <AppCard>
        <AppText variant="h2">Plan</AppText>
        <ChoiceList
          choices={(plans.data ?? []).map((item) => ({ label: `${item.name} · ${formatCurrency(item.sellingPrice)}`, value: item.id, caption: `${item.allowance} · ${item.validity}` }))}
          value={planId}
          onChange={setPlanId}
          emptyText={networkCode ? 'No active plans returned for this network.' : 'Select a network to load plans.'}
        />
      </AppCard>
      <AppInput label="Phone Number" value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad" />
      <AppButton title="Continue" loading={purchase.isPending} onPress={submit} />
      <StatusMessage error={error} />
    </AppScreen>
  );
}
