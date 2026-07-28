import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import TripPinInput from '@/features/mobility/components/TripPinInput';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import { useCourierActions } from '@/features/mobility/hooks/useModes';
import { toMobilityError } from '@/features/mobility/utils/mobilityFormatters';

// Courier-side state machine (the mock returns fresh parcels per call, so the
// step is driven locally — server is the source of truth for transitions).
type Step = 'navigate_pickup' | 'verify_pickup' | 'photo' | 'navigate_dropoff' | 'verify_dropoff' | 'done';

export default function CourierJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { verifyPickup, pickedUp, verifyDropoff } = useCourierActions();

  const [step, setStep] = useState<Step>('navigate_pickup');
  const [pickupPin, setPickupPin] = useState('');
  const [dropoffPin, setDropoffPin] = useState('');
  const [photoTaken, setPhotoTaken] = useState(false);
  const [proofTaken, setProofTaken] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const STATUS: Record<Step, string> = {
    navigate_pickup: 'Heading to pickup',
    verify_pickup: 'Confirm pickup PIN',
    photo: 'Confirm the parcel',
    navigate_dropoff: 'Heading to drop-off',
    verify_dropoff: 'Confirm delivery PIN',
    done: 'Delivered',
  };

  const onVerifyPickup = () => {
    if (!id) return;
    setPinError(null);
    verifyPickup.mutate({ id, pin: pickupPin }, {
      onSuccess: () => setStep('photo'),
      onError: (e) => setPinError(toMobilityError(e).message),
    });
  };

  const onConfirmPhoto = () => {
    if (!id) return;
    pickedUp.mutate({ id, photoUrl: 'mock://parcel-photo' }, { onSuccess: () => setStep('navigate_dropoff') });
  };

  const onVerifyDropoff = () => {
    if (!id) return;
    setPinError(null);
    verifyDropoff.mutate({ id, pin: dropoffPin, proofUrl: 'mock://proof' }, {
      onSuccess: () => setStep('done'),
      onError: (e) => setPinError(toMobilityError(e).message),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Active delivery" showBack={step === 'navigate_pickup'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.statusRow}>
          <StatusBadge label={STATUS[step]} tone={step === 'done' ? 'success' : 'info'} />
        </View>

        {step !== 'done' && <MobilityMap height={160} showRoute caption={STATUS[step]} />}

        {step === 'navigate_pickup' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Navigate to pickup</Text>
            <Text style={styles.cardBody}>Drive to the sender's location, then confirm the 4-digit pickup PIN they give you.</Text>
            <PrimaryButton label="I've arrived at pickup" onPress={() => setStep('verify_pickup')} />
          </View>
        )}

        {step === 'verify_pickup' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter pickup PIN</Text>
            <Text style={styles.cardBody}>Ask the sender for their 4-digit pickup PIN.</Text>
            <View style={styles.pinWrap}><TripPinInput value={pickupPin} onChange={setPickupPin} autoFocus error={pinError ?? undefined} /></View>
            <PrimaryButton label="Verify pickup" onPress={onVerifyPickup} loading={verifyPickup.isPending} disabled={pickupPin.length < 4} />
          </View>
        )}

        {step === 'photo' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Photo confirmation</Text>
            <Text style={styles.cardBody}>Take a photo of the parcel before you leave, for proof of condition.</Text>
            <Pressable style={[styles.photoBtn, photoTaken && styles.photoBtnDone]} onPress={() => setPhotoTaken(true)}>
              <Camera size={20} color={photoTaken ? Colors.tertiaryContainer : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.photoLabel, photoTaken && styles.photoLabelDone]}>{photoTaken ? 'Photo captured' : 'Take parcel photo'}</Text>
              {photoTaken && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.5} />}
            </Pressable>
            <PrimaryButton label="Confirm pickup & start delivery" onPress={onConfirmPhoto} loading={pickedUp.isPending} disabled={!photoTaken} />
          </View>
        )}

        {step === 'navigate_dropoff' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Navigate to drop-off</Text>
            <Text style={styles.cardBody}>Deliver to the receiver, then confirm the delivery PIN and capture proof.</Text>
            <PrimaryButton label="I've arrived at drop-off" onPress={() => setStep('verify_dropoff')} />
          </View>
        )}

        {step === 'verify_dropoff' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter delivery PIN</Text>
            <Text style={styles.cardBody}>Ask the receiver for their 4-digit delivery PIN.</Text>
            <View style={styles.pinWrap}><TripPinInput value={dropoffPin} onChange={setDropoffPin} autoFocus error={pinError ?? undefined} /></View>
            <Pressable style={[styles.photoBtn, proofTaken && styles.photoBtnDone]} onPress={() => setProofTaken(true)}>
              <Camera size={20} color={proofTaken ? Colors.tertiaryContainer : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.photoLabel, proofTaken && styles.photoLabelDone]}>{proofTaken ? 'Proof captured' : 'Capture proof of delivery'}</Text>
              {proofTaken && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.5} />}
            </Pressable>
            <PrimaryButton label="Complete delivery" onPress={onVerifyDropoff} loading={verifyDropoff.isPending} disabled={dropoffPin.length < 4 || !proofTaken} />
          </View>
        )}

        {step === 'done' && (
          <View style={styles.doneCard}>
            <CheckCircle2 size={48} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.doneTitle}>Delivery complete</Text>
            <Text style={styles.doneSub}>Your earnings have been added to your courier wallet.</Text>
            <PrimaryButton label="View earnings" onPress={() => router.replace('/mobility/parcel/courier/earnings')} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  statusRow: { flexDirection: 'row' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  pinWrap: { paddingVertical: Spacing.sm },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  photoBtnDone: { borderColor: Colors.tertiaryContainer, backgroundColor: Colors.tertiaryFixed },
  photoLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  photoLabelDone: { color: Colors.tertiaryContainer },
  doneCard: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
});
