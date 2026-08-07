import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { confirmAsync } from '@/lib/confirm';
import { TrendingUp, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useInvestorProfile } from '@/features/fractionalre/hooks';
import { formatNaira, progressPct } from '@/features/fractionalre/utils';
import { RISK_BAND_LABEL } from '@/features/fractionalre/constants';

export default function InvestorProfileScreen() {
  const profile = useInvestorProfile();
  const p = profile.data;

  if (profile.isLoading || !p) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Investor profile" />
        <StateView kind={profile.isLoading ? 'loading' : 'error'} message="Loading profile…" />
      </SafeAreaView>
    );
  }

  const usedKobo = p.annualLimitKobo - p.remainingAllowanceKobo;
  const usedPct = progressPct(usedKobo, p.annualLimitKobo);
  const classLabel = p.classification === 'hni' ? 'High-Net-Worth' : p.classification === 'qualified' ? 'Qualified' : 'Retail';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Investor profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Classification</Text>
          <Text style={styles.classValue}>{classLabel} investor</Text>
          <Text style={styles.muted}>Risk profile: {p.riskProfile ? RISK_BAND_LABEL[p.riskProfile] : 'Not set'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Annual allowance</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${usedPct}%` }]} /></View>
          <View style={styles.allowRow}>
            <Text style={styles.muted}>Used {formatNaira(usedKobo)}</Text>
            <Text style={styles.muted}>Remaining {formatNaira(p.remainingAllowanceKobo)}</Text>
          </View>
          <Text style={styles.limit}>Limit: {formatNaira(p.annualLimitKobo)} / year</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why can't I edit this?</Text>
          <Text style={styles.readOnlyNote}>
            Income, net worth and investor classification are set by your suitability
            assessment, so they're read-only here. To change them, retake the assessment.
          </Text>
          <Pressable
            style={styles.suitabilityLink}
            hitSlop={8}
            onPress={() => router.push('/fractionalre/onboarding/suitability')}
          >
            <Text style={styles.suitabilityLinkText}>Update suitability</Text>
            <ChevronRight size={16} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        </View>

        {p.classification === 'retail' ? (
          <View style={styles.upgrade}>
            <View style={styles.upgradeHead}>
              <TrendingUp size={18} color={Colors.gold} strokeWidth={2} />
              <Text style={styles.upgradeTitle}>Upgrade to HNI</Text>
            </View>
            <Text style={styles.upgradeBody}>
              High-Net-Worth Investors get a higher annual limit and access to qualified-only offerings.
              Verify income/net-worth evidence to upgrade.
            </Text>
            <PrimaryButton
              label="Request HNI upgrade"
              variant="secondary"
              onPress={async () => {
                await confirmAsync({ title: 'HNI upgrade', message: 'Submit income and net-worth evidence via KYC to be reviewed for HNI classification.', confirmLabel: 'Open KYC', cancelLabel: 'Close' });
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: 6, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  classValue: { ...Typography.headlineMd, color: Colors.onSurface },
  muted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track: { height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginVertical: 6 },
  fill: { height: 10, backgroundColor: Colors.primary, borderRadius: Radius.full },
  allowRow: { flexDirection: 'row', justifyContent: 'space-between' },
  limit: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  readOnlyNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  suitabilityLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start' },
  suitabilityLinkText: { ...Typography.labelLg, color: Colors.primary },
  upgrade: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: 'rgba(234,179,8,0.35)' },
  upgradeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  upgradeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  upgradeBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
});
