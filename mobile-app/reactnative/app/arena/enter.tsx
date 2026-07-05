import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Flag, ShieldCheck, GraduationCap, Award, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useCompetition, useMe } from '@/features/arena/hooks';
import { useArenaStepUp } from '@/features/arena/useArenaStepUp';
import { ensureApplicationDraft } from '@/features/arena/draft';

/**
 * C0 — Enter the Challenge. Value prop → Start. Start runs the KYC step-up gate
 * (reuses kyc-verify) for the competition's required tier; on satisfy it opens
 * the C2 application form. If the user is already a contestant, it jumps to Compete.
 */
export default function EnterScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  const comp = useCompetition(competitionId);
  const me = useMe(competitionId);
  const requiredTier = (comp.data?.requiredKycTier ?? 1) as 1 | 2 | 3;
  const stepUp = useArenaStepUp(requiredTier);

  const start = async () => {
    // Already competing? Go straight to Compete.
    if (me.data?.contestant) {
      router.replace({ pathname: '/arena/compete', params: { competitionId } });
      return;
    }
    // C1 — KYC step-up. Reuses the existing kyc-verify flow; returns here on completion.
    if (!(await stepUp.ensure())) return;
    ensureApplicationDraft(competitionId);
    router.push({ pathname: '/arena/apply', params: { competitionId } });
  };

  if (comp.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Enter the Challenge" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  const benefits = [
    { Icon: ShieldCheck, title: 'Certified Safe Driver', body: 'Earn a verifiable credential recognised across Paymax.' },
    { Icon: GraduationCap, title: 'Free training', body: 'Structured road-safety modules — study at your own pace.' },
    { Icon: TrendingUp, title: 'Climb on Merit', body: 'Your ranking is earned by scores alone. Nothing else.' },
    { Icon: Award, title: 'Win the crown', body: 'Top the Merit leaderboard to be crowned Naija Driver.' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Enter the Challenge" subtitle={comp.data?.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroIcon}><Flag size={28} color={Colors.onPrimary} /></View>
          <Text style={styles.heroTitle}>Become a Naija Driver</Text>
          <Text style={styles.heroBody}>
            Register, train, and take the proctored theory exam. Rise on Merit — never on money or votes.
          </Text>
        </View>

        {benefits.map((b) => (
          <View key={b.title} style={[styles.benefit, shadow1]}>
            <View style={styles.benefitIcon}><b.Icon size={20} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.benefitTitle}>{b.title}</Text>
              <Text style={styles.benefitBody}>{b.body}</Text>
            </View>
          </View>
        ))}

        <View style={styles.gateNote}>
          <ShieldCheck size={16} color={Colors.secondary} />
          <Text style={styles.gateText}>
            You’ll complete a quick identity check (Tier {requiredTier}) before applying. This keeps the
            competition fair and your credential trustworthy.
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={me.data?.contestant ? 'Continue competing' : 'Start'}
          onPress={start}
          loading={stepUp.isLoading}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs, alignItems: 'flex-start' },
  heroIcon: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary },
  heroBody: { ...Typography.bodyMd, color: Colors.inversePrimary },
  benefit: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  benefitIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { ...Typography.labelLg, color: Colors.onSurface },
  benefitBody: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  gateNote: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md },
  gateText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
