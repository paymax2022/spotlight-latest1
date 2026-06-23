// @ts-nocheck
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useState } from 'react';

import { getElectricityDiscos, payElectricity, validateMeter } from '@/api/billing.api';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppInput } from '@/components/ui/AppInput';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { ChoiceList } from '@/components/ui/ChoiceList';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useBillingInvalidation } from '@/hooks/useBillingInvalidation';
import { colors } from '@/theme';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { formatCurrency } from '@/utils/format';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { isValidAmount, isValidMeterNumber, isValidNigerianPhone } from '@/validation/billing';

export default function ElectricityScreen() {
  const router = useRouter();
  const invalidate = useBillingInvalidation();
  const discos = useQuery({ queryKey: ['electricity-discos'], queryFn: getElectricityDiscos });
  const [discoCode, setDiscoCode] = useState('');
  const [meterType, setMeterType] = useState('PREPAID');
  const [meterNumber, setMeterNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [validated, setValidated] = useState(null);
  const [error, setError] = useState('');
  const validation = useMutation({
    mutationFn: () => validateMeter({ discoCode, meterNumber, meterType }),
    onSuccess: setValidated,
    onError: (err) => {
      setValidated(null);
      setError(getFriendlyErrorMessage(err, 'Unable to validate meter number. Please check the number and try again.'));
    }
  });
  const payment = useMutation({
    mutationFn: () => payElectricity({ discoCode, meterNumber, meterType, amount: Number(amount), customerPhone: phone, customerEmail: email || undefined, paymentMethod: 'WALLET', idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (data) => {
      invalidate();
      router.push(`/receipt/${data.transactionId ?? data.id}`);
    },
    onError: (err) => setError(getFriendlyErrorMessage(err, 'Transaction failed. Your wallet was not charged.'))
  });

  if (discos.isLoading) return <AppLoader />;

  const selectedDisco = discos.data?.find((item) => item.code === discoCode);
  const runValidation = () => {
    if (!discoCode) return setError('Select a disco.');
    if (!isValidMeterNumber(meterNumber)) return setError('Enter a valid meter number.');
    setError('');
    validation.mutate();
  };
  const submit = () => {
    if (!validated) return setError('Validate the meter before payment.');
    if (!isValidAmount(amount, Number(validated.minimumAmount ?? 50), Number(validated.maximumAmount ?? 1000000))) return setError('Enter an amount within the allowed range.');
    if (!isValidNigerianPhone(phone)) return setError('Enter a valid Nigerian phone number.');
    setError('');
    Alert.alert('Confirm electricity payment', `${selectedDisco?.name}\n${meterType}\n${meterNumber}\n${validated.customerName}\n${formatCurrency(Number(amount))}\nPayment method: Wallet`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay', onPress: () => payment.mutate() }
    ]);
  };

  return (
    <AppScreen>
      <AppText variant="h1">Electricity</AppText>
      <AppCard>
        <AppText variant="h2">Disco</AppText>
        <ChoiceList choices={(discos.data ?? []).filter((item) => meterType === 'PREPAID' ? item.supportsPrepaid : item.supportsPostpaid).map((item) => ({ label: item.name, value: item.code }))} value={discoCode} onChange={(value) => { setDiscoCode(value); setValidated(null); }} />
      </AppCard>
      <ChoiceList choices={[{ label: 'Prepaid', value: 'PREPAID' }, { label: 'Postpaid', value: 'POSTPAID' }]} value={meterType} onChange={(value) => { setMeterType(value); setValidated(null); }} />
      <AppInput label="Meter Number" value={meterNumber} onChangeText={(value) => { setMeterNumber(value); setValidated(null); }} keyboardType="number-pad" />
      <AppButton title="Validate Meter" variant="secondary" loading={validation.isPending} onPress={runValidation} />
      {validated ? (
        <AppCard>
          <AppText variant="bodyMedium" color={colors.secondary.emerald}>Validated</AppText>
          <AppText>{validated.customerName}</AppText>
          {validated.customerAddress ? <AppText color={colors.neutral.textMuted}>{validated.customerAddress}</AppText> : null}
        </AppCard>
      ) : null}
      <AppInput label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <AppInput label="Customer Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <AppInput label="Customer Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <AppButton title="Pay" loading={payment.isPending} onPress={submit} />
      <StatusMessage error={error} />
    </AppScreen>
  );
}
