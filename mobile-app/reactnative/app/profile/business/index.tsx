import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, ChevronRight, ShieldCheck, FilePlus2, Landmark } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { getMyBusinesses, isBusinessActive } from '@/api/business.api';
import { statusChip, toneColors } from '@/features/business/statusDisplay';
import { CertificateAction } from '@/features/business/CertificateAction';
import type { BusinessEntityType, BusinessProfile } from '@/types/business';

const ENTITY_LABEL: Record<BusinessEntityType, string> = {
  business_name:        'Business name',
  company:              'Limited company',
  incorporated_trustee: 'Incorporated trustee',
};

function businessTitle(b: BusinessProfile): string {
  return b.legalName || b.proposedName || 'Unnamed business';
}

export default function BusinessHubScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['business', 'me'],
    queryFn: getMyBusinesses,
  });

  const businesses = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Business / Merchant" subtitle="Register or verify with CAC" />

      {isLoading && !data ? (
        <StateView kind="loading" message="Loading your businesses" />
      ) : isError ? (
        <StateView
          kind="error"
          title="Couldn't load your businesses"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={Colors.primary} />}
        >
          {/* Intro */}
          <View style={[styles.intro, shadow1]}>
            <View style={styles.introIcon}>
              <Building2 size={22} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.introText}>
              Register a new business name or verify one you already own with the Corporate Affairs
              Commission (CAC). A verified or registered business unlocks merchant capabilities.
            </Text>
          </View>

          {/* Existing businesses */}
          {businesses.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Your businesses</Text>
              <View style={styles.group}>
                {businesses.map((b) => {
                  const chip = statusChip(b.status);
                  const tc = toneColors(chip.tone);
                  return (
                    <View key={b.id} style={styles.rowGroup}>
                      <Pressable
                        onPress={() => router.push(`/profile/business/register?resumeId=${b.id}` as never)}
                        style={({ pressed }) => [styles.row, shadow1, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`${businessTitle(b)}, ${chip.label}`}
                      >
                        <View style={styles.rowIcon}>
                          <Landmark size={20} color={Colors.primary} strokeWidth={2} />
                        </View>
                        <View style={styles.rowBody}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{businessTitle(b)}</Text>
                          <Text style={styles.rowSub} numberOfLines={1}>
                            {ENTITY_LABEL[b.entityType]}
                            {b.rcOrBnNumber ? ` · ${b.rcOrBnNumber}` : ''}
                          </Text>
                        </View>
                        <Text style={[styles.chip, { backgroundColor: tc.bg, color: tc.fg }]}>{chip.label}</Text>
                      </Pressable>
                      {isBusinessActive(b) ? <CertificateAction business={b} /> : null}
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <View style={styles.emptyHint}>
              <Text style={styles.emptyHintText}>
                You don't have any businesses yet. Verify an existing one or register a new business name to get started.
              </Text>
            </View>
          )}

          {/* CTAs */}
          <Text style={styles.sectionTitle}>Get started</Text>

          <Pressable
            onPress={() => router.push('/profile/business/verify' as never)}
            style={({ pressed }) => [styles.cta, shadow1, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Verify an existing business"
          >
            <View style={[styles.ctaIcon, { backgroundColor: Colors.iconBgBlue }]}>
              <ShieldCheck size={22} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={styles.ctaBody}>
              <Text style={styles.ctaTitle}>Verify existing business</Text>
              <Text style={styles.ctaSub}>Already have an RC/BN number? Confirm it with CAC.</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/profile/business/register' as never)}
            style={({ pressed }) => [styles.cta, shadow1, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Register a new business name"
          >
            <View style={[styles.ctaIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <FilePlus2 size={22} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.ctaBody}>
              <Text style={styles.ctaTitle}>Register a new business name</Text>
              <Text style={styles.ctaSub}>Check availability, add proprietors, pay the CAC fee.</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  intro:       { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  introIcon:   { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  introText:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  group:       { gap: Spacing.sm, marginBottom: Spacing.lg },
  rowGroup:    { gap: Spacing.sm },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  rowIcon:     { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowBody:     { flex: 1, gap: 2 },
  rowTitle:    { ...Typography.labelLg, color: Colors.onSurface },
  rowSub:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip:        { ...Typography.labelSm, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, overflow: 'hidden', fontWeight: '700' },
  emptyHint:   { backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  emptyHintText:{ ...Typography.bodySm, color: Colors.onSurface },
  cta:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  ctaIcon:     { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  ctaBody:     { flex: 1, gap: 2 },
  ctaTitle:    { ...Typography.labelLg, color: Colors.onSurface },
  ctaSub:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pressed:     { opacity: 0.9 },
});
