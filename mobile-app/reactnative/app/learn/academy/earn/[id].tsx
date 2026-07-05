import React from 'react';
import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { CheckCircle2, Circle, ExternalLink, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useOpportunity, useApplyOpportunity } from '@/features/academy/hooks';
import type { EarningApplication } from '@/features/academy/types';

/**
 * S7 — Opportunity detail & apply. Applying does NOT rebuild onboarding: it calls
 * POST /earning/apply and routes the learner into the EXISTING Paymax role-upgrade
 * / KYC flow via a deep link (mock-first; the link is surfaced, not navigated by us).
 */
export default function OpportunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const opp = useOpportunity(id);
  const apply = useApplyOpportunity();
  const [application, setApplication] = React.useState<EarningApplication | null>(null);

  if (opp.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading role…" /></SafeAreaView>;
  if (opp.isError || !opp.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Not found" message="This opportunity is unavailable." /></SafeAreaView>;

  const o = opp.data;
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[o.icon] ?? Icons.Briefcase;
  const eligible = o.eligibility === 'eligible';

  const onApply = () => {
    apply.mutate(o.id, { onSuccess: (a) => setApplication(a) });
  };

  // The deep link concept: hand off to the existing Paymax onboarding. We attempt
  // to open it (no-op in Expo Go for a custom scheme) and always show the next step.
  const openPaymax = (deepLink: string) => { Linking.openURL(deepLink).catch(() => {}); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={o.title} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.headCard, shadow1]}>
          <View style={styles.icon}><Icon size={24} color={Colors.primary} /></View>
          <Text style={styles.title}>{o.title}</Text>
          <Text style={styles.partner}>{o.partner}</Text>
          <Text style={styles.earnings}>{o.earningsLabel}</Text>
          <Text style={styles.summary}>{o.summary}</Text>
        </View>

        {/* Eligibility checklist */}
        <View style={[styles.block, shadow1]}>
          <Text style={styles.blockTitle}>What you need</Text>
          {o.requirements.map((r, i) => (
            <View key={i} style={styles.reqRow}>
              {eligible ? <CheckCircle2 size={16} color={Colors.teal} /> : <Circle size={16} color={Colors.onSurfaceVariant} />}
              <Text style={styles.reqText}>{r}</Text>
            </View>
          ))}
        </View>

        {/* Paymax bridge explanation */}
        <View style={[styles.bridge, shadow1]}>
          <ArrowRight size={18} color={Colors.primary} />
          <Text style={styles.bridgeText}>
            Applying takes you into the Paymax super app to finish role upgrade and KYC. You will not re-enter your academy details — your credentials carry over.
          </Text>
        </View>

        {application ? (
          <View style={[styles.handoff, shadow1]}>
            <CheckCircle2 size={20} color={Colors.teal} />
            <Text style={styles.handoffTitle}>Application started</Text>
            <Text style={styles.handoffBody}>{application.nextStep}</Text>
            <PrimaryButton label="Continue in Paymax" onPress={() => openPaymax(application.onboardingDeepLink)} />
            <View style={styles.linkRow}><ExternalLink size={12} color={Colors.onSurfaceVariant} /><Text style={styles.linkText} numberOfLines={1}>{application.onboardingDeepLink}</Text></View>
            <PrimaryButton label="Back to opportunities" onPress={() => router.replace('/learn/academy/earn')} variant="ghost" />
          </View>
        ) : o.applied ? (
          <PrimaryButton label="Already applied — continue in Paymax" onPress={onApply} loading={apply.isPending} variant="secondary" />
        ) : (
          <>
            <PrimaryButton label={eligible ? 'Apply & continue in Paymax' : 'Apply (you may need to finish KYC)'} onPress={onApply} loading={apply.isPending} />
            {apply.isError ? <Text style={styles.err}>{(apply.error as Error).message}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  headCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4 },
  icon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  partner: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  earnings: { ...Typography.titleMd, color: Colors.primary, marginTop: 4 },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: 4 },
  block: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8 },
  blockTitle: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  bridge: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  bridgeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  handoff: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8, alignItems: 'center' },
  handoffTitle: { ...Typography.titleMd, color: Colors.onSurface },
  handoffBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  linkText: { ...Typography.caption, color: Colors.onSurfaceVariant, flexShrink: 1 },
  err: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
});
