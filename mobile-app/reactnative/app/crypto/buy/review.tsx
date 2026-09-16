import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Fingerprint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import CryptoQuoteBreakdown from '@/features/crypto/components/CryptoQuoteBreakdown';
import QuoteCountdown from '@/features/crypto/components/QuoteCountdown';
import VolatilityWarning from '@/features/crypto/components/VolatilityWarning';
import { useAsset } from '@/features/crypto/hooks/useCrypto';
import { buildQuote, formatCrypto, formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';
import type { AmountBasis, CryptoQuote } from '@/features/crypto/types/crypto.types';

export default function BuyReviewScreen() {
  const params = useLocalSearchParams<{ symbol: string; basis: string; amount: string }>();
  const asset = useAsset(params.symbol);
  const basis = (params.basis as AmountBasis) ?? 'fiat';
  const amount = Number(params.amount);

  const makeQuote = useCallback((): CryptoQuote | null => {
    if (!asset.data) return null;
    return buildQuote(asset.data, { assetId: asset.data.id, side: 'buy', basis, amount, currency: 'NGN', lock: true });
  }, [asset.data, basis, amount]);

  const [quote, setQuote] = useState<CryptoQuote | null>(null);
  const [expired, setExpired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();

  // Build the initial locked quote once the asset resolves.
  React.useEffect(() => { if (asset.data && !quote) setQuote(makeQuote()); }, [asset.data, quote, makeQuote]);

  const reQuote = () => { setQuote(makeQuote()); setExpired(false); };

  if (asset.isLoading || !quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="loading" message="Preparing your quote…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="error" title="Couldn't prepare your order" message="Please go back and try again." actionLabel="Back" onAction={() => goBack('/crypto/buy')} />
      </SafeAreaView>
    );
  }

  const a = asset.data;

  const confirm = () => {
    if (expired) { reQuote(); setPin(''); return; }
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError(undefined);
    router.push({
      pathname: '/crypto/buy/processing',
      params: { symbol: a.symbol, basis, amount: String(amount), expiresAt: quote.expiresAt },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" subtitle={`Buy ${a.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <QuoteCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

        {/* Order summary hero */}
        <View style={styles.hero}>
          <AssetIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <Text style={styles.heroLabel}>You're buying</Text>
          <Text style={styles.heroAmount}>{formatCrypto(quote.crypto.amount, a.symbol, a.decimals)}</Text>
          <Text style={styles.heroFiat}>for {formatFiatObj(quote.totalFiat)}</Text>
        </View>

        {/* Fees + order summary */}
        <CryptoQuoteBreakdown quote={quote} decimals={a.decimals} />

        {/* Risk disclosure (required on every trade confirmation) */}
        <View style={styles.warn}>
          <VolatilityWarning message={a.riskDisclosure} />
        </View>

        {/* PIN confirmation */}
        <View style={styles.pinCard}>
          <View style={styles.pinHead}>
            <Fingerprint size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.pinTitle}>Authorize with your PIN</Text>
          </View>
          <Text style={styles.pinHint}>For your security, confirm this order with your 4-digit transaction PIN or biometrics.</Text>
          <TextInputField
            label="Transaction PIN"
            placeholder="Enter 4-digit PIN"
            keyboardType="number-pad"
            maxLength={4}
            secure
            value={pin}
            onChangeText={(t) => { setPin(t.replace(/\D/g, '').slice(0, 4)); if (pinError) setPinError(undefined); }}
            error={pinError}
          />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {expired ? (
          <PrimaryButton label="Quote expired — refresh" onPress={reQuote} />
        ) : (
          <PrimaryButton label={`Confirm buy · ${formatFiatObj(quote.totalFiat)}`} onPress={confirm} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg, gap: 4,
  },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  heroFiat: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  warn: {},
  pinCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  pinHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
