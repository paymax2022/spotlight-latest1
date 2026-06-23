import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ShoppingBag, ShieldCheck, Star, Share2, X, CheckCircle2, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView } from '@/features/doctor/components';
import { usePetProductDetail, useShareProductWithOwner } from '@/features/doctor/hooks';
import { PET_PRODUCT_CATEGORIES } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';

// Pet product detail (V.8) + share-with-owner (V.10).
export default function PetProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = String(id);

  const { data: detail, isLoading, isError, refetch } = usePetProductDetail(productId);
  const share = useShareProductWithOwner();

  const [shareOpen, setShareOpen] = useState(false);
  const [note, setNote] = useState('');

  const doShare = async () => {
    if (!detail) return;
    try {
      // Share keys off a recommendation; demo wires the product id as the rec id.
      await share.mutateAsync({ recommendationId: detail.product.id, note: note || undefined });
      setShareOpen(false); setNote('');
      Alert.alert('Shared', 'The product has been shared with the pet owner.');
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Product Detail" />

      {isLoading && !detail ? (
        <StateView variant="loading" label="Loading product" />
      ) : isError || !detail ? (
        <StateView variant="error" message="We could not load this product." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={[styles.swatch, { backgroundColor: detail.product.imageColor }]}>
              <ShoppingBag size={28} color={Colors.white} strokeWidth={2} />
            </View>
            <View style={styles.headerBody}>
              <Text style={styles.name}>{detail.product.name}</Text>
              <Text style={styles.brand}>{detail.product.brand}</Text>
              <View style={styles.badgeRow}>
                {detail.product.vetApproved && (
                  <View style={styles.vetTag}>
                    <ShieldCheck size={12} color={Colors.teal} strokeWidth={2.2} />
                    <Text style={styles.vetText}>Vet approved</Text>
                  </View>
                )}
                <View style={styles.ratingTag}>
                  <Star size={12} color={Colors.gold} strokeWidth={2.2} fill={Colors.gold} />
                  <Text style={styles.ratingText}>{detail.ratingAvg.toFixed(1)} ({detail.reviewCount})</Text>
                </View>
              </View>
            </View>
          </View>

          <SectionCard title="Details" style={styles.card}>
            <InfoRow label="Category" value={PET_PRODUCT_CATEGORIES.find((c) => c.value === detail.product.category)?.label ?? detail.product.category} />
            <InfoRow label="Price" value={formatKobo(detail.product.priceKobo)} valueColor={Colors.teal} />
            <InfoRow label="Stock" value={detail.inStock ? 'In stock' : 'Out of stock'} valueColor={detail.inStock ? Colors.teal : Colors.error} />
          </SectionCard>

          <SectionCard title="Description" style={styles.card}>
            <Text style={styles.body}>{detail.product.description}</Text>
          </SectionCard>

          <SectionCard title="Ingredients" style={styles.card}>
            {detail.ingredients.length === 0 ? (
              <Text style={styles.muted}>Not listed.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {detail.ingredients.map((ing) => (
                  <View key={ing} style={styles.tag}><Text style={styles.tagText}>{ing}</Text></View>
                ))}
              </View>
            )}
          </SectionCard>

          {!!detail.dosageGuidance && (
            <SectionCard title="Dosage guidance" style={styles.card}>
              <Text style={styles.body}>{detail.dosageGuidance}</Text>
            </SectionCard>
          )}

          <View style={styles.stockRow}>
            {detail.inStock
              ? <><CheckCircle2 size={16} color={Colors.teal} strokeWidth={2} /><Text style={styles.stockText}>Available to order now</Text></>
              : <><XCircle size={16} color={Colors.error} strokeWidth={2} /><Text style={[styles.stockText, { color: Colors.error }]}>Currently out of stock</Text></>}
          </View>

          <PrimaryButton label="Share with pet owner" onPress={() => setShareOpen(true)} style={styles.btn} />
        </ScrollView>
      )}

      {/* V.10 — share with owner sheet */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShareOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Share with owner</Text>
            <Pressable onPress={() => setShareOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <View style={styles.shareIconWrap}><Share2 size={28} color={Colors.primary} strokeWidth={2} /></View>
          <TextInput style={styles.input} placeholder="Add a note for the owner (optional)" placeholderTextColor={Colors.outline} value={note} onChangeText={setNote} multiline />
          <PrimaryButton label="Share product" onPress={doShare} loading={share.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  header:      { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  swatch:      { width: 72, height: 72, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  headerBody:  { flex: 1, gap: 4 },
  name:        { ...Typography.headlineMd, color: Colors.onSurface },
  brand:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  badgeRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  vetTag:      { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal },
  vetText:     { ...Typography.caption, color: Colors.teal, fontWeight: '600' },
  ratingTag:   { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  ratingText:  { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '600' },
  card:        { marginBottom: Spacing.md },
  body:        { ...Typography.bodyMd, color: Colors.onSurface },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tagWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag:         { height: 30, paddingHorizontal: 12, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  tagText:     { ...Typography.labelSm, color: Colors.onSurface },
  stockRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  stockText:   { ...Typography.labelMd, color: Colors.teal },
  btn:         { marginTop: Spacing.sm },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  shareIconWrap:{ alignItems: 'center', marginBottom: Spacing.md },
  input:       { minHeight: 80, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface, textAlignVertical: 'top' },
});
