import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { House, Building2, Star, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { useLabs, useTestOffers, usePackageOffers } from '@/features/health/lab/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { CollectionMode } from '@/features/health/lab/types';

export default function LabSelectScreen() {
  const params = useLocalSearchParams<{
    testId?: string;
    packageId?: string;
    name?: string;
    priceKobo?: string;
    homeCollection?: string;
    code?: string;
  }>();
  const supportsHome = params.homeCollection === '1';
  const [mode, setMode] = useState<CollectionMode>(supportsHome ? 'home' : 'walk_in');
  const [selected, setSelected] = useState<string | null>(null);
  const labsQ = useLabs(mode === 'home' ? { homeCollection: true } : undefined);
  const testOffersQ = useTestOffers(params.code);
  const pkgOffersQ = usePackageOffers(params.packageId ? params.name : undefined);
  const offersQ = params.packageId ? pkgOffersQ : testOffersQ;
  const isLoading = labsQ.isLoading || offersQ.isLoading;
  const isError = labsQ.isError || offersQ.isError;
  const refetch = () => {
    labsQ.refetch();
    offersQ.refetch();
  };
  // Only labs that actually offer this item, each at its own price. Tests and
  // packages are per-lab rows, so the id and price depend on the chosen lab.
  const offers: { labId: string; itemId: string; priceKobo: number }[] = params.packageId
    ? (pkgOffersQ.data ?? []).map((o) => ({ labId: o.labId, itemId: o.packageId, priceKobo: o.priceKobo }))
    : (testOffersQ.data ?? []).map((o) => ({ labId: o.labId, itemId: o.testId, priceKobo: o.priceKobo }));
  const labs = (labsQ.data ?? []).filter((l) => offers.some((o) => o.labId === l.id));
  const priceAt = (labId: string) => offers.find((o) => o.labId === labId)?.priceKobo;

  const onContinue = () => {
    if (!selected) return;
    const offer = offers.find((o) => o.labId === selected);
    if (!offer) return;
    router.push({
      pathname: '/health/lab/book',
      // The ordered item is THIS lab's row, at THIS lab's price.
      params: {
        ...params,
        labId: selected,
        mode,
        priceKobo: String(offer.priceKobo),
        ...(params.packageId ? { packageId: offer.itemId } : { testId: offer.itemId }),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose collection" subtitle={params.name ?? 'Select a lab'} />

      <View style={styles.modeRow}>
        <SegmentedControl
          options={[
            { value: 'home', label: 'Home collection' },
            { value: 'walk_in', label: 'Walk-in' },
          ]}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setSelected(null);
          }}
        />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Finding labs…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load labs" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : labs.length === 0 ? (
        <StateView kind="empty" icon="MapPin" title="No labs available" message="No lab offers this test for this collection mode. Try the other mode." />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {labs.map((l) => {
            return (
              <Pressable
                key={l.id}
                style={[styles.card, shadow1, l.id === selected && styles.cardSel]}
                onPress={() => setSelected(l.id)}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.icon, { backgroundColor: Colors.iconBgTeal }]}>
                    {mode === 'home' ? (
                      <House size={18} color={Colors.teal} strokeWidth={2} />
                    ) : (
                      <Building2 size={18} color={Colors.teal} strokeWidth={2} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{l.name}</Text>
                    <Text style={styles.headline}>{l.headline}</Text>
                  </View>
                  <View style={styles.rating}>
                    <Star size={12} color={Colors.gold} strokeWidth={2} fill={Colors.gold} />
                    <Text style={styles.ratingText}>{l.rating}</Text>
                  </View>
                </View>

                <CredentialBadge credential={l.credential} showLicense />

                <View style={styles.metaRow}>
                  <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.meta} numberOfLines={1}>
                    {l.distanceLabel ? `${l.distanceLabel} · ` : ''}{l.address}
                  </Text>
                </View>

                <View style={styles.foot}>
                  <Text style={styles.eta}>{l.resultEtaLabel}</Text>
                  <Text style={styles.fee}>
                    {formatNaira(priceAt(l.id) ?? 0)}
                    {mode === 'home' && l.homeCollectionFeeKobo > 0 ? ` + ${formatNaira(l.homeCollectionFeeKobo)} home visit` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={onContinue} disabled={!selected} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  modeRow: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  cardSel: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { ...Typography.labelMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eta: { ...Typography.labelMd, color: Colors.teal },
  fee: { ...Typography.labelMd, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
