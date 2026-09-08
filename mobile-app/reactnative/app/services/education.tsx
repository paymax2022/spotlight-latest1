import React, { useRef, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, CheckCircle2, CircleHelp, GraduationCap, ShieldCheck, X } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import BillReviewSecurityPanel, { calculateBillReview, formatNaira } from '@/components/BillReviewSecurityPanel';
import PaymentMethodSelector, { type PaymentMethod } from '@/components/PaymentMethodSelector';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { getEducationProducts, getEducationProviders, initiateEducationPaystack, payEducation, getProviderLogos, resolveProviderImage } from '@/api/billing.api';
import { useGatewayCheckout } from '@/features/payments';
import ProviderLogo from '@/components/ProviderLogo';
import { getWallet } from '@/api/wallet.api';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { shadow1, shadow2 } from '@/constants/shadows';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { EducationProduct, EducationProvider } from '@/types/billing';
import { getErrorMessage } from '@/utils/errorMapper';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { HomeMenuButton } from '@/components/HomeMenu';

const schema = z.object({
  customerReference: z.string().min(6, 'Enter a valid candidate, exam, or phone reference'),
  customerPhone: z
    .string()
    .min(10, 'Enter a valid phone number')
    .regex(/^(\+234|0)[789][01]\d{8}$/, 'Enter a valid Nigerian phone number'),
});

type Form = z.infer<typeof schema>;

export default function EducationScreen() {
  const qc = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<EducationProvider | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<EducationProduct | null>(null);
  const [pendingForm, setPendingForm] = useState<Form | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WALLET');
  const [transactionPin, setTransactionPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [priceWarning, setPriceWarning] = useState('');
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [paystackError, setPaystackError] = useState('');
  const [saveBeneficiary, setSaveBeneficiary] = useState(false);
  const confirmInFlightRef = useRef(false);

  const { data: providers = [], isLoading: providersLoading, isError: providersError, refetch: refetchProviders } = useQuery({
    queryKey: ['education-providers'],
    queryFn: getEducationProviders,
  });

  const { data: providerLogos = [] } = useQuery({
    queryKey: ['provider-logos', 'education'],
    queryFn:  () => getProviderLogos('education'),
    staleTime: 60 * 60 * 1000,
  });

  const { data: products = [], isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ['education-products', selectedProvider?.code],
    queryFn: () => getEducationProducts(selectedProvider!.code),
    enabled: !!selectedProvider,
  });

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: getWallet,
  });

  const { control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const { mutate: pay, isPending: paying, error: payError } = useMutation({
    mutationFn: payEducation,
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
    if (!selectedProvider) {
      alert('Please select an education provider.');
      return;
    }
    if (!selectedProduct) {
      alert('Please select a product.');
      return;
    }
    setPendingForm(values);
    setTransactionPin('');
    setPinError('');
    setPriceWarning('');
    setPaystackError('');
    setShowConfirm(true);
  });

  const onConfirmWallet = async () => {
    if (!pendingForm || !selectedProvider || !selectedProduct) return;
    if (confirmInFlightRef.current || paying) return;
    const review = calculateBillReview(selectedProduct.sellingPrice, wallet?.balance);
    if (review.insufficient) {
      setPinError('Top up your wallet before confirming this payment.');
      return;
    }
    if (!/^\d{4}$/.test(transactionPin)) {
      setPinError('Enter your 4-digit transaction PIN.');
      return;
    }
    const latest = await refetchProducts();
    const freshProduct = latest.data?.find((product) => product.id === selectedProduct.id);
    if (!freshProduct || !freshProduct.isActive || freshProduct.sellingPrice !== selectedProduct.sellingPrice) {
      setPriceWarning('This education product changed. Re-select the product before paying.');
      return;
    }
    setPinError('');
    setPriceWarning('');
    confirmInFlightRef.current = true;
    pay({
      providerCode: selectedProvider.code,
      productId: selectedProduct.id,
      customerReference: pendingForm.customerReference,
      customerPhone: pendingForm.customerPhone,
      paymentMethod: 'WALLET',
      idempotencyKey: generateIdempotencyKey(),
      transactionPin,
    });
  };

  // In-app Paystack SDK checkout (flag-gated); falls back to the legacy redirect.
  const paystackCheckout = useGatewayCheckout();
  React.useEffect(() => {
    if (paystackCheckout.error) setPaystackError(paystackCheckout.error);
  }, [paystackCheckout.error]);

  const onConfirmPaystack = async () => {
    if (!pendingForm || !selectedProvider || !selectedProduct || paystackLoading) return;
    setPaystackError('');
    setPaystackLoading(true);
    try {
      await paystackCheckout.start({
        domain: 'bills',
        initialize: async () => {
          const r = await initiateEducationPaystack({
            providerCode: selectedProvider.code,
            productId: selectedProduct.id,
            customerReference: pendingForm.customerReference,
            customerPhone: pendingForm.customerPhone,
            idempotencyKey: generateIdempotencyKey(),
          });
          if (!r.authorizationUrl) throw new Error('Paystack did not return a payment URL.');
          return { authorizationUrl: r.authorizationUrl, reference: r.paymentReference };
        },
        onResolved: (res) => { setShowConfirm(false); router.replace(`/services/paystack/${res.reference}` as never); },
        onFallback: async (res) => { setShowConfirm(false); await Linking.openURL(res.authorizationUrl); },
      });
    } catch (err) {
      setPaystackError(getErrorMessage(err));
    } finally {
      setPaystackLoading(false);
    }
  };

  const onConfirm = () => {
    if (paymentMethod === 'PAYSTACK') {
      void onConfirmPaystack();
      return;
    }
    void onConfirmWallet();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/services')} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Education Payment</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable style={styles.iconBtn}>
            <CircleHelp size={21} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LinearGradient
          colors={['#7C3AED', Colors.primaryContainer]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <View style={styles.heroIcon}>
            <GraduationCap size={28} color={Colors.onPrimary} strokeWidth={2.2} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>SECURE SERVICE</Text>
            <Text style={styles.heroTitle}>Education Payment</Text>
            <Text style={styles.heroSub}>Buy exam PINs and education vouchers through approved providers.</Text>
          </View>
        </LinearGradient>

        <View style={[styles.card, shadow1]}>
          <Text style={styles.sectionTitle}>Select Provider</Text>
          {providersLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.loader} />
          ) : providersError ? (
            <Pressable onPress={() => refetchProviders()}>
              <Text style={styles.apiError}>Could not load education providers. Tap to retry.</Text>
            </Pressable>
          ) : (
            <View style={styles.providerGrid}>
              {providers.filter((provider) => provider.isActive).map((provider) => {
                const active = selectedProvider?.id === provider.id;
                return (
                  <Pressable
                    key={provider.id}
                    onPress={() => {
                      setSelectedProvider(provider);
                      setSelectedProduct(null);
                    }}
                    style={[styles.providerCard, active && styles.providerCardActive]}
                  >
                    <ProviderLogo code={provider.code} name={provider.name} logoUri={resolveProviderImage(providerLogos, provider.code, provider.name)} />
                    <Text style={[styles.providerName, active && styles.providerNameActive]} numberOfLines={1}>
                      {provider.name}
                    </Text>
                    {active && <CheckCircle2 size={16} color={Colors.primary} strokeWidth={2.2} />}
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text style={[styles.sectionTitle, { marginTop: Spacing.md }]}>Choose Product</Text>
          {!selectedProvider ? (
            <Text style={styles.helper}>Select a provider to load products.</Text>
          ) : productsLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.loader} />
          ) : products.length === 0 ? (
            <Text style={styles.helper}>No active products are available for this provider.</Text>
          ) : (
            <View style={styles.productList}>
              {products.filter((product) => product.isActive).map((product) => {
                const active = selectedProduct?.id === product.id;
                return (
                  <Pressable
                    key={product.id}
                    onPress={() => setSelectedProduct(product)}
                    style={[styles.productRow, active && styles.productRowActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.productTitle, active && styles.productTitleActive]}>{product.name}</Text>
                      <Text style={styles.productMeta}>{product.meta ?? 'Instant PIN'}</Text>
                    </View>
                    <Text style={[styles.productPrice, active && styles.productPriceActive]}>
                      {formatNaira(product.sellingPrice)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.formBlock}>
            <Controller
              name="customerReference"
              control={control}
              render={({ field }) => (
                <TextInputField
                  label="Candidate / Exam Reference"
                  placeholder="Candidate ID or phone reference"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={errors.customerReference?.message}
                />
              )}
            />
            <Controller
              name="customerPhone"
              control={control}
              render={({ field }) => (
                <PhoneNumberInput label="Phone Number" value={field.value} onChange={({ e164, nsn }) => (field.onChange)(e164 || nsn)} error={errors.customerPhone?.message} />
              )}
            />
          </View>
        </View>

        <View style={[styles.summaryCard, shadow1]}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.sectionTitle}>Payment Summary</Text>
              <Text style={styles.summaryHint}>PIN and voucher details appear after successful payment.</Text>
            </View>
            <View style={styles.secureBadge}>
              <ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.secureText}>Secure</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <SummaryRow label="Provider" value={selectedProvider?.name ?? '-'} />
          <SummaryRow label="Product" value={selectedProduct?.name ?? '-'} />
          <SummaryRow label="Reference" value={pendingForm?.customerReference ?? '-'} />
          <SummaryRow label="Amount" value={selectedProduct ? formatNaira(selectedProduct.sellingPrice) : '-'} />
          <SummaryRow label="Fee" value={formatNaira(0)} />

          <PaymentMethodSelector
            selected={paymentMethod}
            onSelect={setPaymentMethod}
            walletBalance={wallet?.balance}
            amount={selectedProduct?.sellingPrice}
          />
        </View>

        {payError ? <Text style={styles.apiError}>{getErrorMessage(payError)}</Text> : null}

        <View style={styles.actionWrap}>
          <PrimaryButton label="Review Payment" onPress={onPressReview} />
        </View>
      </ScrollView>

      <Modal visible={showConfirm} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Education Payment</Text>
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
              {selectedProvider && (
                <View style={styles.confirmProvider}>
                  <ProviderLogo
                    code={selectedProvider.code}
                    name={selectedProvider.name}
                    size={46}
                    logoUri={resolveProviderImage(providerLogos, selectedProvider.code, selectedProvider.name)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.confirmProviderName} numberOfLines={1}>{selectedProduct?.name ?? `${selectedProvider.name} PIN`}</Text>
                    {pendingForm?.customerReference ? (
                      <Text style={styles.confirmProviderSub}>{pendingForm.customerReference}</Text>
                    ) : null}
                  </View>
                  {selectedProduct?.sellingPrice ? (
                    <Text style={styles.confirmProviderAmount}>{formatNaira(selectedProduct.sellingPrice)}</Text>
                  ) : null}
                </View>
              )}
              <SummaryRow label="Service" value="Education" />
              <SummaryRow label="Provider" value={selectedProvider?.name ?? '-'} />
              <SummaryRow label="Product" value={selectedProduct?.name ?? '-'} />
              <SummaryRow label="Reference" value={pendingForm?.customerReference ?? '-'} />
              <SummaryRow label="Phone" value={pendingForm?.customerPhone ?? '-'} />
              <SummaryRow label="Total" value={selectedProduct ? formatNaira(selectedProduct.sellingPrice) : '-'} highlight />
              <SummaryRow label="Payment" value={paymentMethod === 'WALLET' ? 'Wallet' : 'Paystack'} />

              {paymentMethod === 'WALLET' ? (
                <BillReviewSecurityPanel
                  amount={selectedProduct?.sellingPrice}
                  walletBalance={wallet?.balance}
                  pin={transactionPin}
                  onPinChange={(value) => {
                    setTransactionPin(value);
                    setPinError('');
                  }}
                  pinError={pinError}
                  priceWarning={priceWarning}
                  saveBeneficiary={saveBeneficiary}
                  onSaveBeneficiaryChange={setSaveBeneficiary}
                />
              ) : (
                <View style={styles.paystackPanel}>
                  <Text style={styles.paystackInfo}>
                    You'll be taken to Paystack to complete this payment securely via card,
                    bank transfer, or USSD. Return to the app once payment is confirmed.
                  </Text>
                  {paystackError ? <Text style={styles.apiError}>{paystackError}</Text> : null}
                </View>
              )}

              {payError && paymentMethod === 'WALLET' ? (
                <Text style={styles.apiError}>{getErrorMessage(payError)}</Text>
              ) : null}
            </ScrollView>

            <View style={styles.modalActions}>
              <PrimaryButton
                label={paymentMethod === 'PAYSTACK' ? 'Pay with Paystack' : 'Confirm & Pay'}
                onPress={onConfirm}
                loading={paying || paystackLoading}
                disabled={
                  paymentMethod === 'WALLET'
                    ? calculateBillReview(selectedProduct?.sellingPrice, wallet?.balance).insufficient
                    : false
                }
              />
              <PrimaryButton
                label="Cancel"
                variant="ghost"
                onPress={() => setShowConfirm(false)}
                disabled={paying || paystackLoading}
              />
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
      <Text style={[styles.summaryValue, highlight && styles.summaryHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(248,249,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 120 : 96,
  },
  hero: {
    minHeight: 156,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    overflow: 'hidden',
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: { flex: 1, gap: Spacing.xs },
  heroEyebrow: { ...Typography.labelSm, color: Colors.inverseOnSurface, opacity: 0.9 },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSub: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.lg,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  providerCard: {
    width: '48%',
    minHeight: 82,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  providerCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  providerIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerInitial: { ...Typography.labelLg, fontWeight: '800' },
  providerName: { ...Typography.labelMd, color: Colors.onSurface },
  providerNameActive: { color: Colors.onPrimaryFixed },
  productList: { gap: Spacing.sm, marginTop: Spacing.md },
  productRow: {
    minHeight: 72,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  productRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  productTitle: { ...Typography.labelLg, color: Colors.onSurface },
  productTitleActive: { color: Colors.onPrimaryFixed },
  productMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  productPrice: { ...Typography.labelLg, color: Colors.secondary },
  productPriceActive: { color: Colors.primary },
  formBlock: { marginTop: Spacing.lg },
  helper: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  loader: { marginVertical: Spacing.md },
  summaryCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.lg,
  },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, maxWidth: 220 },
  secureBadge: {
    height: 30,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  secureText: { ...Typography.labelSm, color: Colors.teal },
  summaryDivider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    gap: Spacing.md,
  },
  summaryLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  summaryHighlight: { color: Colors.primary, fontWeight: '800' },
  actionWrap: { marginBottom: Spacing.lg },
  apiError: { ...Typography.bodySm, color: Colors.error, textAlign: 'center', marginVertical: Spacing.sm },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11,28,48,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '86%',
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.md,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.outlineVariant,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  modalTitle: { ...Typography.titleLg, color: Colors.onSurface },
  modalScroll: { maxHeight: 460 },
  modalScrollContent: { paddingBottom: Spacing.md },
  confirmProvider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  confirmProviderName: { ...Typography.titleMd, color: Colors.onSurface },
  confirmProviderSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  confirmProviderAmount: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  paystackPanel: {
    marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.secondary,
  },
  paystackInfo: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  modalActions: { gap: Spacing.sm, paddingTop: Spacing.md },
});
