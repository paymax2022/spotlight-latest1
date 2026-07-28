import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, X, Copy, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import { generateListingCopy } from '@/features/realtor/api/realtorAI.api';
import type { ListingCopySuggestion } from '@/features/realtor/api/realtorAI.api';
import { PROPERTY_TYPE_OPTIONS, PROPERTY_TYPE_LABEL, AMENITY_OPTIONS, AMENITY_LABEL } from '@/features/realtor/constants/realtor.constants';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';
import type { PropertyType, Amenity } from '@/features/realtor/types/realtor.types';

export default function AIListingAssistantScreen() {
  const [type, setType] = useState<PropertyType>('apartment');
  const [area, setArea] = useState('');
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(3);
  const [amenities, setAmenities] = useState<Amenity[]>(['security', 'power_backup', 'parking']);
  const [highlights, setHighlights] = useState('');

  const gen = useMutation<ListingCopySuggestion, Error>({
    mutationFn: () => generateListingCopy({ propertyType: type, area: area.trim() || 'Lekki', bedrooms, bathrooms, amenities, highlights }),
  });

  const toggleAmenity = (a: Amenity) =>
    setAmenities((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headTitle}>
          <Sparkles size={20} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.title}>AI listing assistant</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close">
          <X size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Tell me about the unit and I'll draft a listing title, description and a price band.</Text>

        <SelectField
          label="Property type"
          value={PROPERTY_TYPE_LABEL[type]}
          options={PROPERTY_TYPE_OPTIONS.map((t) => PROPERTY_TYPE_LABEL[t])}
          onChange={(label) => {
            const key = PROPERTY_TYPE_OPTIONS.find((t) => PROPERTY_TYPE_LABEL[t] === label);
            if (key) setType(key as PropertyType);
          }}
        />
        <TextInputField label="Area" placeholder="e.g. Lekki Phase 1" value={area} onChangeText={setArea} />

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <TextInputField label="Bedrooms" keyboardType="number-pad" value={String(bedrooms)} onChangeText={(t) => setBedrooms(Number(t.replace(/\D/g, '')) || 0)} />
          </View>
          <View style={styles.col}>
            <TextInputField label="Bathrooms" keyboardType="number-pad" value={String(bathrooms)} onChangeText={(t) => setBathrooms(Number(t.replace(/\D/g, '')) || 0)} />
          </View>
        </View>

        <Text style={styles.label}>Amenities</Text>
        <View style={styles.amenityRow}>
          {AMENITY_OPTIONS.slice(0, 10).map((a) => {
            const on = amenities.includes(a);
            return (
              <Pressable key={a} style={[styles.pill, on && styles.pillOn]} onPress={() => toggleAmenity(a)}>
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{AMENITY_LABEL[a]}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField label="Anything special? (optional)" placeholder="e.g. rooftop view, newly renovated" value={highlights} onChangeText={setHighlights} multiline />

        {gen.isPending ? (
          <StateView kind="loading" message="Drafting your listing…" compact />
        ) : gen.data ? (
          <View style={styles.result}>
            <View style={styles.resultHead}>
              <StatusBadge label="AI draft — editable" tone="info" icon="Sparkles" />
              <Pressable onPress={() => gen.mutate()} hitSlop={8} style={styles.regen} accessibilityLabel="Regenerate">
                <RefreshCw size={14} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.regenText}>Regenerate</Text>
              </Pressable>
            </View>
            <Text style={styles.resTitle}>{gen.data.title}</Text>
            <Text style={styles.resBody}>{gen.data.description}</Text>
            <View style={styles.tagRow}>
              {gen.data.tags.map((t) => <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>)}
            </View>
            <View style={styles.priceCard}>
              <Text style={styles.priceLabel}>Suggested price band</Text>
              <Text style={styles.priceVal}>{formatNaira(gen.data.priceLow)} – {formatNaira(gen.data.priceHigh)}</Text>
              <Text style={styles.priceRationale}>{gen.data.rationale}</Text>
            </View>
          </View>
        ) : null}

        {gen.isError ? <Text style={styles.error}>Couldn't generate copy. Please try again.</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        {gen.data ? (
          <PrimaryButton label="Use this draft" onPress={() => router.back()} />
        ) : (
          <PrimaryButton label="Generate listing" onPress={() => gen.mutate()} loading={gen.isPending} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 20 },
  twoCol: { flexDirection: 'row', gap: Spacing.md },
  col: { flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  pill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  pillOn: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  pillText: { ...Typography.labelSm, color: Colors.onSurface },
  pillTextOn: { color: Colors.primary, fontWeight: '700' as const },
  result: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary, padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.sm },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  regen: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  regenText: { ...Typography.labelSm, color: Colors.secondary },
  resTitle: { ...Typography.titleMd, color: Colors.onSurface },
  resBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  tagText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  priceCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  priceLabel: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  priceVal: { ...Typography.titleMd, color: Colors.tertiaryContainer, marginVertical: 2 },
  priceRationale: { ...Typography.bodySm, color: Colors.tertiaryContainer, lineHeight: 18 },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
});
