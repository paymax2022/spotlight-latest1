import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, ShieldCheck, ChevronRight, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useCoverSummary, useProducts } from '@/features/insurance/hooks';
import { ProductCard } from '@/features/insurance/components';
import {
  InsuranceColors,
  formatNaira,
  PRODUCT_LINES,
} from '@/features/insurance/constants/insurance.constants';

export default function ProtectionHub() {
  const summary = useCoverSummary();
  const products = useProducts();

  const featured = (products.data ?? []).slice(0, 3);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Protection</Text>
        </View>
        <Pressable onPress={() => router.push('/insurance/policies')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="My policies">
          <FileText size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* My cover summary */}
        <Pressable style={styles.coverCard} onPress={() => router.push('/insurance/policies')} accessibilityLabel="View my policy wallet">
          <View style={styles.coverHead}>
            <View style={styles.coverIcon}><ShieldCheck size={20} color={Colors.onPrimary} strokeWidth={2.2} /></View>
            <Text style={styles.coverTitle}>My cover</Text>
            <ChevronRight size={18} color={Colors.inversePrimary} />
          </View>
          {summary.isLoading ? (
            <Text style={styles.coverLoading}>Loading your cover…</Text>
          ) : summary.isError ? (
            <Text style={styles.coverLoading}>Couldn't load your cover. Tap to retry.</Text>
          ) : (
            <View style={styles.coverStats}>
              <Stat label="Active policies" value={String(summary.data?.activePolicies ?? 0)} />
              <Stat label="Total cover" value={formatNaira(summary.data?.totalSumInsuredKobo ?? 0)} />
              <Stat label="Renewals due" value={String(summary.data?.renewalsDue ?? 0)} />
            </View>
          )}
        </Pressable>

        {/* Product lines */}
        <Text style={styles.sectionTitle}>Protect what matters</Text>
        <View style={styles.lineGrid}>
          {PRODUCT_LINES.map((line) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[line.icon] ?? ShieldCheck;
            const tint = line.provider === 'OCTAMILE' ? InsuranceColors.octamile : InsuranceColors.mycover;
            const tintBg = line.provider === 'OCTAMILE' ? InsuranceColors.octamileBg : InsuranceColors.mycoverBg;
            return (
              <Pressable
                key={line.line}
                style={styles.lineTile}
                onPress={() => router.push(`/insurance/browse?line=${line.line}`)}
                accessibilityLabel={line.label}
              >
                <View style={[styles.lineIcon, { backgroundColor: tintBg }]}>
                  <Icon size={22} color={tint} strokeWidth={2} />
                </View>
                <Text style={styles.lineLabel} numberOfLines={1}>{line.label}</Text>
                <Text style={styles.lineDesc} numberOfLines={2}>{line.description}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Featured products */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Popular cover</Text>
          <Pressable onPress={() => router.push('/insurance/browse')} hitSlop={8}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {products.isLoading ? (
          <StateView kind="loading" compact message="Loading products…" />
        ) : products.isError ? (
          <StateView
            kind="error"
            compact
            title="Couldn't load products"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => products.refetch()}
          />
        ) : featured.length === 0 ? (
          <StateView kind="empty" compact title="No products yet" message="Cover options appear here soon." />
        ) : (
          <View style={styles.cardList}>
            {featured.map((p) => (
              <ProductCard key={p.code} product={p} onPress={() => router.push(`/insurance/product/${encodeURIComponent(p.code)}`)} />
            ))}
          </View>
        )}

        <View style={styles.complianceNote}>
          <Text style={styles.complianceText}>
            All cover is underwritten by NAICOM-licensed insurers and distributed via our partners.
            Paymax does not underwrite risk.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.lg },

  coverCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  coverHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  coverIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  coverTitle: { ...Typography.titleMd, color: Colors.onPrimary, flex: 1 },
  coverLoading: { ...Typography.bodySm, color: Colors.inversePrimary },
  coverStats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onPrimary },
  statLabel: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: 2 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },

  lineGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  lineTile: {
    width: '47%', flexGrow: 1, backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border,
    padding: Spacing.md, gap: Spacing.xs,
  },
  lineIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  lineLabel: { ...Typography.labelLg, color: Colors.onSurface },
  lineDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  cardList: { gap: Spacing.md },
  complianceNote: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  complianceText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
