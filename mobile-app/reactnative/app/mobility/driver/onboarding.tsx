import React, { useMemo, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, FileUp, CheckCircle2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useAuthStore } from '@/store/authStore';
import { useDriverMe, useDriverOnboarding, useDriverOnboardingOptions } from '@/features/mobility/hooks/useMobility';
import { pickFileForField } from '@/features/registration/utils/filePicker';
import { SERVICE_TYPES, REQUIRED_DOCUMENTS, VEHICLE_MAKES, VEHICLE_COLORS, vehicleYears } from '@/features/mobility/constants/mobility.constants';
import type { ServiceType, DocType } from '@/features/mobility/types/mobility.types';
import {
  requiredDocumentsFor,
  canContinueServicesStep,
  areasForState,
  coverageAreaLabel,
  SERVICE_INTERESTS,
  STATE_OPTIONS,
  COVERAGE_FALLBACK,
  type VehicleType,
} from '@/features/mobility/deliveryOnboarding';

type Step = 'details' | 'services' | 'documents' | 'vehicle' | 'status';
const DELIVERY_ONBOARDING = process.env.EXPO_PUBLIC_DELIVERY_ONBOARDING !== 'false' && process.env.EXPO_PUBLIC_DELIVERY_ONBOARDING !== '0';
const STEP_ORDER: Step[] = DELIVERY_ONBOARDING
  ? ['details', 'services', 'vehicle', 'documents', 'status']
  : ['details', 'documents', 'vehicle', 'status'];
const STEP_TITLE: Record<Step, string> = { details: 'Your details', services: 'Services & coverage', documents: 'Upload documents', vehicle: 'Add your vehicle', status: 'Application status' };
const DOC_META: Record<string, { label: string; hint: string }> = Object.fromEntries(REQUIRED_DOCUMENTS.map((d) => [d.docType, { label: d.label, hint: d.hint }]));

const modelsForMake = (make: string): string[] =>
  VEHICLE_MAKES.find((m) => m.make === make)?.models ?? [];

// A failed submit used to leave the button spinning back to idle with nothing
// shown, so Continue looked dead. Say what the server (or the network) said.
function submitErrorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { status?: number; data?: { error?: string; message?: string } } };
  if (!err?.response) return 'No connection. Check your internet and try again.';
  const detail = err.response.data?.error ?? err.response.data?.message;
  return detail ? `${fallback} (${detail})` : `${fallback} (error ${err.response.status ?? 'unknown'}).`;
}

export default function DriverOnboardingScreen() {
  const me = useDriverMe();
  const { submit, uploadDocFile, addVehicle, setServiceProfile } = useDriverOnboarding();
  const onboardingOptions = useDriverOnboardingOptions();
  const serviceOptions = onboardingOptions.data?.services ?? SERVICE_INTERESTS;
  const stateOptions = onboardingOptions.data?.states ?? STATE_OPTIONS;
  const areaOptions = onboardingOptions.data?.coverageAreas ?? COVERAGE_FALLBACK;
  const { service } = useLocalSearchParams<{ service?: string }>();
  const isTowing = service === 'towing';
  const flowTitle = isTowing ? 'Towing partner onboarding' : 'Driver onboarding';

  const [step, setStep] = useState<Step>('details');

  // Details
  // Phone and email are captured at sign-up — never ask for them again. The
  // inputs below only render if the account is genuinely missing one of them.
  const accountUser = useAuthStore((st) => st.user);
  const accountPhone = accountUser?.phone?.trim() ?? '';
  const accountEmail = accountUser?.email?.trim() ?? '';
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const phone = accountPhone || phoneInput;
  const email = accountEmail || emailInput;
  const [categories, setCategories] = useState<ServiceType[]>(['economy']);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Vehicle
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [vehError, setVehError] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [serviceInterests, setServiceInterests] = useState<string[]>([]);
  const [coverageState, setCoverageState] = useState('');
  const [coverageAreas, setCoverageAreas] = useState<string[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const stateAreas = useMemo(() => areasForState(areaOptions, coverageState), [areaOptions, coverageState]);

  const profile = me.data;
  const uploadedDocs = useMemo(() => new Set((profile?.documents ?? []).map((d) => d.docType)), [profile]);
  const requiredDocTypes: DocType[] = DELIVERY_ONBOARDING ? requiredDocumentsFor(vehicleType) : REQUIRED_DOCUMENTS.map((d) => d.docType);
  const allDocsUploaded = requiredDocTypes.every((dt) => uploadedDocs.has(dt));
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
      {
        onSuccess: () => setStep(DELIVERY_ONBOARDING ? 'services' : 'documents'),
        onError: (e) => setDetailsError(submitErrorMessage(e, 'Could not save your details')),
      },
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
      {
        onError: (e) => {
          const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string };
          const reason = err.response?.data?.error ?? err.message;
          const status = err.response?.status;
          Alert.alert('Upload failed', `${reason ? `${reason}${status ? ` (${status})` : ''}` : 'Could not upload that document.'} Please try again.`);
        },
      },
    );
  };

  const onServicesContinue = () => {
    setServicesError(null);
    if (!coverageState) { setServicesError('Choose the state you operate in first.'); return; }
    if (!canContinueServicesStep(serviceInterests, coverageAreas)) { setServicesError('Pick at least one service and one area in that state.'); return; }
    setServiceProfile.mutate(
      { interests: serviceInterests, areas: coverageAreas },
      {
        onSuccess: () => setStep('vehicle'),
        onError: (e) => setServicesError(submitErrorMessage(e, 'Could not save your services')),
      },
    );
  };

  const onAddVehicle = () => {
    setVehError(null);
    const isBicycle = DELIVERY_ONBOARDING && vehicleType === 'bicycle';
    const yr = Number(year);
    if (!isBicycle) {
      if (!plate.trim() || !make.trim() || !model.trim()) { setVehError('Fill in the plate, make and model.'); return; }
      if (!yr || yr < 2000 || yr > new Date().getFullYear() + 1) { setVehError('Enter a valid year.'); return; }
    }
    addVehicle.mutate(
      { plateNumber: isBicycle ? '' : plate.trim().toUpperCase(), make: isBicycle ? '' : make.trim(), model: isBicycle ? '' : model.trim(), year: isBicycle ? 0 : yr, color: color.trim() || 'Black', category: categories[0] ?? 'economy', capacity: SERVICE_TYPES.find((s) => s.value === (categories[0] ?? 'economy'))?.seats ?? 4, vehicleType: DELIVERY_ONBOARDING ? vehicleType : undefined },
      {
        onSuccess: () => setStep(DELIVERY_ONBOARDING ? 'documents' : 'status'),
        onError: (e) => setVehError(submitErrorMessage(e, 'Could not add your vehicle')),
      },
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
        <MobilityEdgeState kind={errKind(me.error)} actionLabel="Retry" onAction={() => me.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={STEP_TITLE[step]} subtitle={step !== 'status' ? `Step ${stepIndex + 1} of ${STEP_ORDER.length - 1}` : undefined} onBack={() => (stepIndex > 0 && step !== 'status' ? setStep(STEP_ORDER[stepIndex - 1]) : goBack('/mobility/driver'))} />

      {/* Progress */}
      {step !== 'status' && (
        <View style={styles.progress}>
          {STEP_ORDER.slice(0, STEP_ORDER.length - 1).map((s, i) => (
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
            {!accountPhone && (
              <PhoneNumberInput label="Phone number" value={phoneInput} onChange={({ e164, nsn }) => setPhoneInput(e164 || nsn)} />
            )}
            {!accountEmail && (
              <TextInputField label="Email" placeholder="you@email.com" value={emailInput} onChangeText={setEmailInput} keyboardType="email-address" autoCapitalize="none" />
            )}
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

        {step === 'services' && (
          <>
            <Text style={styles.fieldLabel}>Services you want to offer</Text>
            <View style={styles.chips}>
              {serviceOptions.map((s) => {
                const active = serviceInterests.includes(s.value);
                return (
                  <Pressable key={s.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setServiceInterests((prev) => (prev.includes(s.value) ? prev.filter((x) => x !== s.value) : [...prev, s.value]))}>
                    {active && <Check size={14} color={Colors.primary} strokeWidth={2.5} />}
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {/* State first: a driver covers ONE state, and the city list only
                makes sense inside it (six LGA names repeat across states). */}
            <SelectField
              label="State you operate in"
              placeholder="Choose a state"
              value={stateOptions.find((s) => s.value === coverageState)?.label}
              options={stateOptions.map((s) => s.label)}
              onChange={(label) => {
                const next = stateOptions.find((s) => s.label === label)?.value ?? '';
                if (next === coverageState) return;
                setCoverageState(next);
                // Areas are namespaced per state, so a city picked in the old
                // state is not a valid value for the new one.
                setCoverageAreas([]);
                setServicesError(null);
              }}
            />
            <Text style={styles.fieldLabel}>Areas you cover</Text>
            {coverageState ? (
              <View style={styles.chips}>
                {stateAreas.map((a) => {
                  const active = coverageAreas.includes(a.value);
                  return (
                    <Pressable key={a.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setCoverageAreas((prev) => (prev.includes(a.value) ? prev.filter((x) => x !== a.value) : [...prev, a.value]))}>
                      {active && <Check size={14} color={Colors.primary} strokeWidth={2.5} />}
                      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{a.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.help}>Choose a state above to see its cities.</Text>
            )}
            {servicesError ? <Text style={styles.error}>{servicesError}</Text> : null}
          </>
        )}

        {step === 'documents' && (
          <>
            <Text style={styles.help}>Upload clear photos. Documents with an expiry date are tracked and you will be alerted before they lapse.</Text>
            {requiredDocTypes.map((docType) => {
              const meta = DOC_META[docType] ?? { label: docType, hint: '' };
              const uploaded = uploadedDocs.has(docType);
              return (
                <Pressable key={docType} style={[styles.docRow, uploaded && styles.docRowDone]} onPress={() => !uploaded && onUploadDoc(docType)} disabled={uploaded || uploadDocFile.isPending}>
                  <View style={[styles.docIcon, uploaded && styles.docIconDone]}>
                    {uploaded ? <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.5} /> : <FileUp size={18} color={Colors.secondary} strokeWidth={2} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docLabel}>{meta.label}</Text>
                    <Text style={styles.docHint}>
                      {uploaded
                        ? 'Uploaded'
                        : uploadDocFile.isPending && uploadDocFile.variables?.docType === docType
                        ? 'Uploading…'
                        : meta.hint}
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
            {DELIVERY_ONBOARDING && (
              <>
                <Text style={styles.fieldLabel}>Vehicle type</Text>
                <View style={styles.chips}>
                  {(['car', 'motorcycle', 'bicycle'] as VehicleType[]).map((vt) => {
                    const active = vehicleType === vt;
                    return (
                      <Pressable key={vt} style={[styles.chip, active && styles.chipActive]} onPress={() => setVehicleType(vt)}>
                        {active && <Check size={14} color={Colors.primary} strokeWidth={2.5} />}
                        <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{vt === 'car' ? 'Car' : vt === 'motorcycle' ? 'Motorcycle' : 'Bicycle'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            {(!DELIVERY_ONBOARDING || vehicleType !== 'bicycle') && (
              <>
                <TextInputField label="Plate number" placeholder="LND-238-KJA" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
                <SelectField
                  label="Make"
                  placeholder="Select make"
                  value={make}
                  options={VEHICLE_MAKES.map((m) => m.make)}
                  onChange={(next) => {
                    setMake(next);
                    // Models are per make — a Corolla does not belong under Lexus.
                    if (!modelsForMake(next).includes(model)) setModel('');
                  }}
                />
                <SelectField
                  label="Model"
                  placeholder={make ? 'Select model' : 'Select a make first'}
                  value={model}
                  options={modelsForMake(make)}
                  onChange={setModel}
                  disabled={!make}
                />
                <View style={styles.row2}>
                  <View style={styles.col}>
                    <SelectField label="Year" placeholder="Select year" value={year} options={vehicleYears()} onChange={setYear} />
                  </View>
                  <View style={styles.col}>
                    <SelectField label="Color" placeholder="Select color" value={color} options={[...VEHICLE_COLORS]} onChange={setColor} />
                  </View>
                </View>
              </>
            )}
            {DELIVERY_ONBOARDING && vehicleType === 'bicycle' && (
              <Text style={styles.help}>No plate or vehicle papers are needed for a bicycle — just your ID and proof of address next.</Text>
            )}
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
            {DELIVERY_ONBOARDING && ((profile.serviceInterests ?? []).length > 0 || (profile.coverageAreas ?? []).length > 0) ? (
              <View style={styles.statusChipsWrap}>
                {(profile.serviceInterests ?? []).length > 0 && (
                  <>
                    <Text style={styles.statusChipsLabel}>Services you offer</Text>
                    <View style={styles.chips}>
                      {(profile.serviceInterests ?? []).map((v) => (
                        <View key={v} style={styles.readonlyChip}><Text style={styles.readonlyChipText}>{serviceOptions.find((o) => o.value === v)?.label ?? v}</Text></View>
                      ))}
                    </View>
                  </>
                )}
                {(profile.coverageAreas ?? []).length > 0 && (
                  <>
                    <Text style={styles.statusChipsLabel}>Areas you cover</Text>
                    <View style={styles.chips}>
                      {(profile.coverageAreas ?? []).map((v) => (
                        <View key={v} style={styles.readonlyChip}><Text style={styles.readonlyChipText}>{coverageAreaLabel(v, areaOptions)}</Text></View>
                      ))}
                    </View>
                  </>
                )}
              </View>
            ) : null}
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
          {step === 'services' && (
            <PrimaryButton label="Continue" onPress={onServicesContinue} loading={setServiceProfile.isPending} />
          )}
          {step === 'vehicle' && (
            <PrimaryButton label={DELIVERY_ONBOARDING ? 'Continue' : 'Submit for review'} onPress={onAddVehicle} loading={addVehicle.isPending} />
          )}
          {step === 'documents' && (
            <PrimaryButton label={DELIVERY_ONBOARDING ? 'Submit for review' : 'Continue'} onPress={() => setStep(DELIVERY_ONBOARDING ? 'status' : 'vehicle')} disabled={!allDocsUploaded} />
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
  statusChipsWrap: { width: '100%', gap: Spacing.sm, marginTop: Spacing.md },
  statusChipsLabel: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  readonlyChip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed },
  readonlyChipText: { ...Typography.labelSm, color: Colors.primary },
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
