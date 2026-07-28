import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, CheckCircle2, Save, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import StateView from '@/components/StateView';
import { useSubmitApplication } from '@/features/arena/hooks';
import {
  arenaApplicationDraft, patchApplicationDraft, ensureApplicationDraft, resetApplicationDraft, stubCaptureBase64,
} from '@/features/arena/draft';
import { NIGERIA_STATES } from '@/features/arena/constants';

const VEHICLE_TYPES = ['Car / Saloon', 'Bus / Minibus', 'Truck / Lorry', 'Tricycle (Keke)', 'Motorcycle (Okada)'];

/**
 * C2 — Application form. Save-as-you-go (writes each field into the module draft
 * so a KYC step-up or backgrounding doesn't lose progress). Home-state selector
 * covers 36 states + FCT. License upload is a stubbed sandbox capture. Only asks
 * for what's needed to apply.
 */
export default function ApplyScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  ensureApplicationDraft(competitionId);
  const submit = useSubmitApplication();

  const d = arenaApplicationDraft.current;
  const [fullName, setFullName] = useState(d.fullName);
  const [phone, setPhone] = useState(d.phone);
  const [homeState, setHomeState] = useState(d.homeState);
  const [years, setYears] = useState(d.yearsDriving);
  const [vehicle, setVehicle] = useState(d.vehicleType);
  const [motivation, setMotivation] = useState(d.motivation);
  const [licenseB64, setLicenseB64] = useState<string | null>(d.licenseB64);
  const [capturing, setCapturing] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [done, setDone] = useState(false);

  // Save each change into the draft immediately (save-as-you-go).
  const save = (patch: Parameters<typeof patchApplicationDraft>[0]) => {
    patchApplicationDraft(patch);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1200);
  };

  const captureLicense = () => {
    if (capturing) return;
    setCapturing(true);
    // ── REAL CAPTURE: replace stub with the license-photo capture SDK / picker.
    //    const uri = await ImagePicker.launchCameraAsync(...); const b64 = ...;
    setTimeout(() => {
      const b64 = stubCaptureBase64('license');
      setLicenseB64(b64);
      save({ licenseB64: b64 });
      setCapturing(false);
    }, 1000);
  };

  const canSubmit =
    fullName.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    !!homeState &&
    !!vehicle &&
    !submit.isPending;

  const onSubmit = () => {
    submit.mutate(
      {
        competitionId,
        homeState,
        payload: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          years_driving: years.trim(),
          vehicle_type: vehicle,
          motivation: motivation.trim(),
          license_photo_b64: licenseB64, // sandbox stub
        },
      },
      {
        onSuccess: () => {
          resetApplicationDraft();
          setDone(true);
        },
      },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application" showBack={false} />
        <StateView
          kind="empty"
          icon="CheckCircle2"
          title="Application submitted"
          message="You’re now APPLIED. We’ll review your details in screening and update your Compete tab."
          actionLabel="Go to Compete"
          onAction={() => router.replace({ pathname: '/arena/compete', params: { competitionId } })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Application"
        rightSlot={
          savedTick ? (
            <View style={styles.savedChip}><Save size={12} color={Colors.teal} /><Text style={styles.savedText}>Saved</Text></View>
          ) : null
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Tell us about you and your driving. Your answers save automatically as you go.</Text>

        <TextInputField label="Full name" placeholder="As on your licence" value={fullName}
          onChangeText={(t) => { setFullName(t); save({ fullName: t }); }} autoCapitalize="words" />
        <TextInputField label="Phone number" placeholder="080…" value={phone} keyboardType="phone-pad"
          onChangeText={(t) => { setPhone(t); save({ phone: t }); }} />
        <SelectField label="Home state (36 states + FCT)" placeholder="Select your state" value={homeState}
          options={NIGERIA_STATES} onChange={(v) => { setHomeState(v); save({ homeState: v }); }} />
        <TextInputField label="Years driving" placeholder="e.g. 6" value={years} keyboardType="number-pad"
          onChangeText={(t) => { setYears(t); save({ yearsDriving: t }); }} />
        <SelectField label="Vehicle type" placeholder="Select vehicle" value={vehicle}
          options={VEHICLE_TYPES} searchable={false} onChange={(v) => { setVehicle(v); save({ vehicleType: v }); }} />
        <TextInputField label="Why should you win? (optional)" placeholder="A sentence or two…" value={motivation}
          onChangeText={(t) => { setMotivation(t); save({ motivation: t }); }} multiline style={{ minHeight: 72 }} />

        {/* License upload stub */}
        <Text style={styles.label}>Driver’s licence photo</Text>
        <Pressable style={[styles.upload, licenseB64 && styles.uploadDone]} onPress={captureLicense} disabled={capturing}>
          <View style={styles.uploadIcon}>
            {capturing ? <ActivityIndicator color={Colors.primary} /> : licenseB64 ? <CheckCircle2 size={24} color={Colors.teal} /> : <Camera size={24} color={Colors.secondary} />}
          </View>
          <Text style={styles.uploadText}>{licenseB64 ? 'Licence captured' : capturing ? 'Capturing…' : 'Tap to capture your licence'}</Text>
        </Pressable>
        <View style={styles.privacy}>
          <Lock size={14} color={Colors.secondary} />
          <Text style={styles.privacyText}>
            We use your licence photo only to verify your eligibility for this competition. It’s stored securely and never shared with other users.
          </Text>
        </View>

        {submit.isError ? (
          <Text style={styles.error}>Couldn’t submit your application. Your draft is saved — tap Submit to retry.</Text>
        ) : null}

        <View style={{ height: Spacing.md }} />
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={submit.isPending ? 'Submitting…' : 'Submit application'} onPress={onSubmit} loading={submit.isPending} disabled={!canSubmit} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  upload: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLowest },
  uploadDone: { borderStyle: 'solid', borderColor: Colors.teal, backgroundColor: Colors.surfaceContainerLow },
  uploadIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  uploadText: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  privacy: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: Spacing.sm },
  privacyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.md },
  savedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  savedText: { ...Typography.caption, color: Colors.teal, fontWeight: '600' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
