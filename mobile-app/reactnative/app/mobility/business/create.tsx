import React, { useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusinessAccount, useCreateDelivery } from '@/features/mobility/hooks/useLogistics';
import { LOGISTICS_SIZES, LOGISTICS_ENABLED } from '@/features/mobility/constants/modes.constants';
import { nairaToKobo } from '@/features/mobility/utils/mobilityFormatters';
import type { DeliverySize, Place } from '@/features/mobility/types/logistics.types';

const PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DROPOFF: Place = { address: '', lat: 6.6186, lng: 3.3585 };

export default function CreateDeliveryScreen() {
  const account = useBusinessAccount();
  const [pickup, setPickup] = useState(PICKUP.address);
  const [dropoff, setDropoff] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [size, setSize] = useState<DeliverySize>('small');
  const [cod, setCod] = useState('');

  const create = useCreateDelivery();
  const codEnabled = account.data?.codEnabled ?? false;

  if (!LOGISTICS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New delivery" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const canSubmit =
    pickup.trim() && dropoff.trim() && receiverName.trim() && receiverPhone.trim() && !create.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        pickup: { ...PICKUP, address: pickup.trim() },
        dropoff: { ...DROPOFF, address: dropoff.trim() },
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        size,
        codKobo: codEnabled && cod.trim() ? nairaToKobo(Number(cod) || 0) : 0,
      },
      {
        onSuccess: (d) => router.replace(`/mobility/business/delivery/${d.id}`),
        onError: () => { /* surfaced inline below */ },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New delivery" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Route</Text>
        <TextInputField label="Pickup" value={pickup} onChangeText={setPickup} placeholder="Pickup address" leftIcon={<MapPin size={18} color={Colors.secondary} strokeWidth={2} />} />
        <TextInputField label="Drop-off" value={dropoff} onChangeText={setDropoff} placeholder="Where is it going?" leftIcon={<MapPin size={18} color={Colors.primary} strokeWidth={2} />} />

        <Text style={styles.section}>Receiver</Text>
        <TextInputField label="Receiver name" value={receiverName} onChangeText={setReceiverName} placeholder="Full name" />
        <PhoneNumberInput label="Receiver phone" value={receiverPhone} onChange={({ e164, nsn }) => (setReceiverPhone)(e164 || nsn)} />

        <Text style={styles.section}>Parcel size</Text>
        <View style={styles.list}>
          {LOGISTICS_SIZES.map((s) => (
            <SelectableCard key={s.value} title={s.label} subtitle={s.hint} selected={size === s.value} onPress={() => setSize(s.value)} />
          ))}
        </View>

        {codEnabled && (
          <>
            <Text style={styles.section}>Cash on delivery</Text>
            <TextInputField label="Amount to collect (₦)" value={cod} onChangeText={(t) => setCod(sanitizeMoneyInput(t))} placeholder="0" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />
            <Text style={styles.hint}>The courier collects this amount from the receiver on delivery.</Text>
          </>
        )}

        {create.isError && (
          <MobilityEdgeState kind="paymentFailed" compact actionLabel="Try again" onAction={onSubmit} />
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.fareNote}>Fare is calculated by Paymax from size and route — shown once created.</Text>
        <PrimaryButton label="Create delivery" onPress={onSubmit} loading={create.isPending} disabled={!canSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  list: { gap: Spacing.sm },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fareNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.xs },
});
