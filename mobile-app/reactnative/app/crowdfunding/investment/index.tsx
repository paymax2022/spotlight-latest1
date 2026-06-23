import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, ChevronRight, TrendingUp, GraduationCap, ClipboardCheck, BadgeCheck, Gauge, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import EdgeState from '@/features/crowdfunding/components/EdgeState';
import { INVESTMENT_ENABLED } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { useInvestorProfile, useCompleteOnboardingStep } from '@/features/crowdfunding/hooks/useInvestment';

export default function InvestmentHome() {
  // Regulated module: hidden behind the licence flag.
  if (!INVESTMENT_ENABLED) {
    return (
      <EdgeState
        icon="Lock"
        title="Investments coming soon"
        message="Investment crowdfunding is a regulated feature that will open once Spotlight completes the required licensing. Donation and reward campaigns remain fully available."
        primaryLabel="Back to campaigns"
        onPrimary={() => router.replace('/crowdfunding')}
      />
    );
  }
  return <InvestmentHomeEnabled />;
}

function InvestmentHomeEnabled() {
  const { data: p, isLoading, isError, refetch } = useInvestorProfile();
  const completeStep = useCompleteOnboardingStep();

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Invest" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !p) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Invest" /><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  const steps = [
    { key: 'kyc', label: 'Identity verification', sub: 'Investor KYC', done: p.kycComplete, icon: BadgeCheck, onPress: () => completeStep.mutate({ step: 'kyc' }) },
    { key: 'education', label: 'Investor education', sub: '4 short lessons', done: p.educationComplete, icon: GraduationCap, onPress: () => router.push('/crowdfunding/investment/education') },
    { key: 'quiz', label: 'Knowledge quiz', sub: 'Confirm you understand the risks', done: p.quizPassed, icon: ClipboardCheck, onPress: () => router.push('/crowdfunding/investment/quiz') },
    { key: 'risk', label: 'Risk profile', sub: p.riskProfile ? p.riskProfile[0] + p.riskProfile.slice(1).toLowerCase() : 'Tell us your appetite', done: !!p.riskProfile, icon: Gauge, onPress: () => router.push('/crowdfunding/investment/risk-profile') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invest" subtitle="Regulated investment crowdfunding" rightSlot={
        p.onboarded ? <Pressable onPress={() => router.push('/crowdfunding/investment/portfolio')} hitSlop={8} accessibilityLabel="Portfolio"><Briefcase size={20} color={Colors.onSurface} strokeWidth={2} /></Pressable> : undefined
      } />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Risk banner */}
        <View style={styles.riskBanner}>
          <Text style={styles.riskTitle}>Capital at risk</Text>
          <Text style={styles.riskText}>Investing carries risk, including loss of your capital. Returns are projected, not guaranteed. Only invest what you can afford to lose.</Text>
        </View>

        {!p.onboarded ? (
          <>
            <Text style={styles.sectionTitle}>Get ready to invest</Text>
            <Text style={styles.sectionSub}>Complete these steps once before you can invest.</Text>
            {steps.map((s) => {
              const Icon = s.icon;
              return (
                <Pressable key={s.key} style={styles.step} onPress={s.done ? undefined : s.onPress} disabled={s.done} accessibilityRole="button">
                  <View style={[styles.stepIcon, s.done && styles.stepIconDone]}>
                    {s.done ? <Check size={18} color={Colors.onPrimary} strokeWidth={2.6} /> : <Icon size={18} color={Colors.primary} strokeWidth={2} />}
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepLabel}>{s.label}</Text>
                    <Text style={styles.stepSub}>{s.done ? 'Completed' : s.sub}</Text>
                  </View>
                  {!s.done && <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />}
                </Pressable>
              );
            })}
          </>
        ) : (
          <>
            <View style={styles.readyCard}>
              <TrendingUp size={22} color={Colors.tertiaryContainer} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.readyTitle}>You're ready to invest</Text>
                <Text style={styles.readySub}>Profile: {p.riskProfile} · Annual limit ₦{(p.annualLimitKobo / 100).toLocaleString('en-NG')}</Text>
              </View>
            </View>
            <View style={styles.browseBtn}><PrimaryButton label="Browse investment offers" onPress={() => router.push('/crowdfunding/investment/offers')} /></View>
            <Pressable style={styles.portfolioRow} onPress={() => router.push('/crowdfunding/investment/portfolio')} accessibilityRole="button">
              <Briefcase size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.portfolioText}>View my portfolio</Text>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  riskBanner: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  riskTitle: { ...Typography.labelMd, color: Colors.error, marginBottom: 2 },
  riskText: { ...Typography.bodySm, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  stepIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  stepIconDone: { backgroundColor: Colors.tertiaryContainer },
  stepBody: { flex: 1 },
  stepLabel: { ...Typography.labelLg, color: Colors.onSurface },
  stepSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  readyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  readyTitle: { ...Typography.labelLg, color: Colors.onSurface },
  readySub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  browseBtn: { marginBottom: Spacing.sm },
  portfolioRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  portfolioText: { ...Typography.labelLg, color: Colors.secondary, flex: 1 },
});
