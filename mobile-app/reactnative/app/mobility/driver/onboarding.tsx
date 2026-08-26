import React, { useMemo, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, FileUp, CheckCircle2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useDriverMe, useDriverOnboarding } from '@/features/mobility/hooks/useMobility';
import { pickFileForField } from '@/features/registration/utils/filePicker';
import { SERVICE_TYPES, REQUIRED_DOCUMENTS } from '@/features/mobility/constants/mobility.constants';
import type { ServiceType, DocType } from '@/features/mobility/types/mobility.types';

type Step = 'details' | 'documents' | 'vehicle' | 'status';
const STEP_ORDER: Step[] = ['details', 'documents', 'vehicle', 'status'];
const STEP_TITLE: Record<Step, string> = { details: 'Your details', documents: 'Upload documents', vehicle: 'Add your vehicle', status: 'Application status' };

export default function DriverOnboardingScreen() {
  const me = useDriverMe();
  const { submit, uploadDocFile, addVehicle } = useDriverOnboarding();
  const { service } = useLocalSearchParams<{ service?: string }>();
  const isTowing = service === 'towing';
  const flowTitle = isTowing ? 'Towing partner onboarding' : 'Driver onboarding';

  const [step, setStep] = useState<Step>('details');

  // Details
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [categories, setCategories] = useState<ServiceType[]>(['economy']);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Vehicle
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [vehError, setVehError] = useState<string | null>(null);

  const profile = me.data;
  const uploadedDocs = useMemo(() => new Set((profile?.documents ?? []).map((d) => d.docType)), [profile]);
  const allDocsUploaded = REQUIRED_DOCUMENTS.every((d) => uploadedDocs.has(d.docType));
  const stepIndex = STEP_ORDER.indexOf(step);

  // If already submitted, jump to status.
  React.useEffect(() => {
    if (profile && profile.verificationStatus !== 'not_started' && step === 'details') setStep('status');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.verificationStatus]);

  const toggleCategory = (c: ServiceType) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const onSubmitDetails = () => {
    setDetailsError(null);
    if (!/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ''))) { setDetailsError('Enter a valid phone number.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setDetailsError('Enter a valid email.'); return; }
    if (categories.length === 0) { setDetailsError('Pick at least one service category.'); return; }
    submit.mutate(
      { phone: phone.trim(), email: email.trim(), serviceCategories: categories },
      { onSuccess: () => setStep('documents') },
    );
  };

  const onUploadDoc = async (docType: DocType) => {
    // Real flow: shared registration file picker → backend R2 presign → PUT the
    // file → submit the object key. Reuses features/registration/utils/filePicker
    // (image or document) and features/mobility uploadDriverDocumentFile — no new
    // storage backend. Accept a photo or a PDF for any document.
    const picked = await pickFileForField('.jpg,.jpeg,.png,.pdf');
    if (!picked) return;
    uploadDocFile.mutate(
      { docType, file: { uri: picked.uri, name: picked.name, mimeType: picked.mimeType } },
      { onError: () => Alert.alert('Upload failed', 'Could not upload that document. Please try again.') },
    );
  };

  const onAddVehicle = () => {
    setVehError(null);
    if (!plate.trim() || !make.trim() || !model.trim()) { setVehError('Fill in the plate, make and model.'); return; }
    const yr = Number(year);
    if (!yr || yr < 2000 || yr > new Date().getFullYear() + 1) { setVehError('Enter a valid year.'); return; }
    addVehicle.mutate(
      { plateNumber: plate.trim().toUpperCase(), make: make.trim(), model: model.trim(), year: yr, color: color.trim() || 'Black', category: categories[0] ?? 'economy', capacity: SERVICE_TYPES.find((s) => s.value === (categories[0] ?? 'economy'))?.seats ?? 4 },
      { onSuccess: () => setStep('status') },
    );
  };

  if (me.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={flowTitle} />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (me.isError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={flowTitle} />
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => me.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={STEP_TITLE[step]} subtitle={step !== 'status' ? `Step ${stepIndex + 1} of 3` : undefined} onBack={() => (stepIndex > 0 && step !== 'status' ? setStep(STEP_ORDER[stepIndex - 1]) : router.back())} />

      {/* Progress */}
      {step !== 'status' && (
        <View style={styles.progress}>
          {STEP_ORDER.slice(0, 3).map((s, i) => (
            <View key={s} style={[styles.progressSeg, i <= stepIndex && styles.progressSegActive]} />
          ))}
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {step === 'details' && (
          <>
            {isTowing && (
              <View style={styles.towBanner}>
                <Text style={styles.towBannerTitle}>Towing van service</Text>
                <Text style={styles.towBannerText}>Register your tow truck and documents to start receiving tow & roadside jobs on Paymax.</Text>
              </View>
            )}
            <PhoneNumberInput label="Phone number" value={phone} onChange={({ e164, nsn }) => (setPhone)(e164 || nsn)} />
            <TextInputField label="Email" placeholder="you@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <Text style={styles.fieldLabel}>Service categories</Text>
            <View style={styles.chips}>
              {SERVICE_TYPES.map((meta) => {
                const active = categories.includes(meta.value);
                return (
                  <Pressable key={meta.value} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleCategory(meta.value)}>
                    {active && <Check size={14} color={Colors.primary} strokeWidth={2.5} />}
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{meta.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {detailsError ? <Text style={styles.error}>{detailsError}</Text> : null}
          </>
        )}

        {step === 'documents' && (
          <>
            <Text style={styles.help}>Upload clear photos. Documents with an expiry date are tracked and you will be alerted before they lapse.</Text>
            {REQUIRED_DOCUMENTS.map((doc) => {
              const uploaded = uploadedDocs.has(doc.docType);
              return (
                <Pressable key={doc.docType} style={[styles.docRow, uploaded && styles.docRowDone]} onPress={() => !uploaded && onUploadDoc(doc.docType)} disabled={uploaded || uploadDocFile.isPending}>
                  <View style={[styles.docIcon, uploaded && styles.docIconDone]}>
                    {uploaded ? <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.5} /> : <FileUp size={18} color={Colors.secondary} strokeWidth={2} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docLabel}>{doc.label}</Text>
                    <Text style={styles.docHint}>
                      {uploaded
                        ? 'Uploaded'
                        : uploadDocFile.isPending && uploadDocFile.variables?.docType === doc.docType
                        ? 'Uploading…'
                        : doc.hint}
                    </Text>
                  </View>
                  {!uploaded && <Text style={styles.docAction}>Upload</Text>}
                </Pressable>
              );
            })}
          </>
        )}

        {step === 'vehicle' && (
          <>
            <TextInputField label="Plate number" placeholder="LND-238-KJA" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
            <View style={styles.row2}>
              <View style={styles.col}><TextInputField label="Make" placeholder="Toyota" value={make} onChangeText={setMake} /></View>
              <View style={styles.col}><TextInputField label="Model" placeholder="Corolla" value={model} onChangeText={setModel} /></View>
            </View>
            <View style={styles.row2}>
              <View style={styles.col}><TextInputField label="Year" placeholder="2021" value={year} onChangeText={setYear} keyboardType="number-pad" /></View>
              <View style={styles.col}><TextInputField label="Color" placeholder="Silver" value={color} onChangeText={setColor} /></View>
            </View>
            {vehError ? <Text style={styles.error}>{vehError}</Text> : null}
          </>
        )}

        {step === 'status' && (
          <View style={styles.statusBody}>
            <View style={styles.statusIcon}>
              {profile.verificationStatus === 'approved'
                ? <CheckCircle2 size={36} color={Colors.tertiaryContainer} strokeWidth={2} />
                : <Clock size={36} color={Colors.primary} strokeWidth={2} />}
            </View>
            <Text style={styles.statusTitle}>
              {profile.verificationStatus === 'approved' ? 'You are approved!' : 'Application submitted'}
            </Text>
            <StatusBadge verification={profile.verificationStatus} />
            <Text style={styles.statusSub}>
              {profile.verificationStatus === 'approved'
                ? 'You can now go online and start accepting trips.'
                : 'Our team is reviewing your details and documents. This usually takes 1–2 business days. We will notify you of the outcome.'}
            </Text>
            {profile.rejectionReason ? <Text style={styles.error}>{profile.rejectionReason}</Text> : null}
            <PrimaryButton
              label={profile.verificationStatus === 'approved' ? 'Go to driver home' : 'Back to driver home'}
              onPress={() => router.replace('/mobility/driver')}
              style={{ marginTop: Spacing.lg }}
            />
          </View>
        )}
      </ScrollView>

      {/* Step CTA */}
      {step !== 'status' && (
        <View style={styles.footer}>
          {step === 'details' && (
            <PrimaryButton label="Continue" onPress={onSubmitDetails} loading={submit.isPending} />
          )}
          {step === 'documents' && (
            <PrimaryButton label="Continue" onPress={() => setStep('vehicle')} disabled={!allDocsUploaded} />
          )}
          {step === 'vehicle' && (
            <PrimaryButton label="Submit for review" onPress={onAddVehicle} loading={addVehicle.isPending} />
          )}
          {step === 'documents' && !allDocsUploaded && (
            <Text style={styles.footerHint}>Upload all required documents to continue.</Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  progress: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh },
  progressSegActive: { backgroundColor: Colors.primary },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.lg },
  towBanner: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm, gap: 3 },
  towBannerTitle: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' as const },
  towBannerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.primary },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm, lineHeight: 18 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginBottom: Spacing.sm },
  docRowDone: { backgroundColor: Colors.tertiaryFixed, borderColor: Colors.tertiaryFixedDim },
  docIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  docIconDone: { backgroundColor: Colors.surfaceContainerLowest },
  docLabel: { ...Typography.labelLg, color: Colors.onSurface },
  docHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  docAction: { ...Typography.labelMd, color: Colors.secondary },
  row2: { flexDirection: 'row', gap: Spacing.md },
  col: { flex: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  statusBody: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  statusIcon: { width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  statusTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  statusSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  footerHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
