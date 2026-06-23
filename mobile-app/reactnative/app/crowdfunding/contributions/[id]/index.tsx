import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CampaignStatusBadge from '@/features/crowdfunding/components/CampaignStatusBadge';
import { useContribution } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function ContributionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useContribution(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contribution" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load contribution" actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.amountHead}>
              <Text style={styles.amount}>{formatNaira(c.amountKobo)}</Text>
              <Text style={styles.campaign}>{c.campaignTitle}</Text>
            </View>

            <View style={styles.card}>
              <Row label="Status" valueNode={<StatusText status={c.status} />} />
              <Row label="Reference" value={c.reference} />
              <Row label="Payment method" value={c.paymentMethod} />
              <Row label="Contribution" value={formatNaira(c.amountKobo)} />
              <Row label="Fees" value={formatNaira(c.feeKobo)} />
              <View style={styles.divider} />
              <Row label="Total paid" value={formatNaira(c.totalKobo)} bold />
            </View>

            <View style={styles.card}>
              <Row label="Anonymous" value={c.anonymous ? 'Yes' : 'No'} />
              {c.rewardTierTitle ? <Row label="Reward" value={c.rewardTierTitle} /> : null}
              {c.message ? <Row label="Message" value={c.message} /> : null}
              <Row label="Date" value={new Date(c.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} />
            </View>

            <PrimaryButton label="View campaign" variant="secondary" onPress={() => router.push(`/crowdfunding/campaign/${c.campaignId}`)} />
          </ScrollView>

          {c.refundEligible && c.status === 'SUCCESSFUL' && (
            <SafeAreaView edges={['bottom']} style={styles.footer}>
              <PrimaryButton label="Request a refund" variant="ghost" onPress={() => router.push(`/crowdfunding/contributions/${c.id}/refund`)} />
            </SafeAreaView>
          )}
          {c.status === 'REFUND_REQUESTED' && (
            <SafeAreaView edges={['bottom']} style={styles.footer}>
              <View style={styles.refundBanner}>
                <Text style={styles.refundText}>Refund requested — our team is reviewing it. You'll be notified of the outcome.</Text>
              </View>
            </SafeAreaView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

function StatusText({ status }: { status: any }) {
  return <CampaignStatusBadge status={status === 'SUCCESSFUL' ? 'ACTIVE' : status === 'FAILED' ? 'REJECTED' : 'PENDING_REVIEW'} size="sm" />;
}

function Row({ label, value, valueNode, bold }: { label: string; value?: string; valueNode?: React.ReactNode; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {valueNode ?? <Text style={[styles.rowValue, bold && styles.rowValueBold]}>{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  amountHead: { alignItems: 'center', gap: 4, paddingVertical: Spacing.md },
  amount: { ...Typography.displayLg, fontSize: 40, lineHeight: 48, color: Colors.onSurface },
  campaign: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  rowValueBold: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  refundBanner: { backgroundColor: Colors.iconBgOrange, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  refundText: { ...Typography.bodySm, color: Colors.onSurface },
});
