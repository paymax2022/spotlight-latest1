import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShoppingBag, Info, Truck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, SoapSection, StateView, PetProductTile, StatusBadge } from '@/features/doctor/components';
import { usePetProducts, usePetRecommendations, useRecommendProducts } from '@/features/doctor/hooks';
import { PET_PRODUCT_CATEGORIES } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';
import type { PetProductCategory } from '@/types/doctor.phase3';

export default function PetStoreScreen() {
  const { petId } = useLocalSearchParams<{ petId?: string }>();
  const pet = petId ? String(petId) : '';

  const [category, setCategory] = useState<PetProductCategory | undefined>(undefined);
  const { data: products = [], isLoading, isError, refetch, isPlaceholderData } = usePetProducts(category);
  const { data: recommendations = [] } = usePetRecommendations(pet);
  const recommend = useRecommendProducts();

  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [vetApprovedOnly, setVetApprovedOnly] = useState(false);

  // V.7 — vet-approved filter applied on top of the category filter.
  const visibleProducts = vetApprovedOnly ? products.filter((p) => p.vetApproved) : products;

  const toggle = (pid: string) => setSelected((prev) => (prev.includes(pid) ? prev.filter((p) => p !== pid) : [...prev, pid]));
  const canSubmit = !!pet && selected.length > 0;

  const handleSubmit = async () => {
    if (!pet) {
      Alert.alert('No pet selected', 'Open this from a pet profile to recommend products.');
      return;
    }
    if (selected.length === 0) {
      Alert.alert('Select products', 'Choose at least one product to recommend.');
      return;
    }
    try {
      const result = await recommend.mutateAsync({ petId: pet, productIds: selected, note });
      Alert.alert('Recommendation sent', `${result.ref} ${result.sharedWithOwner ? 'shared with the owner.' : 'saved.'}`, [
        { text: 'Done', onPress: () => { setSelected([]); setNote(''); } },
      ]);
    } catch {
      Alert.alert('Failed', 'Could not send the recommendation. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Store" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading products" />
      ) : isError ? (
        <StateView variant="error" message="We could not load the pet store." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Category filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              <Pressable onPress={() => setCategory(undefined)} style={[styles.filterChip, !category && styles.filterChipOn]} accessibilityRole="button" accessibilityLabel="All products">
                <Text style={[styles.filterText, !category && styles.filterTextOn]}>All</Text>
              </Pressable>
              {PET_PRODUCT_CATEGORIES.map((c) => {
                const active = category === c.value;
                return (
                  <Pressable key={c.value} onPress={() => setCategory(c.value)} style={[styles.filterChip, active && styles.filterChipOn]} accessibilityRole="button" accessibilityLabel={c.label}>
                    <Text style={[styles.filterText, active && styles.filterTextOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {recommendations.length > 0 && (
              <SectionCard title="Previous recommendations" style={styles.card}>
                {recommendations.map((r, i) => (
                  <View key={r.id} style={[styles.recRow, i > 0 && styles.rowBorder]}>
                    <View style={styles.recBody}>
                      <Text style={styles.recRef}>{r.ref}</Text>
                      <Text style={styles.recNote} numberOfLines={2}>{r.note}</Text>
                      <Text style={styles.recMeta}>{r.products.length} product(s)</Text>
                    </View>
                    {r.sharedWithOwner && <StatusBadge label="Shared" tone="success" />}
                  </View>
                ))}
              </SectionCard>
            )}

            {/* V.7 — vet-approved filter */}
            <Pressable style={styles.vetApprovedRow} onPress={() => setVetApprovedOnly((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: vetApprovedOnly }} accessibilityLabel="Vet-approved only">
              <Text style={styles.vetApprovedLabel}>Vet-approved only</Text>
              <View style={[styles.toggleTrack, vetApprovedOnly && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, vetApprovedOnly && styles.toggleThumbOn]} />
              </View>
            </Pressable>

            <Text style={styles.sectionTitle}>Products ({selected.length} selected)</Text>
            {visibleProducts.length === 0 ? (
              <StateView variant="empty" icon={ShoppingBag} title="No products" message="No products match this filter." />
            ) : (
              <View style={styles.list}>
                {visibleProducts.map((p) => (
                  <View key={p.id}>
                    <PetProductTile
                      name={p.name}
                      brand={p.brand}
                      categoryLabel={PET_PRODUCT_CATEGORIES.find((c) => c.value === p.category)?.label ?? p.category}
                      priceText={formatKobo(p.priceKobo)}
                      vetApproved={p.vetApproved}
                      swatch={p.imageColor}
                      selected={selected.includes(p.id)}
                      onToggle={() => toggle(p.id)}
                    />
                    <Pressable style={styles.detailLink} onPress={() => router.push(`/(doctor)/vet/product/${p.id}`)} accessibilityRole="button" accessibilityLabel={`View ${p.name} details`}>
                      <Info size={14} color={Colors.primary} strokeWidth={2} />
                      <Text style={styles.detailLinkText}>View product detail</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <SoapSection label="Note to owner" hint="Why you recommend these products" value={note} onChangeText={setNote} placeholder="e.g. Switch to the joint-support diet and add daily fish oil." />

            <PrimaryButton label="Send recommendation" onPress={handleSubmit} loading={recommend.isPending} disabled={!canSubmit} style={styles.btn} />
            {!pet && <Text style={styles.hint}>Open from a pet profile to attach this recommendation to a pet.</Text>}

            <Pressable style={styles.fulfilLink} onPress={() => router.push('/(doctor)/vet/fulfilments')} accessibilityRole="button" accessibilityLabel="View store fulfilments">
              <Truck size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.detailLinkText}>View store fulfilments</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  flex:          { flex: 1 },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  filters:       { gap: Spacing.sm, paddingBottom: Spacing.md },
  filterChip:    { height: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  filterChipOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText:    { ...Typography.labelMd, color: Colors.onSurface },
  filterTextOn:  { color: Colors.onPrimary },
  card:          { marginBottom: Spacing.md },
  recRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  recBody:       { flex: 1, gap: 2 },
  recRef:        { ...Typography.labelMd, color: Colors.onSurface },
  recNote:       { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  recMeta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  sectionTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  list:          { marginBottom: Spacing.xs },
  btn:           { marginTop: Spacing.sm },
  hint:          { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  vetApprovedRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, marginBottom: Spacing.xs },
  vetApprovedLabel:{ ...Typography.labelMd, color: Colors.onSurface },
  toggleTrack:   { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, padding: 2, justifyContent: 'center' },
  toggleTrackOn: { backgroundColor: Colors.primary },
  toggleThumb:   { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.white },
  toggleThumbOn: { alignSelf: 'flex-end' },
  detailLink:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xs, paddingLeft: Spacing.sm, marginBottom: Spacing.sm },
  detailLinkText:{ ...Typography.labelSm, color: Colors.primary },
  fulfilLink:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.md },
});
