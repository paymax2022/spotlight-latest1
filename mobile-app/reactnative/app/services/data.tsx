import React, { useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, ActivityIndicator, Linking,
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
import { getDataNetworks, getDataPlans, initiateDataPaystack, purchaseData, getProviderLogos, resolveProviderImage } from '@/api/billing.api';
import { useGatewayCheckout } from '@/features/payments';
import ProviderLogo from '@/components/ProviderLogo';
import { getWallet } from '@/api/wallet.api';
import { getErrorMessage } from '@/utils/errorMapper';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { Network, DataPlan } from '@/types/billing';

const schema = z.object({
  phoneNumber: z
    .string()
    .min(10, 'Enter a valid phone number')
    .regex(/^(\+234|0)[789][01]\d{8}$/, 'Enter a valid Nigerian phone number'),
});
type Form = z.infer<typeof schema>;

export default function DataScreen() {
  const qc = useQueryClient();
  const [selectedNetwork, setSelectedNetwork] = useState<Network | null>(null);
  const [selectedPlan, setSelectedPlan]       = useState<DataPlan | null>(null);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [pendingPhone, setPendingPhone]       = useState('');
  const [transactionPin, setTransactionPin]   = useState('');
  const [pinError, setPinError]               = useState('');
  const [priceWarning, setPriceWarning]       = useState('');
  const [saveBeneficiary, setSaveBeneficiary] = useState(false);
  const [paymentMethod,   setPaymentMethod]   = useState<PaymentMethod>('WALLET');
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [paystackError,   setPaystackError]   = useState('');
  const idemKeyRef = useRef('');
  const confirmInFlightRef = useRef(false);

  const { data: networks = [], isLoading: netsLoading } = useQuery({
    queryKey: ['data-networks'],
    queryFn:  getDataNetworks,
  });

  const { data: providerLogos = [] } = useQuery({
    queryKey: ['provider-logos', 'data'],
    queryFn:  () => getProviderLogos('data'),
    staleTime: 60 * 60 * 1000,
  });

  const { data: plans = [], isLoading: plansLoading, refetch: refetchPlans } = useQuery({
    queryKey: ['data-plans', selectedNetwork?.code],
    queryFn:  () => getDataPlans(selectedNetwork!.code),
    enabled:  !!selectedNetwork,
  });

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn:  getWallet,
  });

  const { control, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema) });

  const { mutate: purchase, isPending, error: purchaseError } = useMutation({
    mutationFn: purchaseData,
    onSuccess: (result) => {
      confirmInFlightRef.current = false;
      setShowConfirm(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
      const txId = String((result as Record<string, unknown>).transactionId ?? '');
      router.push(`/services/receipt/${txId}` as never);
    },
    onError: () => {
      confirmInFlightRef.current = false;
    },
  });

  const onPressReview = handleSubmit((values) => {
    if (!selectedNetwork) { alert('Please select a network.'); return; }
    if (!selectedPlan)    { alert('Please select a data plan.'); return; }
    setPendingPhone(values.phoneNumber);
    setShowConfirm(true);
  });

  const onConfirmWallet = async () => {
    if (!selectedNetwork || !selectedPlan) return;
    if (confirmInFlightRef.current || isPending) return;
    const review = calculateBillReview(selectedPlan.sellingPrice, wallet?.balance);
    if (review.insufficient) {
      setPinError('Top up your wallet before confirming this payment.');
      return;
    }
    if (!/^\d{4}$/.test(transactionPin)) {
      setPinError('Enter your 4-digit transaction PIN.');
      return;
    }
    const latest = await refetchPlans();
    const freshPlan = latest.data?.find((plan) => plan.id === selectedPlan.id);
    if (!freshPlan || !freshPlan.isActive || freshPlan.sellingPrice !== selectedPlan.sellingPrice) {
      setPriceWarning('This data plan changed. Re-select the plan before paying.');
      return;
    }
    setPinError('');
    setPriceWarning('');
    confirmInFlightRef.current = true;
    idemKeyRef.current = generateIdempotencyKey();
    purchase({
      networkCode:    selectedNetwork.code,
      phoneNumber:    pendingPhone,
      planId:         selectedPlan.id,
      paymentMethod:  'WALLET',
      idempotencyKey: idemKeyRef.current,
      transactionPin,
    });
  };

  // In-app Paystack SDK checkout (flag-gated); falls back to the legacy redirect.
  const paystackCheckout = useGatewayCheckout();
  React.useEffect(() => {
    if (paystackCheckout.error) setPaystackError(paystackCheckout.error);
  }, [paystackCheckout.error]);

  const onConfirmPaystack = async () => {
    if (!selectedPlan) return;
    setPaystackLoading(true);
    setPaystackError('');
    try {
      if (!selectedNetwork || !pendingPhone) return;
      await paystackCheckout.start({
        domain: 'bills',
        initialize: async () => {
          const r = await initiateDataPaystack({
            networkCode: selectedNetwork.code,
            phoneNumber: pendingPhone,
            planId: selectedPlan.id,
            idempotencyKey: generateIdempotencyKey(),
          });
          if (!r.authorizationUrl) throw new Error('Paystack did not return a payment URL.');
          return { authorizationUrl: r.authorizationUrl, reference: r.paymentReference };
        },
        onResolved: (res) => { setShowConfirm(false); router.replace(`/services/paystack/${res.reference}` as never); },
        onFallback: async (res) => { setShowConfirm(false); await Linking.openURL(res.authorizationUrl); },
      });
    } catch (err: unknown) {
      setPaystackError(getErrorMessage(err));
    } finally {
      setPaystackLoading(false);
    }
  };

  const onConfirm = () => {
    if (paymentMethod === 'PAYSTACK') return onConfirmPaystack();
    return onConfirmWallet();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Buy Data</Text>
        <Pressable style={styles.iconBtn}>
          <CircleHelp size={21} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LinearGradient colors={[Colors.secondary, Colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow2]}>
          <View style={styles.heroIcon}><Text style={{ fontSize: 26 }}>📶</Text></View>
          <View style={{ flex: 1, gap: Spacing.xs }}>
            <Text style={styles.heroEyebrow}>SECURE SERVICE</Text>
            <Text style={styles.heroTitle}>Buy Data Bundle</Text>
            <Text style={styles.heroSub}>Mobile data for all major Nigerian networks.</Text>
          </View>
        </LinearGradient>

        <View style={[styles.card, shadow1]}>
          <Text style={styles.sectionTitle}>Select Network</Text>
          {netsLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: Spacing.md }} />
          ) : (
            <View style={styles.providerGrid}>
              {networks.filter((n) => n.isActive).map((net) => {
                const active = selectedNetwork?.id === net.id;
                return (
                  <Pressable key={net.id} onPress={() => { setSelectedNetwork(net); setSelectedPlan(null); }} style={[styles.providerCard, active && styles.providerCardActive]}>
                    <ProviderLogo code={net.code} name={net.name} logoUri={resolveProviderImage(providerLogos, net.code, net.name)} />
                    <Text style={[styles.providerName, active && styles.providerNameActive]} numberOfLines={1}>{net.name}</Text>
                    {active && <CheckCircle2 size={16} color={Colors.primary} strokeWidth={2.2} />}
                  </Pressable>
                );
              })}
            </View>
          )}

          <Controller
            name="phoneNumber"
            control={control}
            render={({ field }) => (
              <TextInputField
                label="Phone / Router Number"
                placeholder="0801 234 5678"
                keyboardType="phone-pad"
                error={errors.phoneNumber?.message}
                value={field.value}
                onChangeText={field.onChange}
              />
            )}
          />
        </View>

        {selectedNetwork && (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.sectionTitle}>Choose Plan</Text>
            {plansLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: Spacing.md }} />
            ) : plans.length === 0 ? (
              <Text style={styles.emptyText}>No plans available for this network.</Text>
            ) : (
              plans.filter((p) => p.isActive).map((plan) => {
                const active = selectedPlan?.id === plan.id;
                return (
                  <Pressable key={plan.id} onPress={() => setSelectedPlan(plan)} style={[styles.planRow, active && styles.planRowActive]}>
                    <View>
                      <Text style={[styles.planTitle, active && styles.planTitleActive]}>{plan.name}</Text>
                      <Text style={styles.planMeta}>{plan.allowance} · {plan.validity}</Text>
                    </View>
                    <Text style={[styles.planPrice, active && styles.planPriceActive]}>₦{plan.sellingPrice.toLocaleString()}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        <View style={[styles.summaryCard, shadow1]}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.sectionTitle}>Payment Summary</Text>
              <Text style={styles.summaryHint}>Data activates on the selected line after payment.</Text>
            </View>
            <View style={styles.secureBadge}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.secureText}>Secure</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <SummaryRow label="Network" value={selectedNetwork?.name ?? '—'} />
          <SummaryRow label="Plan"    value={selectedPlan?.name ?? '—'} />
          <SummaryRow label="Amount"  value={selectedPlan ? `₦${selectedPlan.sellingPrice.toLocaleString()}` : '—'} />
          <SummaryRow label="Fee"     value={formatNaira(0)} />
          <PaymentMethodSelector
            selected={paymentMethod}
            onSelect={setPaymentMethod}
            walletBalance={wallet?.balance}
            amount={selectedPlan?.sellingPrice}
          />
        </View>

        {purchaseError ? <Text style={styles.apiError}>{getErrorMessage(purchaseError)}</Text> : null}

        <View style={styles.actionWrap}>
          <PrimaryButton label="Review Purchase" onPress={onPressReview} />
        </View>
      </ScrollView>

      <Modal visible={showConfirm} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Purchase</Text>
              <Pressable onPress={() => setShowConfirm(false)}><X size={22} color={Colors.onSurface} /></Pressable>
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
                    <Text style={styles.confirmProviderName} numberOfLines={1}>{selectedNetwork.name} Data</Text>
                    {pendingPhone ? (
                      <Text style={styles.confirmProviderSub}>{pendingPhone}</Text>
                    ) : null}
                  </View>
                  {selectedPlan?.sellingPrice ? (
                    <Text style={styles.confirmProviderAmount}>{formatNaira(selectedPlan.sellingPrice)}</Text>
                  ) : null}
                </View>
              )}
              <SummaryRow label="Service"  value="Data Bundle" />
              <SummaryRow label="Network"  value={selectedNetwork?.name ?? '—'} />
              <SummaryRow label="Plan"     value={selectedPlan?.name ?? '—'} />
              <SummaryRow label="Phone"    value={pendingPhone} />
              <SummaryRow label="Amount"   value={selectedPlan ? `₦${selectedPlan.sellingPrice.toLocaleString()}` : '—'} highlight />
              <SummaryRow label="Payment"  value={paymentMethod === 'WALLET' ? 'Wallet' : 'Paystack'} />
              {paymentMethod === 'WALLET' ? (
                <BillReviewSecurityPanel
                  amount={selectedPlan?.sellingPrice}
                  walletBalance={wallet?.balance}
                  pin={transactionPin}
                  onPinChange={(value) => { setTransactionPin(value); setPinError(''); }}
                  pinError={pinError}
                  priceWarning={priceWarning}
                  saveBeneficiary={saveBeneficiary}
                  onSaveBeneficiaryChange={setSaveBeneficiary}
                />
              ) : (
                <View style={styles.paystackInfoPanel}>
                  <Text style={styles.paystackInfoText}>
                    You'll be redirected to Paystack to complete this payment securely via card, bank transfer, or USSD.
                  </Text>
                  {paystackError ? <Text style={styles.apiError}>{paystackError}</Text> : null}
                </View>
              )}
              {purchaseError ? <Text style={styles.apiError}>{getErrorMessage(purchaseError)}</Text> : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <PrimaryButton
                label={paymentMethod === 'WALLET' ? 'Confirm & Pay' : 'Pay with Paystack'}
                onPress={onConfirm}
                loading={isPending || paystackLoading}
                disabled={paymentMethod === 'WALLET' && calculateBillReview(selectedPlan?.sellingPrice, wallet?.balance).insufficient}
              />
              <PrimaryButton label="Cancel" variant="ghost" onPress={() => setShowConfirm(false)} disabled={isPending || paystackLoading} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Hosts the in-app Paystack checkout WebView on native (nothing on web). */}
      <paystackCheckout.Sheet />
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value?: string; highlight?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, highlight && { color: Colors.primary, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  topBar:      { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:     { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:    { ...Typography.titleLg, color: Colors.primary },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  hero:        { minHeight: 120, borderRadius: Radius.xl, padding: Spacing.cardPadding, flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg, overflow: 'hidden' },
  heroIcon:    { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroEyebrow: { ...Typography.labelSm, color: 'rgba(255,255,255,0.75)' },
  heroTitle:   { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSub:     { ...Typography.bodySm, color: 'rgba(255,255,255,0.75)' },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface },
  providerGrid:{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md, marginBottom: Spacing.lg },
  providerCard:{ width: '48%', minHeight: 82, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm },
  providerCardActive:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  providerIcon:{ width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  providerInitial:{ ...Typography.labelLg, fontWeight: '800' },
  providerName:{ ...Typography.labelMd, color: Colors.onSurface },
  providerNameActive:{ color: Colors.onPrimaryFixed },
  planRow:     { minHeight: 72, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md, marginTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planRowActive:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  planTitle:   { ...Typography.labelLg, color: Colors.onSurface },
  planTitleActive:{ color: Colors.onPrimaryFixed },
  planMeta:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  planPrice:   { ...Typography.labelLg, color: Colors.secondary },
  planPriceActive:{ color: Colors.primary },
  emptyText:   { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center', paddingVertical: Spacing.lg },
  apiError:    { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.md },
  summaryCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  summaryHeader:{ flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  secureBadge: { height: 30, paddingHorizontal: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, flexDirection: 'row', alignItems: 'center', gap: 4 },
  secureText:  { ...Typography.labelSm, color: Colors.teal },
  summaryDivider:{ height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs, gap: Spacing.md },
  summaryLabel:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  summaryValue:{ ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  actionWrap:  { marginBottom: Spacing.lg },
  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet:  { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.cardPadding, paddingBottom: Platform.OS === 'ios' ? 40 : Spacing.xl, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginBottom: Spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  modalTitle:  { ...Typography.titleLg, color: Colors.onSurface },
  modalScroll: { maxHeight: '68%' },
  modalScrollContent: { paddingBottom: Spacing.sm },
  confirmProvider:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  confirmProviderName:{ ...Typography.titleMd, color: Colors.onSurface },
  confirmProviderSub:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  confirmProviderAmount:{ ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  modalActions:    { gap: Spacing.sm, marginTop: Spacing.lg },
  paystackInfoPanel: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.secondary, marginTop: Spacing.md },
  paystackInfoText:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
});
