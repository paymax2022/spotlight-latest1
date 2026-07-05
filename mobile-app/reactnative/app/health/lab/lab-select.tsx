import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { House, Building2, Star, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import LabMapView from '@/features/health/lab/components/LabMapView';
import { useLabs } from '@/features/health/lab/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { CollectionMode } from '@/features/health/lab/types';

export default function LabSelectScreen() {
  const params = useLocalSearchParams<{
    testId?: string;
    packageId?: string;
    name?: string;
    priceKobo?: string;
    homeCollection?: string;
  }>();
  const supportsHome = params.homeCollection === '1';
  const [mode, setMode] = useState<CollectionMode>(supportsHome ? 'home' : 'walk_in');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: labs, isLoading, isError, refetch } = useLabs(
    mode === 'home' ? { homeCollection: true } : undefined,
  );

  const onContinue = () => {
    if (!selected) return;
    router.push({
      pathname: '/health/lab/book',
      params: { ...params, labId: selected, mode },
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
        <StateView kind="loading" message="Finding nearby labs…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load labs" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (labs ?? []).length === 0 ? (
        <StateView kind="empty" icon="MapPin" title="No labs available" message="Try the other collection mode." />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <LabMapView
            height={160}
            caption={`${(labs ?? []).length} labs near you`}
            pins={(labs ?? []).map((l, i) => ({
              id: l.id,
              label: l.name,
              x: 0.2 + (i * 0.28) % 0.6,
              y: 0.25 + (i % 3) * 0.22,
              active: l.id === selected,
            }))}
          />

          {(labs ?? []).map((l) => {
            const fee = mode === 'home' ? l.homeCollectionFeeKobo : 0;
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
                    {l.distanceLabel} · {l.address}
                  </Text>
                </View>

                <View style={styles.foot}>
                  <Text style={styles.eta}>{l.resultEtaLabel}</Text>
                  <Text style={styles.fee}>{mode === 'home' ? `Collection ${formatNaira(fee)}` : 'No collection fee'}</Text>
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
