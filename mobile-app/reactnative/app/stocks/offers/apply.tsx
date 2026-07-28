import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { CheckCircle2, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { usePublicOffer, useApplyToOffer } from '@/features/stocks/hooks/useStocks';
import { formatMoneyObj, formatMoney } from '@/features/stocks/utils/stockFormatters';
import { NO_ADVICE_DISCLOSURE } from '@/features/stocks/constants/stocks.constants';

export default function OfferApplyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = usePublicOffer(id);
  const apply = useApplyToOffer();

  const [unitsText, setUnitsText] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [reference, setReference] = useState<string | undefined>();

  if (offer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Apply" />
        <StateView kind="loading" message="Loading offer…" />
      </SafeAreaView>
    );
  }
  if (offer.isError || !offer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Apply" />
        <StateView kind="error" title="Couldn't load offer" message="This offer could not be found." actionLabel="Retry" onAction={() => offer.refetch()} />
      </SafeAreaView>
    );
  }

  const o = offer.data;

  // Success state (self-contained toggle).
  if (reference) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application submitted" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <CheckCircle2 size={56} color={Colors.teal} strokeWidth={1.8} />
          </View>
          <Text style={styles.successTitle}>Application submitted</Text>
          <Text style={styles.successMsg}>
            Your application to {o.name} ({o.symbol}) has been received. Allotment will be confirmed after the offer closes.
          </Text>
          <View style={styles.refBox}>
            <Text style={styles.refLabel}>Reference</Text>
            <Text style={styles.refValue}>{reference}</Text>
          </View>
          <View style={styles.successAction}>
            <PrimaryButton label="Done" onPress={() => router.dismissTo('/stocks/offers')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const units = parseInt(unitsText.replace(/[^0-9]/g, ''), 10) || 0;
  const estCost = units * o.priceHigh.amount;
  const validUnits = units >= o.minUnits;
  const validPin = pin.length === 4;
  const canSubmit = validUnits && validPin && !apply.isPending;

  const onSubmit = () => {
    setError(undefined);
    if (!validUnits) {
      setError(`Minimum ${o.minUnits.toLocaleString('en-US')} units.`);
      return;
    }
    apply.mutate(
      { id: o.id, units },
      {
        onSuccess: (order) => setReference(order.reference),
        onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Could not submit your application. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Apply" subtitle={`${o.name} · ${o.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Offer context */}
        <View style={styles.card}>
          <Row label="Offer" value={`${o.symbol}`} />
          <Row label="Price band" value={`${formatMoneyObj(o.priceLow)} – ${formatMoneyObj(o.priceHigh)}`} />
          <Row label="Minimum units" value={o.minUnits.toLocaleString('en-US')} />
        </View>

        <TextInputField
          label="Units"
          keyboardType="number-pad"
          placeholder={`At least ${o.minUnits}`}
          value={unitsText}
          onChangeText={(t) => { setUnitsText(t); setError(undefined); }}
          error={unitsText.length > 0 && !validUnits ? `Minimum ${o.minUnits.toLocaleString('en-US')} units` : undefined}
        />

        {/* Estimated cost */}
        <View style={styles.estBox}>
          <Text style={styles.estLabel}>Estimated cost</Text>
          <Text style={styles.estValue}>
            {units > 0 ? formatMoney(estCost, o.priceHigh.currency) : '—'}
          </Text>
          <Text style={styles.estHint}>{units} units × {formatMoneyObj(o.priceHigh)} (at top of band)</Text>
        </View>

        <TextInputField
          label="Transaction PIN"
          keyboardType="number-pad"
          placeholder="••••"
          maxLength={4}
          secure
          value={pin}
          onChangeText={(t) => { setPin(t.replace(/[^0-9]/g, '')); setError(undefined); }}
        />

        {error ? (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.disclosure}>
          <Info size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.disclosureText}>{NO_ADVICE_DISCLOSURE}</Text>
        </View>

        <View style={styles.actionWrap}>
          <PrimaryButton label="Submit application" onPress={onSubmit} disabled={!canSubmit} loading={apply.isPending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },

  estBox: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  estLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  estValue: { ...Typography.headlineMd, color: Colors.onSurface },
  estHint: { ...Typography.caption, color: Colors.onSurfaceVariant },

  errBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  errText: { ...Typography.labelMd, color: Colors.error, lineHeight: 18 },

  disclosure: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.xs },
  disclosureText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  actionWrap: { marginTop: Spacing.sm },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  successIcon: { width: 96, height: 96, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgTeal },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 20 },
  refBox: { alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, gap: 4, marginTop: Spacing.sm },
  refLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  refValue: { ...Typography.titleMd, color: Colors.onSurface },
  successAction: { width: '100%', marginTop: Spacing.md },
});
