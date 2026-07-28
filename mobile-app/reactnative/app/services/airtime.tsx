import React, { useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal,
  ActivityIndicator, TextInput, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, CircleHelp, CheckCircle2, ShieldCheck, X } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import BillReviewSecurityPanel, { calculateBillReview, formatNaira } from '@/components/BillReviewSecurityPanel';
import PaymentMethodSelector, { type PaymentMethod } from '@/components/PaymentMethodSelector';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import { getAirtimeNetworks, initiateAirtimePaystack, purchaseAirtime, getProviderLogos, resolveProviderImage } from '@/api/billing.api';
import ProviderLogo from '@/components/ProviderLogo';
import { getWallet } from '@/api/wallet.api';
import { getErrorMessage } from '@/utils/errorMapper';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { Network } from '@/types/billing';

const AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

const schema = z.object({
  phoneNumber: z
    .string()
    .min(10, 'Enter a valid phone number')
    .regex(/^(\+234|0)[789][01]\d{8}$/, 'Enter a valid Nigerian phone number'),
  amount: z.number({ invalid_type_error: 'Enter an amount' }).min(50, 'Minimum ₦50').max(50000, 'Maximum ₦50,000'),
});
type Form = z.infer<typeof schema>;

export default function AirtimeScreen() {
  const qc = useQueryClient();

  const [selectedNetwork,   setSelectedNetwork]   = useState<Network | null>(null);
  const [customAmount,      setCustomAmount]       = useState('');
  const [quickAmount,       setQuickAmount]        = useState<number | null>(null);
  const [showConfirm,       setShowConfirm]        = useState(false);
  const [pendingPayload,    setPendingPayload]     = useState<Form | null>(null);
  const [transactionPin,    setTransactionPin]     = useState('');
  const [pinError,          setPinError]           = useState('');
  const [saveBeneficiary,   setSaveBeneficiary]    = useState(false);
  const [paymentMethod,     setPaymentMethod]      = useState<PaymentMethod>('WALLET');
  const [paystackLoading,   setPaystackLoading]    = useState(false);
  const [paystackError,     setPaystackError]      = useState('');

  const idemKeyRef         = useRef('');
  const confirmInFlightRef = useRef(false);

  const { data: networks = [], isLoading: netsLoading, isError: netsError, refetch: refetchNets } = useQuery({
    queryKey: ['airtime-networks'],
    queryFn:  getAirtimeNetworks,
  });

  const { data: providerLogos = [] } = useQuery({
    queryKey: ['provider-logos', 'airtime'],
    queryFn:  () => getProviderLogos('airtime'),
    staleTime: 60 * 60 * 1000,
  });

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn:  getWallet,
  });

  const { control, handleSubmit, setValue, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  // Live form values so the Payment Summary hot-loads the moment a network is
  // selected or the phone/amount is entered — no need to tap "Review" first.
  const liveAmount = watch('amount');
  const livePhone = watch('phoneNumber');

  const { mutate: purchase, isPending, error: purchaseError } = useMutation({
    mutationFn: purchaseAirtime,
    onSuccess: (result) => {
      confirmInFlightRef.current = false;
      setShowConfirm(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
      const txId = String((result as Record<string, unknown>).transactionId ?? '');
      router.push(`/services/receipt/${txId}` as never);
    },
    onError: () => { confirmInFlightRef.current = false; },
  });

  const handleQuickAmount = (amt: number) => {
    setQuickAmount(amt);
    setCustomAmount(String(amt));
    setValue('amount', amt);
  };

  const handleCustomChange = (text: string) => {
    setCustomAmount(text);
    setQuickAmount(null);
    const n = parseFloat(text);
    setValue('amount', isNaN(n) ? 0 : n);
  };

  const onPressReview = handleSubmit((values) => {
    if (!selectedNetwork) return;
    setPendingPayload(values);
    setTransactionPin('');
    setPinError('');
    setPaystackError('');
    setShowConfirm(true);
  });

  const onConfirmWallet = () => {
    if (!pendingPayload || !selectedNetwork) return;
    if (confirmInFlightRef.current || isPending) return;
    const review = calculateBillReview(pendingPayload.amount, wallet?.balance);
    if (review.insufficient) {
      setPinError('Top up your wallet before confirming this payment.');
      return;
    }
    if (!/^\d{4}$/.test(transactionPin)) {
      setPinError('Enter your 4-digit transaction PIN.');
      return;
    }
    setPinError('');
    confirmInFlightRef.current = true;
    idemKeyRef.current = generateIdempotencyKey();
    purchase({
      networkCode:    selectedNetwork.code,
      phoneNumber:    pendingPayload.phoneNumber,
      amount:         pendingPayload.amount,
      paymentMethod:  'WALLET',
      idempotencyKey: idemKeyRef.current,
      transactionPin,
    });
  };

  const onConfirmPaystack = async () => {
    if (!pendingPayload || !selectedNetwork || paystackLoading) return;
    setPaystackError('');
    setPaystackLoading(true);
    try {
      const { authorizationUrl } = await initiateAirtimePaystack({
        networkCode: selectedNetwork.code,
        phoneNumber: pendingPayload.phoneNumber,
        amount: pendingPayload.amount,
        idempotencyKey: generateIdempotencyKey(),
      });
      if (!authorizationUrl) throw new Error('Paystack did not return a payment URL.');
      setShowConfirm(false);
      await Linking.openURL(authorizationUrl);
    } catch (err) {
      setPaystackError(getErrorMessage(err));
    } finally {
      setPaystackLoading(false);
    }
  };

  const onConfirm = () => {
    if (paymentMethod === 'PAYSTACK') {
      void onConfirmPaystack();
    } else {
      onConfirmWallet();
    }
  };

  const networkError = !selectedNetwork ? 'Select a network' : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Buy Airtime</Text>
        <Pressable style={styles.iconBtn}>
          <CircleHelp size={21} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Hero */}
        <LinearGradient
          colors={[Colors.primary, Colors.primaryContainer]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <View style={styles.heroIcon}>
            <Text style={{ fontSize: 26 }}>📱</Text>
          </View>
          <View style={{ flex: 1, gap: Spacing.xs }}>
            <Text style={styles.heroEyebrow}>SECURE SERVICE</Text>
            <Text style={styles.heroTitle}>Buy Airtime</Text>
            <Text style={styles.heroSub}>Top up any Nigerian mobile line instantly.</Text>
          </View>
        </LinearGradient>

        {/* Network + details card */}
        <View style={[styles.card, shadow1]}>
          <Text style={styles.sectionTitle}>Select Network</Text>
          {netsLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: Spacing.md }} />
          ) : netsError ? (
            <Pressable onPress={() => refetchNets()}>
              <Text style={styles.apiError}>Could not load networks. Tap to retry.</Text>
            </Pressable>
          ) : (
            <View style={styles.providerGrid}>
              {networks.filter((n) => n.isActive).map((net) => {
                const active = selectedNetwork?.id === net.id;
                return (
                  <Pressable
                    key={net.id}
                    onPress={() => setSelectedNetwork(net)}
                    style={[styles.providerCard, active && styles.providerCardActive]}
                  >
                    <ProviderLogo code={net.code} name={net.name} logoUri={resolveProviderImage(providerLogos, net.code, net.name)} />
                    <Text style={[styles.providerName, active && styles.providerNameActive]} numberOfLines={1}>
                      {net.name}
                    </Text>
                    {active && <CheckCircle2 size={16} color={Colors.primary} strokeWidth={2.2} />}
                  </Pressable>
                );
              })}
            </View>
          )}
          {networkError && pendingPayload !== null && (
            <Text style={styles.fieldError}>{networkError}</Text>
          )}

          <Controller
            name="phoneNumber"
            control={control}
            render={({ field }) => (
              <TextInputField
                label="Phone Number"
                placeholder="0801 234 5678"
                keyboardType="phone-pad"
                error={errors.phoneNumber?.message}
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />

          <Text style={[styles.sectionTitle, { marginTop: Spacing.md }]}>Amount</Text>
          <View style={styles.amountGrid}>
            {AMOUNTS.map((amt) => (
              <Pressable
                key={amt}
                onPress={() => handleQuickAmount(amt)}
                style={[styles.amountPill, amt === quickAmount && styles.amountPillActive]}
              >
                <Text style={[styles.amountText, amt === quickAmount && styles.amountTextActive]}>
                  ₦{amt.toLocaleString()}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.customInput, errors.amount && styles.customInputError]}
            placeholder="Or enter custom amount"
            placeholderTextColor={Colors.outline}
            keyboardType="number-pad"
            value={customAmount}
            onChangeText={handleCustomChange}
          />
          {errors.amount && <Text style={styles.fieldError}>{errors.amount.message}</Text>}
        </View>

        {/* Payment Summary + method selector */}
        <View style={[styles.summaryCard, shadow1]}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.sectionTitle}>Payment Summary</Text>
              <Text style={styles.summaryHint}>Airtime is delivered immediately after confirmation.</Text>
            </View>
            <View style={styles.secureBadge}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.secureText}>Secure</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <SummaryRow label="Network"  value={selectedNetwork?.name ?? '—'} />
          <SummaryRow label="Phone"    value={livePhone || '—'} />
          <SummaryRow label="Amount"   value={liveAmount ? `₦${liveAmount.toLocaleString()}` : '—'} />
          <SummaryRow label="Fee"      value={formatNaira(0)} />
          <SummaryRow label="Total"    value={liveAmount ? formatNaira(liveAmount) : '—'} highlight />
          <SummaryRow label="Delivery" value="Instant" />

          {/* Payment method selector */}
          <PaymentMethodSelector
            selected={paymentMethod}
            onSelect={setPaymentMethod}
            walletBalance={wallet?.balance}
            amount={liveAmount || undefined}
          />
        </View>

        {purchaseError && (
          <Text style={styles.apiError}>{getErrorMessage(purchaseError)}</Text>
        )}

        <View style={styles.actionWrap}>
          <PrimaryButton label="Review Purchase" onPress={onPressReview} />
        </View>
      </ScrollView>

      {/* ── Confirmation Bottom Sheet ─────────────────────────────── */}
      <Modal visible={showConfirm} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Purchase</Text>
              <Pressable onPress={() => setShowConfirm(false)}>
                <X size={22} color={Colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {selectedNetwork && (
                <View style={styles.confirmProvider}>
                  <ProviderLogo
                    code={selectedNetwork.code}
                    name={selectedNetwork.name}
                    size={46}
                    logoUri={resolveProviderImage(providerLogos, selectedNetwork.code, selectedNetwork.name)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.confirmProviderName} numberOfLines={1}>{selectedNetwork.name} Airtime</Text>
                    {pendingPayload?.phoneNumber ? (
                      <Text style={styles.confirmProviderSub}>{pendingPayload.phoneNumber}</Text>
                    ) : null}
                  </View>
                  {pendingPayload?.amount ? (
                    <Text style={styles.confirmProviderAmount}>{formatNaira(pendingPayload.amount)}</Text>
                  ) : null}
                </View>
              )}
              <SummaryRow label="Service"  value="Airtime" />
              <SummaryRow label="Network"  value={selectedNetwork?.name ?? '—'} />
              <SummaryRow label="Phone"    value={pendingPayload?.phoneNumber ?? '—'} />
              <SummaryRow label="Amount"   value={pendingPayload?.amount ? `₦${pendingPayload.amount.toLocaleString()}` : '—'} />
              <SummaryRow label="Fee"      value={formatNaira(0)} />
              <SummaryRow label="Total"    value={pendingPayload?.amount ? formatNaira(pendingPayload.amount) : '—'} highlight />
              <SummaryRow label="Payment"  value={paymentMethod === 'WALLET' ? 'Wallet' : 'Paystack'} />

              {paymentMethod === 'WALLET' ? (
                <BillReviewSecurityPanel
                  amount={pendingPayload?.amount}
                  walletBalance={wallet?.balance}
                  pin={transactionPin}
                  onPinChange={(value) => { setTransactionPin(value); setPinError(''); }}
                  pinError={pinError}
                  saveBeneficiary={saveBeneficiary}
                  onSaveBeneficiaryChange={setSaveBeneficiary}
                />
              ) : (
                <View style={styles.paystackPanel}>
                  <Text style={styles.paystackInfo}>
                    You'll be taken to Paystack to complete this payment securely via card,
                    bank transfer, or USSD. Return to the app once payment is confirmed.
                  </Text>
                  {paystackError ? (
                    <Text style={styles.apiError}>{paystackError}</Text>
                  ) : null}
                </View>
              )}

              {purchaseError && paymentMethod === 'WALLET' ? (
                <Text style={styles.apiError}>{getErrorMessage(purchaseError)}</Text>
              ) : null}
            </ScrollView>

            <View style={styles.modalActions}>
              <PrimaryButton
                label={paymentMethod === 'PAYSTACK' ? 'Pay with Paystack' : 'Confirm & Pay'}
                onPress={onConfirm}
                loading={isPending || paystackLoading}
                disabled={
                  paymentMethod === 'WALLET'
                    ? calculateBillReview(pendingPayload?.amount, wallet?.balance).insufficient
                    : false
                }
              />
              <PrimaryButton
                label="Cancel"
                variant="ghost"
                onPress={() => setShowConfirm(false)}
                disabled={isPending || paystackLoading}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value?: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, highlight && { color: Colors.primary, fontWeight: '700' }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  topBar:     { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:    { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:   { ...Typography.titleLg, color: Colors.primary },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  hero:       { minHeight: 120, borderRadius: Radius.xl, padding: Spacing.cardPadding, flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg, overflow: 'hidden' },
  heroIcon:   { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroEyebrow:{ ...Typography.labelSm, color: 'rgba(255,255,255,0.75)' },
  heroTitle:  { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSub:    { ...Typography.bodySm, color: 'rgba(255,255,255,0.75)' },
  card:       { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface },
  providerGrid:{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md, marginBottom: Spacing.lg },
  providerCard:{ width: '48%', minHeight: 82, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm },
  providerCardActive:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  providerIcon:{ width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  providerInitial:{ ...Typography.labelLg, fontWeight: '800' },
  providerName:{ ...Typography.labelMd, color: Colors.onSurface },
  providerNameActive:{ color: Colors.onPrimaryFixed },
  amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.md },
  amountPill: { minWidth: 88, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  amountPillActive:{ backgroundColor: Colors.primaryContainer, borderColor: Colors.primaryContainer },
  amountText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amountTextActive:{ color: Colors.onSecondaryContainer },
  customInput:{ height: 52, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.md, paddingHorizontal: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow, marginTop: Spacing.sm },
  customInputError:{ borderColor: Colors.error },
  fieldError: { ...Typography.labelSm, color: Colors.error, marginTop: 4 },
  apiError:   { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.md },
  summaryCard:{ backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  summaryHeader:{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryHint:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  secureBadge:{ height: 30, paddingHorizontal: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, flexDirection: 'row', alignItems: 'center', gap: 4 },
  secureText: { ...Typography.labelSm, color: Colors.teal },
  summaryDivider:{ height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs, gap: Spacing.md },
  summaryLabel:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  summaryValue:{ ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  actionWrap: { marginBottom: Spacing.lg },
  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.cardPadding, paddingBottom: Platform.OS === 'ios' ? 40 : Spacing.xl, maxHeight: '90%' },
  modalHandle:{ width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginBottom: Spacing.md },
  modalHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  modalTitle: { ...Typography.titleLg, color: Colors.onSurface },
  modalScroll:{ maxHeight: '68%' },
  modalScrollContent:{ paddingBottom: Spacing.sm },
  confirmProvider:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  confirmProviderName:{ ...Typography.titleMd, color: Colors.onSurface },
  confirmProviderSub:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  confirmProviderAmount:{ ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  modalActions:{ gap: Spacing.sm, marginTop: Spacing.lg },
  paystackPanel:{ marginTop: Spacing.md, gap: Spacing.sm },
  paystackInfo:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md, borderRadius: Radius.md, borderLeftWidth: 3, borderLeftColor: Colors.secondary },
});
