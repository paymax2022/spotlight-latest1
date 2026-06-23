// @ts-nocheck
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useState } from 'react';

import { getCablePackages, getCableProviders, payCable, validateCable } from '@/api/billing.api';
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
import { colors } from '@/theme';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency } from '@/utils/format';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { isValidNigerianPhone, isValidSmartCardNumber } from '@/validation/billing';

export default function CableScreen() {
  const router = useRouter();
  const invalidate = useBillingInvalidation();
  const [providerCode, setProviderCode] = useState('');
  const [packageId, setPackageId] = useState('');
  const [smartCardNumber, setSmartCardNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [validated, setValidated] = useState(null);
  const [error, setError] = useState('');
  const providers = useQuery({ queryKey: ['cable-providers'], queryFn: getCableProviders });
  const packages = useQuery({ queryKey: ['cable-packages', providerCode], queryFn: () => getCablePackages(providerCode), enabled: Boolean(providerCode) });
  const beneficiaries = useBeneficiaries('CABLE_TV');
  const validation = useMutation({
    mutationFn: () => validateCable({ providerCode, smartCardNumber }),
    onSuccess: setValidated,
    onError: (err) => {
      setValidated(null);
      setError(getFriendlyErrorMessage(err, 'Unable to validate smart card. Please check the number and try again.'));
    }
  });

  const offerSaveBeneficiary = () => {
    const provider = providers.data?.find((item) => item.code === providerCode);
    const alreadySaved = (beneficiaries.list.data ?? []).some(
      (b) => b.billerId === providerCode && b.customerReference === smartCardNumber,
    );
    const proceed = () => router.push(`/receipt/${payment.data?.transactionId ?? payment.data?.id ?? ''}`);
    if (alreadySaved) { proceed(); return; }
    Alert.alert('Save beneficiary?', `Save card ${smartCardNumber} (${provider?.name ?? 'this provider'}) for quick payments next time?`, [
      { text: 'Not now', style: 'cancel', onPress: proceed },
      {
        text: 'Save',
        onPress: () => {
          beneficiaries.save.mutate(
            {
              billerId: providerCode,
              label: validated?.customerName ? `${validated.customerName} · ${smartCardNumber}` : smartCardNumber,
              customerReference: smartCardNumber,
              customerName: validated?.customerName,
            },
            { onSettled: proceed },
          );
        },
      },
    ]);
  };

  const payment = useMutation({
    mutationFn: () => payCable({ providerCode, smartCardNumber, packageId, customerPhone: phone, customerEmail: email || undefined, paymentMethod: 'WALLET', idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => {
      invalidate();
      offerSaveBeneficiary();
    },
    onError: (err) => setError(getFriendlyErrorMessage(err, 'Transaction failed. Your wallet was not charged.'))
  });

  if (providers.isLoading) return <AppLoader />;

  const selectedPackage = packages.data?.find((item) => item.id === packageId);
  const runValidation = () => {
    if (!providerCode) return setError('Select a cable provider.');
    if (!isValidSmartCardNumber(smartCardNumber)) return setError('Enter a valid smart card number.');
    setError('');
    validation.mutate();
  };
  const submit = () => {
    if (!validated) return setError('Validate the smart card before payment.');
    if (!packageId) return setError('Select a package.');
    if (!isValidNigerianPhone(phone)) return setError('Enter a valid Nigerian phone number.');
    setError('');
    Alert.alert('Confirm cable payment', `${selectedPackage?.name}\n${smartCardNumber}\n${validated.customerName}\n${formatCurrency(selectedPackage?.sellingPrice)}\nPayment method: Wallet`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay', onPress: () => payment.mutate() }
    ]);
  };

  const selectBeneficiary = (b) => {
    setProviderCode(b.billerId || providerCode);
    setPackageId('');
    setSmartCardNumber(b.customerReference);
    setValidated(null);
    setError('');
  };

  return (
    <AppScreen>
      <AppText variant="h1">Cable TV</AppText>
      <BeneficiaryList
        isLoading={beneficiaries.list.isLoading}
        isError={beneficiaries.list.isError}
        beneficiaries={beneficiaries.list.data ?? []}
        onSelect={selectBeneficiary}
      />
      <AppCard>
        <AppText variant="h2">Provider</AppText>
        <ChoiceList choices={(providers.data ?? []).map((item) => ({ label: item.name, value: item.code }))} value={providerCode} onChange={(value) => { setProviderCode(value); setPackageId(''); setValidated(null); }} />
      </AppCard>
      <AppCard>
        <AppText variant="h2">Package</AppText>
        <ChoiceList choices={(packages.data ?? []).map((item) => ({ label: `${item.name} · ${formatCurrency(item.sellingPrice)}`, value: item.id, caption: item.duration }))} value={packageId} onChange={setPackageId} emptyText={providerCode ? 'No active packages returned for this provider.' : 'Select a provider to load packages.'} />
      </AppCard>
      <AppInput label="Smart Card Number" value={smartCardNumber} onChangeText={(value) => { setSmartCardNumber(value); setValidated(null); }} keyboardType="number-pad" />
      <AppButton title="Validate Smart Card" variant="secondary" loading={validation.isPending} onPress={runValidation} />
      {validated ? (
        <AppCard>
          <AppText variant="bodyMedium" color={colors.secondary.emerald}>Validated</AppText>
          <AppText>{validated.customerName}</AppText>
          {validated.currentBouquet ? <AppText color={colors.neutral.textMuted}>Current: {validated.currentBouquet}</AppText> : null}
        </AppCard>
      ) : null}
      <AppInput label="Customer Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <AppInput label="Customer Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <AppButton title="Pay" loading={payment.isPending} onPress={submit} />
      <StatusMessage error={error} />
    </AppScreen>
  );
}
