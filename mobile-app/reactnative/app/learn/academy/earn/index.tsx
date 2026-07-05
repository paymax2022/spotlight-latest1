import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useOpportunities } from '@/features/academy/hooks';
import type { EligibilityState } from '@/features/academy/types';

const ELIG: Record<EligibilityState, { label: string; color: string; bg: string }> = {
  eligible:         { label: 'Eligible',        color: Colors.teal,      bg: Colors.iconBgTeal },
  needs_credential: { label: 'Needs credential', color: Colors.onWarning, bg: Colors.iconBgGold },
  needs_kyc:        { label: 'Needs KYC',        color: Colors.secondary, bg: Colors.iconBgBlue },
  locked:           { label: 'Locked',           color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

/** S6 — Earning opportunities feed: Paymax roles unlocked by your credentials. */
export default function EarningFeedScreen() {
  const opps = useOpportunities();
  if (opps.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Finding opportunities…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Trade & Earn" subtitle="Turn skills into income on Paymax" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>These roles run in the Paymax super app. Applying hands you off to Paymax onboarding (role upgrade + KYC) — your academy credentials carry over.</Text>
        {opps.data?.map((o) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[o.icon] ?? Icons.Briefcase;
          const e = ELIG[o.eligibility];
          return (
            <Pressable key={o.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/earn/${o.id}`)}>
              <View style={styles.icon}><Icon size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{o.title}</Text>
                <Text style={styles.sub}>{o.partner} · {o.earningsLabel}</Text>
                <View style={styles.metaRow}>
                  {o.applied ? (
                    <View style={styles.appliedTag}><CheckCircle2 size={12} color={Colors.teal} /><Text style={styles.appliedText}>Applied</Text></View>
                  ) : (
                    <Chip label={e.label} color={e.color} bg={e.bg} small />
                  )}
                </View>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  appliedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  appliedText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' },
});
