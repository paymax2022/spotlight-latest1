import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, Lock, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import Chip from '@/features/academy/components/Chip';
import { useBundles, useMe } from '@/features/academy/hooks';
import { formatNaira, EXAM_META } from '@/features/academy/constants';

/** W5 — Exam bundle store. Premium prep packs per exam. Minor purchases gated. */
export default function ExamStore() {
  const bundles = useBundles();
  const me = useMe();
  const locked = me.data?.isMinor && me.data?.guardianConsent !== 'granted';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Exam store" subtitle="Premium prep packs" />
      <OfflineBanner />
      {locked ? (
        <View style={styles.lockBanner}>
          <Lock size={16} color={Colors.onWarning} />
          <Text style={styles.lockText}>Browsing is open, but a guardian must consent before you can buy.</Text>
        </View>
      ) : null}
      {bundles.isLoading ? (
        <StateView kind="loading" message="Loading store…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {bundles.data?.map((b) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[b.icon] ?? Package;
            const meta = EXAM_META[b.examSlug];
            return (
              <Pressable key={b.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/store/${b.id}`)}>
                <View style={[styles.iconBox, { backgroundColor: meta.iconBg }]}><Icon size={24} color={meta.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{b.name}</Text>
                  <Text style={styles.desc} numberOfLines={2}>{b.description}</Text>
                  <View style={styles.metaRow}>
                    <Chip label={meta.label} color={meta.color} bg={meta.iconBg} small />
                    <Text style={styles.meta}>{b.itemCount} items · {b.dataBudgetMb}MB</Text>
                  </View>
                  <Text style={styles.price}>{formatNaira(b.priceKobo)}{b.bnplEligible ? ' · BNPL' : ''}</Text>
                </View>
                <ChevronRight size={20} color={Colors.onSurfaceVariant} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  lockBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md },
  lockText: { ...Typography.labelSm, color: Colors.onWarning, flex: 1 },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleMd, color: Colors.primary, marginTop: 6 },
});
