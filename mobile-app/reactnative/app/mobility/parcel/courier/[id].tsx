import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, CheckCircle2, User } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import MobilityMap from '@/features/mobility/components/MobilityMap';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import TripRouteCard from '@/features/mobility/components/TripRouteCard';
import TripPinInput from '@/features/mobility/components/TripPinInput';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import { useCourierActions, useParcel } from '@/features/mobility/hooks/useModes';
import { toMobilityError } from '@/features/mobility/utils/mobilityFormatters';
import { errKind } from '@/features/mobility/utils/errKind';
import { courierLeg, courierStepFor, hasCoords, type CourierStep } from '@/features/mobility/utils/parcelWire';
import { takePhoto, type PickedAsset } from '@/features/crowdfunding/utils/mediaPicker';
import type { ParcelEvidenceType } from '@/features/mobility/api/mobility.api';

// Courier-side job screen. The step comes from the parcel's server status
// (courierStepFor), so it resumes where the rider left off after a restart.
// The only local state is "I've arrived" for the current leg — the server has
// no transition for it — and the photos captured but not yet sent.

const STATUS: Record<CourierStep, string> = {
  navigate_pickup: 'Heading to pickup',
  verify_pickup: 'Confirm pickup PIN',
  photo: 'Confirm the parcel',
  navigate_dropoff: 'Heading to drop-off',
  verify_dropoff: 'Confirm delivery PIN',
  done: 'Delivered',
  closed: 'Job closed',
};

/** A captured photo and, once uploaded, its R2 object key (reused on a PIN retry). */
interface Evidence {
  asset: PickedAsset;
  key: string | null;
}

const toUpload = (a: PickedAsset, kind: ParcelEvidenceType) => ({
  uri: a.uri,
  name: a.fileName ?? `${kind}-${Date.now()}.jpg`,
  mimeType: a.mimeType ?? 'image/jpeg',
});

export default function CourierJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const parcel = useParcel(id);
  const { verifyPickup, pickedUp, verifyDropoff, uploadEvidence } = useCourierActions();

  const [arrivedFor, setArrivedFor] = useState<'pickup' | 'dropoff' | null>(null);
  const [pickupPin, setPickupPin] = useState('');
  const [dropoffPin, setDropoffPin] = useState('');
  const [photo, setPhoto] = useState<Evidence | null>(null);
  const [proof, setProof] = useState<Evidence | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (parcel.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Active delivery" />
        <StateView kind="loading" message="Loading delivery…" />
      </SafeAreaView>
    );
  }
  if (parcel.isError || !parcel.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Active delivery" />
        <MobilityEdgeState kind={errKind(parcel.error)} actionLabel="Retry" onAction={() => parcel.refetch()} />
      </SafeAreaView>
    );
  }

  const p = parcel.data;
  const leg = courierLeg(p.phase);
  const step = courierStepFor(p.phase, leg != null && arrivedFor === leg);
  const busy = uploadEvidence.isPending;

  const capture = async (set: (e: Evidence) => void) => {
    setUploadError(null);
    const asset = await takePhoto({ allowsEditing: false });
    if (asset) set({ asset, key: null });
  };

  // Upload once; a failed PIN keeps the key so a retry doesn't re-upload.
  const ensureUploaded = async (ev: Evidence, kind: ParcelEvidenceType, set: (e: Evidence) => void): Promise<string | null> => {
    if (ev.key) return ev.key;
    try {
      const key = await uploadEvidence.mutateAsync({ kind, file: toUpload(ev.asset, kind) });
      set({ ...ev, key });
      return key;
    } catch (e) {
      setUploadError(`Couldn't upload the photo. ${toMobilityError(e).message}`);
      return null;
    }
  };

  const onVerifyPickup = () => {
    setPinError(null);
    verifyPickup.mutate({ id: p.id, pin: pickupPin }, {
      onError: (e) => setPinError(toMobilityError(e).message),
    });
  };

  const onConfirmPhoto = async () => {
    if (!photo) return;
    const key = await ensureUploaded(photo, 'parcel_pickup', setPhoto);
    if (!key) return;
    pickedUp.mutate({ id: p.id, photoUrl: key }, {
      onError: (e) => setUploadError(toMobilityError(e).message),
    });
  };

  const onVerifyDropoff = async () => {
    if (!proof) return;
    setPinError(null);
    const key = await ensureUploaded(proof, 'parcel_proof', setProof);
    if (!key) return;
    verifyDropoff.mutate({ id: p.id, pin: dropoffPin, proofUrl: key }, {
      onError: (e) => setPinError(toMobilityError(e).message),
    });
  };

  const photoButton = (ev: Evidence | null, idle: string, done: string, onPress: () => void) => (
    <Pressable style={[styles.photoBtn, ev && styles.photoBtnDone]} onPress={onPress} disabled={busy} accessibilityRole="button">
      {ev ? <Image source={{ uri: ev.asset.uri }} style={styles.thumb} /> : <Camera size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />}
      <Text style={[styles.photoLabel, ev && styles.photoLabelDone]}>{ev ? done : idle}</Text>
      {ev && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.5} />}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Active delivery" showBack={step !== 'photo' && step !== 'verify_dropoff'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.statusRow}>
          <StatusBadge label={STATUS[step]} tone={step === 'done' ? 'success' : step === 'closed' ? 'warning' : 'info'} />
        </View>

        {step !== 'done' && step !== 'closed' && (
          <MobilityMap
            height={160}
            showRoute
            caption={STATUS[step]}
            pickup={hasCoords(p.pickup) ? p.pickup : null}
            dropoff={hasCoords(p.dropoff) ? p.dropoff : null}
          />
        )}

        <View style={styles.card}>
          <TripRouteCard pickup={p.pickup} dest={p.dropoff} compact />
          {!!p.receiverName && (
            <View style={styles.receiver}>
              <User size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.receiverText}>
                Receiver: <Text style={styles.receiverName}>{p.receiverName}</Text>
                {p.receiverPhone && step !== 'done' && step !== 'closed' ? ` · ${p.receiverPhone}` : ''}
              </Text>
            </View>
          )}
        </View>

        {step === 'navigate_pickup' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Navigate to pickup</Text>
            <Text style={styles.cardBody}>Go to the sender's location, then confirm the 4-digit pickup PIN they give you.</Text>
            <PrimaryButton label="I've arrived at pickup" onPress={() => setArrivedFor('pickup')} />
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
            {photoButton(photo, 'Take parcel photo', 'Photo captured · tap to retake', () => capture(setPhoto))}
            {!!uploadError && <Text style={styles.error}>{uploadError}</Text>}
            <PrimaryButton
              label="Confirm pickup & start delivery"
              onPress={onConfirmPhoto}
              loading={busy || pickedUp.isPending}
              disabled={!photo}
            />
          </View>
        )}

        {step === 'navigate_dropoff' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Navigate to drop-off</Text>
            <Text style={styles.cardBody}>Deliver to the receiver, then confirm the delivery PIN and capture proof.</Text>
            <PrimaryButton label="I've arrived at drop-off" onPress={() => setArrivedFor('dropoff')} />
          </View>
        )}

        {step === 'verify_dropoff' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter delivery PIN</Text>
            <Text style={styles.cardBody}>Ask the receiver for their 4-digit delivery PIN.</Text>
            <View style={styles.pinWrap}><TripPinInput value={dropoffPin} onChange={setDropoffPin} autoFocus error={pinError ?? undefined} /></View>
            {photoButton(proof, 'Capture proof of delivery', 'Proof captured · tap to retake', () => capture(setProof))}
            {!!uploadError && <Text style={styles.error}>{uploadError}</Text>}
            <PrimaryButton
              label="Complete delivery"
              onPress={onVerifyDropoff}
              loading={busy || verifyDropoff.isPending}
              disabled={dropoffPin.length < 4 || !proof}
            />
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

        {step === 'closed' && (
          <MobilityEdgeState
            kind="empty"
            title="This job is closed"
            message="The parcel was cancelled or flagged. There is nothing more to do here."
            actionLabel="Back to requests"
            onAction={() => router.replace('/mobility/parcel/courier/requests')}
          />
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
  receiver: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  receiverText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  receiverName: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  pinWrap: { paddingVertical: Spacing.sm },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  photoBtnDone: { borderColor: Colors.tertiaryContainer, backgroundColor: Colors.tertiaryFixed },
  thumb: { width: 40, height: 40, borderRadius: Radius.md },
  photoLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  photoLabelDone: { color: Colors.tertiaryContainer },
  error: { ...Typography.labelMd, color: Colors.error },
  doneCard: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
});
