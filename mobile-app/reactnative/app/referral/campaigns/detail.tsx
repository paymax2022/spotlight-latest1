import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check, ShieldCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useCampaignDetail } from '@/features/referral/campaigns/hooks';

// M-CMP-02 — Campaign detail: eligibility, reward, vesting, end date.
const REWARD_TYPE_LABEL: Record<string, string> = {
  flat: 'Flat reward',
  dynamic: 'Dynamic reward',
  ltv_priced: 'LTV-priced reward',
};

export default function CampaignDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const { data, isLoading, isError, refetch } = useCampaignDetail(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Campaign" />
      {isLoading ? (
        <StateView kind="loading" message="Loading campaign…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="This campaign could not be found." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            {(() => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[data.icon] ?? Icons.Megaphone;
              return <View style={styles.headerIcon}><Icon size={26} color={Colors.primary} strokeWidth={2} /></View>;
            })()}
            <View style={styles.headerText}>
              <Text style={styles.title}>{data.title}</Text>
              <Text style={styles.blurb}>{data.blurb}</Text>
            </View>
          </View>

          {/* Reward */}
          <View style={styles.rewardCard}>
            <Text style={styles.rewardType}>{REWARD_TYPE_LABEL[data.reward.type] ?? data.reward.type}</Text>
            <Text style={styles.rewardHeadline}>{data.reward.headline}</Text>
            <View style={styles.rewardSplit}>
              <View style={styles.rewardCol}>
                <Text style={styles.rewardColLabel}>You earn (max)</Text>
                <Text style={styles.rewardColValue}>{formatNaira(data.reward.referrerKobo)}</Text>
              </View>
              {data.reward.refereeKobo != null ? (
                <View style={styles.rewardCol}>
                  <Text style={styles.rewardColLabel}>Friend's welcome</Text>
                  <Text style={styles.rewardColValue}>{formatNaira(data.reward.refereeKobo)}</Text>
                </View>
              ) : null}
            </View>
            {data.capKobo != null ? <Text style={styles.cap}>Capped at {formatNaira(data.capKobo)} per referrer</Text> : null}
            {data.endsAt ? (
              <View style={styles.endRow}><Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.endText}>Ends {relativeTime(data.endsAt)}</Text></View>
            ) : null}
          </View>

          <DisclosureCard tone="compliant" title="Why this is compliant" body={data.explanation} />

          {/* Eligibility */}
          <Text style={styles.sectionTitle}>Eligibility</Text>
          <View style={styles.list}>
            {data.eligibility.map((e, i) => (
              <View key={e} style={[styles.listItem, i < data.eligibility.length - 1 && styles.listBorder]}>
                <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} />
                <Text style={styles.listText}>{e}</Text>
              </View>
            ))}
          </View>

          {/* Qualifying actions */}
          <Text style={styles.sectionTitle}>Qualifying actions</Text>
          <View style={styles.list}>
            {data.qualifyingActions.map((q, i) => (
              <View key={q} style={[styles.listItem, i < data.qualifyingActions.length - 1 && styles.listBorder]}>
                <ShieldCheck size={16} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.listText}>{q}</Text>
              </View>
            ))}
          </View>

          {/* Vesting */}
          <Text style={styles.sectionTitle}>How the reward vests</Text>
          <View style={styles.vesting}>
            {data.vesting.map((v, i) => (
              <View key={v.label} style={[styles.vestRow, i < data.vesting.length - 1 && styles.listBorder]}>
                <View style={styles.vestBody}>
                  <Text style={styles.vestLabel}>{v.label}</Text>
                  <Text style={styles.vestCond}>{v.condition}</Text>
                </View>
                <Text style={styles.vestAmount}>{formatNaira(v.amountKobo)}</Text>
              </View>
            ))}
          </View>

          {/* Terms */}
          <Text style={styles.sectionTitle}>Terms</Text>
          <View style={styles.terms}>
            {data.terms.map((t) => <Text key={t} style={styles.term}>• {t}</Text>)}
          </View>

          {data.status !== 'ended' ? (
            <PrimaryButton label="Promote this campaign" onPress={() => router.push('/referral/(tabs)/invite' as never)} />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  header: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  headerIcon: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  blurb: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rewardCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  rewardType: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  rewardHeadline: { ...Typography.titleMd, color: Colors.onSurface },
  rewardSplit: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  rewardCol: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  rewardColLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rewardColValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const },
  cap: { ...Typography.caption, color: Colors.onSurfaceVariant },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  endText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  listBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  listText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  vesting: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  vestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.md },
  vestBody: { flex: 1 },
  vestLabel: { ...Typography.labelMd, color: Colors.onSurface },
  vestCond: { ...Typography.caption, color: Colors.onSurfaceVariant },
  vestAmount: { ...Typography.labelLg, color: Colors.onSurface },
  terms: { gap: 6 },
  term: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
