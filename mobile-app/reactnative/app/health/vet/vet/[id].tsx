import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { MapPin, MessageCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import StarRating from '@/features/health/vet/components/StarRating';
import { useVet, useReviews } from '@/features/health/vet/hooks';
import { APPT_TYPE_META } from '@/features/health/vet/constants';
import { formatNaira, formatDate } from '@/features/health/constants/health.constants';

export default function VetProfileScreen() {
  const { id, petId } = useLocalSearchParams<{ id: string; petId?: string }>();
  const { data: vet, isLoading, isError, refetch } = useVet(id);
  const { data: reviews } = useReviews(id);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vet profile" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !vet) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vet profile" />
        <StateView kind="error" title="Couldn't load this vet" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const goBook = () =>
    router.push({ pathname: '/health/vet/triage', params: { vetId: vet.id, petId: petId ?? '' } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={vet.name} subtitle={vet.headline} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, shadow1]}>
          <View style={styles.head}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{vet.name.replace(/^Dr\.?\s*/, '').charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{vet.name}</Text>
              <Text style={styles.headline}>{vet.headline}</Text>
              <StarRating rating={vet.rating} count={vet.reviewCount} size={15} />
            </View>
          </View>
          <CredentialBadge credential={vet.credential} showLicense />
          <View style={styles.metaItem}>
            <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.metaText}>{vet.clinicName} · {vet.address}</Text>
          </View>
        </View>

        <Text style={styles.bio}>{vet.bio}</Text>

        {/* Services / types */}
        <Text style={styles.sectionTitle}>Consult options</Text>
        <View style={styles.typesGrid}>
          {vet.types.map((t) => {
            const m = APPT_TYPE_META[t];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Video;
            const fee = t === 'home' ? vet.homeVisitFeeKobo + vet.consultFeeKobo : vet.consultFeeKobo;
            return (
              <View key={t} style={[styles.typeCard, shadow1]}>
                <View style={[styles.typeIcon, { backgroundColor: m.bg }]}>
                  <Icon size={18} color={m.color} strokeWidth={2} />
                </View>
                <Text style={styles.typeLabel}>{m.label}</Text>
                <Text style={styles.typeFee}>{formatNaira(fee)}</Text>
              </View>
            );
          })}
        </View>

        {/* Specialties */}
        <Text style={styles.sectionTitle}>Specialties</Text>
        <View style={styles.chips}>
          {vet.specialties.map((s) => (
            <View key={s} style={styles.chip}>
              <Text style={styles.chipText}>{s}</Text>
            </View>
          ))}
        </View>

        {/* Reviews */}
        <View style={styles.reviewHead}>
          <Text style={styles.sectionTitle}>Reviews</Text>
        </View>
        {(reviews ?? []).map((r) => (
          <View key={r.id} style={[styles.review, shadow1]}>
            <View style={styles.reviewTop}>
              <View style={styles.reviewIcon}>
                <MessageCircle size={14} color={Colors.secondary} strokeWidth={2} />
              </View>
              <Text style={styles.reviewAuthor}>{r.author}</Text>
              <StarRating rating={r.rating} size={12} />
            </View>
            <Text style={styles.reviewBody}>{r.body}</Text>
            <Text style={styles.reviewDate}>{formatDate(r.at)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Book · from ${formatNaira(vet.consultFeeKobo)}`} onPress={goBook} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.headlineMd, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  bio: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  typesGrid: { flexDirection: 'row', gap: Spacing.sm },
  typeCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 4 },
  typeIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  typeFee: { ...Typography.labelMd, color: Colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  reviewHead: { marginTop: Spacing.xs },
  review: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reviewIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  reviewAuthor: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  reviewBody: { ...Typography.bodySm, color: Colors.onSurface },
  reviewDate: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
