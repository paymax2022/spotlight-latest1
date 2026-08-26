import React from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import {
  View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Pressable, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CheckCircle2, XCircle, Plus, Trash2, ShieldCheck, Sparkles, Clock3, Building2, BadgeCheck,
} from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import MultiSelectField from '@/components/MultiSelectField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import PaymentMethodSelector, { type PaymentMethod } from '@/components/PaymentMethodSelector';
import {
  checkName, registerNew, reserveName, payFee, submit, getStatus, getBusiness,
  initiateFeePaystack, verifyFeePaystack,
} from '@/api/business.api';
import { getWallet } from '@/api/wallet.api';
import { statusChip, toneColors } from '@/features/business/statusDisplay';
import { CertificateAction } from '@/features/business/CertificateAction';
import { getErrorMessage } from '@/utils/errorMapper';
import { formatNaira } from '@/utils/money';
import type { BusinessEntityType, BusinessProfile, BusinessProprietor } from '@/types/business';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITY_OPTIONS: { value: BusinessEntityType; label: string }[] = [
  { value: 'business_name',        label: 'Business name' },
  { value: 'company',              label: 'Company' },
  { value: 'incorporated_trustee', label: 'Trustee' },
];

const STEP_LABELS = ['Name', 'Proprietors', 'Fee', 'Status'];

// CAC registration fee (₦15,000 in kobo). Shown at review before the backend stamps
// the profile's feeKobo at pay time; the backend charge is authoritative.
const CAC_FEE_KOBO = 1_500_000;       // CAC registration fee (pass-through)
const PLATFORM_FEE_KOBO = 200_000;    // Paymax/Spotlight processing charge
const TOTAL_FEE_KOBO = CAC_FEE_KOBO + PLATFORM_FEE_KOBO; // ₦17,000

// Multi-select line-of-business categories (joined into a comma string for the API).
const LINE_OF_BUSINESS = [
  'Agriculture & Agro-allied', 'Trading / Retail', 'Wholesale / Distribution', 'Import & Export',
  'Fashion, Clothing & Tailoring', 'Beauty, Cosmetics & Salon', 'Food, Restaurant & Catering',
  'Hospitality & Tourism', 'ICT & Software', 'Telecommunications', 'Consulting & Professional Services',
  'Financial Services & Fintech', 'Construction & Engineering', 'Real Estate & Property',
  'Logistics, Haulage & Transport', 'Automobile & Auto Parts', 'Manufacturing & Production',
  'Oil, Gas & Energy', 'Media, Entertainment & Events', 'Education & Training',
  'Healthcare & Pharmaceuticals', 'Agro-processing', 'Printing & Publishing',
  'Mining & Solid Minerals', 'General Merchandise', 'Other',
];

// Single-select proprietor roles. Labels are shown; the backend receives the
// lowercased slug (e.g. "Company Secretary" → "company_secretary").
const ROLE_OPTIONS = [
  'Proprietor', 'Partner', 'Director', 'Trustee', 'Shareholder', 'Company Secretary', 'Signatory',
];
function roleSlug(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '_');
}

// Statuses that keep polling on the status step.
const POLLING_STATUSES = new Set<BusinessProfile['status']>([
  'registration_submitted', 'under_review', 'name_reserved', 'submitted',
]);

// ── Validation schemas ──────────────────────────────────────────────────────

const nameSchema = z.object({
  proposedName:   z.string().trim().min(2, 'Enter a proposed business name').max(120, 'Name is too long'),
  lineOfBusiness: z.array(z.string()).min(1, 'Select at least one line of business'),
});
type NameForm = z.infer<typeof nameSchema>;

const proprietorSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter a full name'),
  role:     z.string().trim().min(1, 'Select a role'),
  sharePct: z.string().trim().optional().or(z.literal('')),
  phone:    z.string().trim().optional().or(z.literal('')),
  email:    z.string().trim().email('Invalid email').optional().or(z.literal('')),
  bvn:      z.string().trim().optional().or(z.literal('')),
  nin:      z.string().trim().optional().or(z.literal('')),
});
const proprietorsSchema = z.object({
  proprietors: z.array(proprietorSchema).min(1, 'Add at least one proprietor'),
});
type ProprietorsForm = z.infer<typeof proprietorsSchema>;

function emptyProprietor(): ProprietorsForm['proprietors'][number] {
  return { fullName: '', role: 'Proprietor', sharePct: '', phone: '', email: '', bvn: '', nin: '' };
}

// Keep only digits, cap at 11 (BVN/NIN length).
function sanitizeId(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 11);
}

export default function RegisterBusinessScreen() {
  const qc = useQueryClient();
  const { resumeId } = useLocalSearchParams<{ resumeId?: string }>();

  const [step, setStep] = React.useState(0);
  const [entityType, setEntityType] = React.useState<BusinessEntityType>('business_name');
  const [business, setBusiness] = React.useState<BusinessProfile | null>(null);
  const [nameData, setNameData] = React.useState<NameForm | null>(null);
  const [nameCheck, setNameCheck] = React.useState<{ available: boolean; reason?: string; suggestions?: string[] } | null>(null);
  const [pin, setPin] = React.useState('');
  const [pinError, setPinError] = React.useState('');
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('WALLET');
  const [paystackRef, setPaystackRef] = React.useState<string | null>(null);
  const [paystackLoading, setPaystackLoading] = React.useState(false);
  const [paystackError, setPaystackError] = React.useState('');

  const { data: wallet } = useQuery({ queryKey: ['wallet', 'balance'], queryFn: getWallet });
  const feeNaira = TOTAL_FEE_KOBO / 100;

  // Resume an in-flight business if we were handed an id.
  const resumeQuery = useQuery({
    queryKey: ['business', resumeId],
    queryFn: () => getBusiness(resumeId as string),
    enabled: !!resumeId,
  });

  React.useEffect(() => {
    const b = resumeQuery.data;
    if (!b || business) return;
    setBusiness(b);
    setEntityType(b.entityType);
    setNameData({
      proposedName: b.proposedName ?? '',
      lineOfBusiness: b.lineOfBusiness ? b.lineOfBusiness.split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
    if (['registration_submitted', 'under_review', 'registered', 'rejected', 'failed', 'submitted'].includes(b.status)) {
      setStep(3); // already submitted → watch status
    } else if (b.status === 'name_reserved') {
      setStep(2); // name + proprietors captured → pay the fee
    } else {
      setStep(1); // draft with a checked name → collect proprietors
    }
  }, [resumeQuery.data, business]);

  // ── Forms ───────────────────────────────────────────────────────────────────
  const nameForm = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { proposedName: '', lineOfBusiness: [] },
  });

  const propForm = useForm<ProprietorsForm>({
    resolver: zodResolver(proprietorsSchema),
    defaultValues: { proprietors: [emptyProprietor()] },
  });
  const fieldArray = useFieldArray({ control: propForm.control, name: 'proprietors' });

  // ── Step 1: name availability check ──────────────────────────────────────────
  // (Register + reserve are deferred to step 2 so the single POST /register call
  //  carries the proprietors — the only endpoint that accepts them.)
  const nameMutation = useMutation({
    mutationFn: (values: NameForm) =>
      checkName({
        proposedName: values.proposedName,
        lineOfBusiness: values.lineOfBusiness.length ? values.lineOfBusiness.join(', ') : undefined,
        businessId: business?.id,
      }),
    onSuccess: (check, values) => {
      setNameCheck({ available: check.available, reason: check.reason, suggestions: check.suggestions });
      if (!check.available) return;
      setNameData(values);
      setStep(1);
    },
  });

  // ── Step 2: register draft (with proprietors) → reserve name ─────────────────
  const registerMutation = useMutation({
    mutationFn: async (proprietors: BusinessProprietor[]) => {
      const name = nameData ?? nameForm.getValues();
      // If we already have a reserved draft (resume), keep it; otherwise create one.
      let draft = business;
      if (!draft || draft.status === 'draft' || draft.status === 'name_check') {
        draft = await registerNew({
          entityType,
          proposedName: name.proposedName,
          lineOfBusiness: name.lineOfBusiness.length ? name.lineOfBusiness.join(', ') : undefined,
          proprietors,
        });
      }
      if (draft.status !== 'name_reserved') {
        draft = await reserveName(draft.id);
      }
      return draft;
    },
    onSuccess: (draft) => {
      setBusiness(draft);
      qc.invalidateQueries({ queryKey: ['business', 'me'] });
      setStep(2);
    },
  });

  // ── Step 3: pay fee → submit ─────────────────────────────────────────────────
  const feeMutation = useMutation({
    mutationFn: async () => {
      if (!business) throw new Error('No business to submit');
      await payFee(business.id);      // debit CAC fee (Idempotency-Key)
      return submit(business.id);     // submit to CAC (Idempotency-Key)
    },
    onSuccess: (submitted) => {
      setBusiness(submitted);
      qc.invalidateQueries({ queryKey: ['business', 'me'] });
      setStep(3);
    },
  });

  // ── Step 4: poll status ──────────────────────────────────────────────────────
  const statusQuery = useQuery({
    queryKey: ['business', business?.id, 'status'],
    queryFn: () => getStatus(business!.id),
    enabled: step === 3 && !!business?.id,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && POLLING_STATUSES.has(s) ? 5000 : false;
    },
  });
  React.useEffect(() => {
    if (statusQuery.data) setBusiness(statusQuery.data);
  }, [statusQuery.data]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const onCheckName = nameForm.handleSubmit((values) => {
    setNameCheck(null);
    nameMutation.mutate(values);
  });

  const onSaveProprietors = propForm.handleSubmit((values) => {
    const proprietors: BusinessProprietor[] = values.proprietors.map((p) => ({
      fullName: p.fullName.trim(),
      role: p.role ? roleSlug(p.role) : undefined,
      sharePct: p.sharePct ? Number(p.sharePct) : undefined,
      phone: p.phone?.trim() || undefined,
      email: p.email?.trim() || undefined,
      bvn: p.bvn?.trim() || undefined,
      nin: p.nin?.trim() || undefined,
    }));
    registerMutation.mutate(proprietors);
  });

  const onConfirmFee = () => {
    if (!/^\d{4}$/.test(pin)) {
      setPinError('Enter your 4-digit transaction PIN.');
      return;
    }
    setPinError('');
    feeMutation.mutate();
  };

  // ── Paystack (payment-gateway) fee flow ──────────────────────────────────────
  // Start a checkout, open the authorization URL, then confirm on return via verify.
  const onStartPaystack = async () => {
    if (!business) return;
    setPaystackError('');
    setPaystackLoading(true);
    try {
      const { authorizationUrl, reference, alreadyPaid } = await initiateFeePaystack(business.id, '');
      if (alreadyPaid) { setPaystackRef(reference); return; }
      if (!authorizationUrl) throw new Error('Paystack did not return a payment URL.');
      setPaystackRef(reference);
      await Linking.openURL(authorizationUrl); // gateway URL supplied by our backend
    } catch (err) {
      setPaystackError(getErrorMessage(err));
    } finally {
      setPaystackLoading(false);
    }
  };

  // After the user completes payment on the gateway, verify the reference then submit.
  const onVerifyPaystack = async () => {
    if (!business || !paystackRef) return;
    setPaystackError('');
    setPaystackLoading(true);
    try {
      await verifyFeePaystack(business.id, paystackRef);   // marks the fee paid (fails closed)
      const submitted = await submit(business.id);
      setBusiness(submitted);
      qc.invalidateQueries({ queryKey: ['business', 'me'] });
      setStep(3);
    } catch (err) {
      setPaystackError(getErrorMessage(err));
    } finally {
      setPaystackLoading(false);
    }
  };

  const goBack = () => {
    if (step === 0) { router.back(); return; }
    setStep((s) => Math.max(0, s - 1));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (resumeId && resumeQuery.isLoading && !business) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Register business" />
        <StateView kind="loading" message="Loading your registration" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Register a business name"
        onBack={goBack}
      />

      {/* Hero banner — declutters the header + sets context */}
      <LinearGradient
        colors={[Colors.primary, Colors.secondary ?? Colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.banner}
      >
        <View style={styles.bannerIcon}>
          <Building2 size={26} color={Colors.onPrimary} strokeWidth={2.2} />
        </View>
        <View style={styles.bannerCopy}>
          <Text style={styles.bannerTitle}>Register with CAC</Text>
          <Text style={styles.bannerSub}>Get your business name registered and receive your certificate.</Text>
          <View style={styles.bannerChips}>
            <View style={styles.bannerChip}>
              <BadgeCheck size={13} color={Colors.onPrimary} strokeWidth={2.4} />
              <Text style={styles.bannerChipText}>{formatNaira(TOTAL_FEE_KOBO)}</Text>
            </View>
            <View style={styles.bannerChip}>
              <ShieldCheck size={13} color={Colors.onPrimary} strokeWidth={2.4} />
              <Text style={styles.bannerChipText}>CAC certificate</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* Progress dots */}
      <View style={styles.progressRow}>
        {STEP_LABELS.map((label, i) => (
          <View key={label} style={styles.progressItem}>
            <View style={[styles.progressDot, i <= step && styles.progressDotActive]} />
            <Text style={[styles.progressLabel, i === step && styles.progressLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <>
              <Text style={styles.stepTitle}>Name your business</Text>
              <Text style={styles.stepDesc}>We'll check the proposed name against the CAC register.</Text>

              <Text style={styles.fieldLabel}>Entity type</Text>
              <SegmentedControl options={ENTITY_OPTIONS} value={entityType} onChange={setEntityType} />

              <View style={styles.field}>
                <Controller
                  name="proposedName"
                  control={nameForm.control}
                  render={({ field }) => (
                    <TextInputField
                      label="Proposed business name"
                      placeholder="e.g. Bright Futures Ventures"
                      autoCapitalize="words"
                      error={nameForm.formState.errors.proposedName?.message}
                      value={field.value}
                      onChangeText={(v) => { field.onChange(v); setNameCheck(null); }}
                    />
                  )}
                />
                <Controller
                  name="lineOfBusiness"
                  control={nameForm.control}
                  render={({ field }) => (
                    <MultiSelectField
                      label="Line of business"
                      placeholder="Select one or more"
                      options={LINE_OF_BUSINESS}
                      error={nameForm.formState.errors.lineOfBusiness?.message}
                      value={field.value ?? []}
                      onChange={field.onChange}
                    />
                  )}
                />
              </View>

              {nameCheck && (
                <View style={[styles.checkCard, nameCheck.available ? styles.checkOk : styles.checkBad]}>
                  <View style={styles.checkHeader}>
                    {nameCheck.available
                      ? <CheckCircle2 size={20} color="#15803D" strokeWidth={2} />
                      : <XCircle size={20} color={Colors.error} strokeWidth={2} />}
                    <Text style={styles.checkTitle}>
                      {nameCheck.available ? 'Name is available' : 'Name is taken'}
                    </Text>
                  </View>
                  {nameCheck.reason ? <Text style={styles.checkReason}>{nameCheck.reason}</Text> : null}
                  {!nameCheck.available && nameCheck.suggestions?.length ? (
                    <View style={styles.suggestions}>
                      <Text style={styles.suggestionsLabel}>Try one of these:</Text>
                      {nameCheck.suggestions.map((s) => (
                        <Pressable
                          key={s}
                          onPress={() => { nameForm.setValue('proposedName', s); setNameCheck(null); }}
                          style={styles.suggestionChip}
                        >
                          <Sparkles size={14} color={Colors.primary} strokeWidth={2} />
                          <Text style={styles.suggestionText}>{s}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}

              {nameMutation.isError ? <Text style={styles.apiError}>{getErrorMessage(nameMutation.error)}</Text> : null}

              <PrimaryButton
                label={nameMutation.isPending ? 'Checking…' : 'Check & reserve name'}
                onPress={onCheckName}
                loading={nameMutation.isPending}
              />
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.stepTitle}>Add proprietors</Text>
              <Text style={styles.stepDesc}>List the owners of the business. BVN/NIN are optional and stored securely.</Text>

              {fieldArray.fields.map((f, index) => (
                <View key={f.id} style={[styles.propCard, shadow1]}>
                  <View style={styles.propHeader}>
                    <Text style={styles.propHeaderTitle}>Proprietor {index + 1}</Text>
                    {fieldArray.fields.length > 1 ? (
                      <Pressable onPress={() => fieldArray.remove(index)} hitSlop={8}>
                        <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                      </Pressable>
                    ) : null}
                  </View>

                  <Controller
                    name={`proprietors.${index}.fullName`}
                    control={propForm.control}
                    render={({ field }) => (
                      <TextInputField
                        label="Full name"
                        placeholder="Full legal name"
                        autoCapitalize="words"
                        error={propForm.formState.errors.proprietors?.[index]?.fullName?.message}
                        value={field.value}
                        onChangeText={field.onChange}
                      />
                    )}
                  />
                  <Controller
                    name={`proprietors.${index}.role`}
                    control={propForm.control}
                    render={({ field }) => (
                      <SelectField
                        label="Role"
                        placeholder="Select a role"
                        options={ROLE_OPTIONS}
                        searchable={false}
                        error={propForm.formState.errors.proprietors?.[index]?.role?.message}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                  <Controller
                    name={`proprietors.${index}.sharePct`}
                    control={propForm.control}
                    render={({ field }) => (
                      <TextInputField
                        label="Ownership share % (optional)"
                        placeholder="e.g. 50"
                        keyboardType="number-pad"
                        value={field.value ?? ''}
                        onChangeText={(v) => field.onChange(v.replace(/[^\d]/g, '').slice(0, 3))}
                      />
                    )}
                  />
                  <Controller
                    name={`proprietors.${index}.phone`}
                    control={propForm.control}
                    render={({ field }) => (
                      <PhoneNumberInput label="Phone (optional)" value={field.value ?? ''} onChange={({ e164, nsn }) => (field.onChange)(e164 || nsn)} />
                    )}
                  />
                  <Controller
                    name={`proprietors.${index}.email`}
                    control={propForm.control}
                    render={({ field }) => (
                      <TextInputField
                        label="Email (optional)"
                        placeholder="name@example.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        error={propForm.formState.errors.proprietors?.[index]?.email?.message}
                        value={field.value ?? ''}
                        onChangeText={field.onChange}
                      />
                    )}
                  />
                  <Controller
                    name={`proprietors.${index}.bvn`}
                    control={propForm.control}
                    render={({ field }) => (
                      <TextInputField
                        label="BVN (optional)"
                        placeholder="11-digit BVN"
                        keyboardType="number-pad"
                        secure
                        value={field.value ?? ''}
                        onChangeText={(v) => field.onChange(sanitizeId(v))}
                      />
                    )}
                  />
                  <Controller
                    name={`proprietors.${index}.nin`}
                    control={propForm.control}
                    render={({ field }) => (
                      <TextInputField
                        label="NIN (optional)"
                        placeholder="11-digit NIN"
                        keyboardType="number-pad"
                        secure
                        value={field.value ?? ''}
                        onChangeText={(v) => field.onChange(sanitizeId(v))}
                      />
                    )}
                  />
                </View>
              ))}

              {typeof propForm.formState.errors.proprietors?.message === 'string' ? (
                <Text style={styles.apiError}>{propForm.formState.errors.proprietors.message}</Text>
              ) : null}

              <Pressable onPress={() => fieldArray.append(emptyProprietor())} style={styles.addBtn}>
                <Plus size={18} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.addBtnText}>Add another proprietor</Text>
              </Pressable>

              {registerMutation.isError ? <Text style={styles.apiError}>{getErrorMessage(registerMutation.error)}</Text> : null}

              <PrimaryButton
                label={registerMutation.isPending ? 'Saving…' : 'Continue'}
                onPress={onSaveProprietors}
                loading={registerMutation.isPending}
              />
            </>
          )}

          {step === 2 && business && (
            <>
              <Text style={styles.stepTitle}>Review & pay CAC fee</Text>
              <Text style={styles.stepDesc}>Confirm the details, then authorise the fee with your PIN.</Text>

              <View style={[styles.reviewCard, shadow1]}>
                <ReviewRow label="Proposed name" value={business.proposedName ?? nameForm.getValues('proposedName')} />
                <ReviewRow label="Entity type" value={ENTITY_OPTIONS.find((e) => e.value === entityType)?.label ?? entityType} />
                {business.cacReservationRef ? <ReviewRow label="Reservation ref" value={business.cacReservationRef} /> : null}
                <ReviewRow label="Proprietors" value={String(business.proprietors.length || propForm.getValues('proprietors').length)} />
                <View style={styles.reviewDivider} />
                <ReviewRow label="CAC registration fee" value={formatNaira(CAC_FEE_KOBO)} />
                <ReviewRow label="Platform fee" value={formatNaira(PLATFORM_FEE_KOBO)} />
                <View style={styles.reviewDivider} />
                <ReviewRow label="Total" value={formatNaira(TOTAL_FEE_KOBO)} highlight />
              </View>

              <PaymentMethodSelector
                selected={paymentMethod}
                onSelect={(m) => { setPaymentMethod(m); setPaystackError(''); setPinError(''); }}
                walletBalance={wallet?.balance}
                amount={feeNaira}
              />

              {paymentMethod === 'WALLET' ? (
                <>
                  <View style={[styles.pinCard, shadow1]}>
                    <View style={styles.pinHeader}>
                      <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
                      <Text style={styles.pinTitle}>Authorise payment</Text>
                    </View>
                    <TextInputField
                      label="Transaction PIN"
                      placeholder="••••"
                      keyboardType="number-pad"
                      secure
                      maxLength={4}
                      error={pinError}
                      value={pin}
                      onChangeText={(v) => { setPin(v.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
                    />
                  </View>

                  {feeMutation.isError ? <Text style={styles.apiError}>{getErrorMessage(feeMutation.error)}</Text> : null}

                  <PrimaryButton
                    label={feeMutation.isPending ? 'Processing…' : `Pay ${formatNaira(TOTAL_FEE_KOBO)} & submit`}
                    onPress={onConfirmFee}
                    loading={feeMutation.isPending}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.stepDesc}>
                    You'll be taken to Paystack to pay {formatNaira(TOTAL_FEE_KOBO)} securely. Return here and tap
                    verify to submit your registration.
                  </Text>

                  {paystackError ? <Text style={styles.apiError}>{paystackError}</Text> : null}

                  {!paystackRef ? (
                    <PrimaryButton
                      label={paystackLoading ? 'Opening Paystack…' : `Pay ${formatNaira(TOTAL_FEE_KOBO)} with Paystack`}
                      onPress={onStartPaystack}
                      loading={paystackLoading}
                    />
                  ) : (
                    <>
                      <PrimaryButton
                        label={paystackLoading ? 'Verifying…' : "I've paid — verify & submit"}
                        onPress={onVerifyPaystack}
                        loading={paystackLoading}
                      />
                      <Pressable onPress={onStartPaystack} disabled={paystackLoading} style={styles.reopenLink}>
                        <Text style={styles.reopenLinkText}>Re-open Paystack payment</Text>
                      </Pressable>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {step === 3 && business && (
            <StatusStep business={business} isPolling={statusQuery.isFetching} onDone={() => router.replace('/profile/business' as never)} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Status step ────────────────────────────────────────────────────────────────
function StatusStep({ business, isPolling, onDone }: { business: BusinessProfile; isPolling: boolean; onDone: () => void }) {
  const chip = statusChip(business.status);
  const tc = toneColors(chip.tone);
  const done = business.status === 'registered' || business.status === 'verified';
  const failed = business.status === 'rejected' || business.status === 'failed';
  const pending = !done && !failed;

  return (
    <View style={styles.statusWrap}>
      <View style={[styles.statusIcon, { backgroundColor: tc.bg }]}>
        {done
          ? <CheckCircle2 size={40} color={tc.fg} strokeWidth={2} />
          : failed
            ? <XCircle size={40} color={tc.fg} strokeWidth={2} />
            : <Clock3 size={40} color={tc.fg} strokeWidth={2} />}
      </View>

      <Text style={styles.statusTitle}>
        {done ? 'Registration complete' : failed ? 'Registration unsuccessful' : 'Submitted to CAC'}
      </Text>
      <Text style={[styles.chip, { backgroundColor: tc.bg, color: tc.fg, alignSelf: 'center', marginTop: Spacing.xs }]}>{chip.label}</Text>

      {pending ? (
        <View style={styles.pollRow}>
          {isPolling ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
          <Text style={styles.statusMsg}>
            We're waiting for CAC to confirm your registration. This can take a little while — this screen updates automatically.
          </Text>
        </View>
      ) : null}

      {done && business.rcOrBnNumber ? (
        <View style={[styles.reviewCard, shadow1, { marginTop: Spacing.lg, width: '100%' }]}>
          <ReviewRow label="Business name" value={business.legalName ?? business.proposedName ?? '—'} />
          <ReviewRow label="RC / BN number" value={business.rcOrBnNumber} highlight />
          {business.cacRegistrationRef ? <ReviewRow label="Registration ref" value={business.cacRegistrationRef} /> : null}
          {business.registeredAt ? <ReviewRow label="Registered" value={new Date(business.registeredAt).toLocaleDateString()} /> : null}
        </View>
      ) : null}

      {done ? <CertificateAction business={business} style={{ marginTop: Spacing.lg }} /> : null}

      {failed ? (
        <Text style={styles.statusMsg}>
          {(business.metadata?.reason as string | undefined)
            ?? 'CAC could not complete this registration. Please review your details and try again.'}
        </Text>
      ) : null}

      {(done || failed) ? (
        <PrimaryButton label="Done" onPress={onDone} style={{ marginTop: Spacing.lg }} />
      ) : null}
    </View>
  );
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={[styles.reviewValue, highlight && { color: Colors.primary, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...shadow1,
  },
  bannerIcon: {
    width: 48, height: 48, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  bannerCopy:  { flex: 1, gap: 4 },
  bannerTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  bannerSub:   { ...Typography.labelSm, color: Colors.onPrimary, opacity: 0.9, lineHeight: 16 },
  bannerChips: { flexDirection: 'row', gap: Spacing.xs, marginTop: 2 },
  bannerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full,
  },
  bannerChipText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
  progressRow: { flexDirection: 'row', paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, gap: Spacing.xs },
  progressItem:{ flex: 1, alignItems: 'center', gap: 4 },
  progressDot: { width: '100%', height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh },
  progressDotActive:{ backgroundColor: Colors.primary },
  progressLabel:{ ...Typography.caption, color: Colors.onSurfaceVariant },
  progressLabelActive:{ color: Colors.primary, fontWeight: '700' },
  stepTitle:   { ...Typography.headlineMd, color: Colors.onSurface },
  stepDesc:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  fieldLabel:  { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  field:       { marginTop: Spacing.lg },
  checkCard:   { borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, marginBottom: Spacing.md, marginTop: Spacing.sm },
  checkOk:     { backgroundColor: 'rgba(22,163,74,0.08)', borderColor: 'rgba(22,163,74,0.4)' },
  checkBad:    { backgroundColor: Colors.errorContainer, borderColor: Colors.error },
  checkHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkTitle:  { ...Typography.labelLg, color: Colors.onSurface },
  checkReason: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  suggestions: { marginTop: Spacing.md, gap: Spacing.sm },
  suggestionsLabel:{ ...Typography.labelSm, color: Colors.onSurfaceVariant },
  suggestionChip:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, alignSelf: 'flex-start' },
  suggestionText:{ ...Typography.labelMd, color: Colors.primary },
  apiError:    { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.md, textAlign: 'center' },
  reopenLink:  { alignSelf: 'center', paddingVertical: Spacing.sm, marginTop: Spacing.sm },
  reopenLinkText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '600' },
  propCard:    { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  propHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  propHeaderTitle:{ ...Typography.labelLg, color: Colors.onSurface },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', marginBottom: Spacing.lg },
  addBtnText:  { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
  reviewCard:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  reviewRow:   { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.xs },
  reviewLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  reviewValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  reviewDivider:{ height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.sm },
  pinCard:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  pinHeader:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  pinTitle:    { ...Typography.labelLg, color: Colors.onSurface },
  statusWrap:  { alignItems: 'center', paddingTop: Spacing.xl },
  statusIcon:  { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg },
  statusTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  chip:        { ...Typography.labelSm, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, overflow: 'hidden', fontWeight: '700' },
  pollRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg },
  statusMsg:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 18, marginTop: Spacing.md, paddingHorizontal: Spacing.md, flex: 1 },
});
