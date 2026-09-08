import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useCampaign, useCampaignAnalytics, usePause, useResume, useCancel } from '@/features/featured/hooks';
import { StatusBadge } from '@/features/featured/components';
import { HomeMenuButton } from '@/components/HomeMenu';
import {
  formatNaira, formatDate, countdownLabel,
  canPause, canResume, canCancel, canRenew,
} from '@/features/featured/utils';

function Stat({ icon, label, value }: { icon: keyof typeof Icons; label: string; value: string }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon as string] ?? Icons.Circle;
  return (
    <View style={s.stat}>
      <Icon size={18} color={Colors.secondary} strokeWidth={2} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export default function PromotionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaignId = id ?? '';
  const cq = useCampaign(campaignId, { poll: true });
  const c = cq.data;
  const isLive = c?.state === 'ACTIVE' || c?.state === 'PAUSED' || c?.state === 'SCHEDULED';
  const aq = useCampaignAnalytics(campaignId, { poll: isLive });

  const pause = usePause();
  const resume = useResume();
  const cancel = useCancel();
  const busy = pause.isPending || resume.isPending || cancel.isPending;

  if (cq.isLoading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Header />
        <StateView kind="loading" message="Loading promotion…" />
      </SafeAreaView>
    );
  }
  if (cq.isError || !c) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Header />
        <StateView kind="error" title="Couldn't load promotion" actionLabel="Retry" onAction={() => cq.refetch()} />
      </SafeAreaView>
    );
  }

  const a = aq.data;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Header />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Status + window */}
        <View style={[s.card, shadow1]}>
          <View style={s.headerRow}>
            <Text style={s.headline} numberOfLines={2}>{c.subject_label ?? c.creative.headline}</Text>
            <StatusBadge state={c.state} />
          </View>
          <Text style={s.zone}>{c.zone_name ?? c.zone_code}</Text>
          {isLive ? (
            <View style={s.countdown}>
              <Icons.Clock size={14} color={Colors.secondary} strokeWidth={2} />
              <Text style={s.countdownText}>{countdownLabel(c.window_end)}</Text>
            </View>
          ) : null}
          {c.review_note ? <Text style={s.reviewNote}>{c.review_note}</Text> : null}
        </View>

        {/* Live analytics */}
        <Text style={s.sectionLabel}>Performance</Text>
        <View style={[s.card, shadow1]}>
          {aq.isLoading && !a ? (
            <StateView kind="loading" compact message="Loading analytics…" />
          ) : (
            <View style={s.statsRow}>
              <Stat icon="Eye" label="Impressions" value={(a?.impressions ?? 0).toLocaleString('en-NG')} />
              <Stat icon="MousePointerClick" label="Taps" value={(a?.taps ?? 0).toLocaleString('en-NG')} />
              <Stat icon="Percent" label="CTR" value={`${((a?.ctr ?? 0) * 100).toFixed(1)}%`} />
            </View>
          )}
          {a ? (
            <>
              <View style={s.divider} />
              <Row label="Spend so far" value={formatNaira(a.spend_kobo)} />
              <Row label="Days run" value={`${a.days_elapsed} of ${a.days_total}`} />
            </>
          ) : null}
        </View>

        {/* Booking details */}
        <Text style={s.sectionLabel}>Details</Text>
        <View style={[s.card, shadow1]}>
          <Row label="Run window" value={`${formatDate(c.window_start)} → ${formatDate(c.window_end)}`} />
          {c.quoted_price_kobo ? <Row label="Booked price" value={formatNaira(c.quoted_price_kobo)} /> : null}
          <Row label="CTA" value={c.creative.cta} />
        </View>

        {/* Lifecycle actions, gated by state */}
        <View style={s.actions}>
          {canPause(c.state) ? (
            <PrimaryButton label="Pause" variant="secondary" loading={pause.isPending} disabled={busy} onPress={() => pause.mutate(c.id)} />
          ) : null}
          {canResume(c.state) ? (
            <PrimaryButton label="Resume" loading={resume.isPending} disabled={busy} onPress={() => resume.mutate(c.id)} />
          ) : null}
          {canRenew(c.state) ? (
            <PrimaryButton label="Renew this promotion" loading={false} disabled={busy} onPress={() => router.push('/featured/new')} />
          ) : null}
          {canCancel(c.state) ? (
            <PrimaryButton label="Cancel promotion" variant="danger" loading={cancel.isPending} disabled={busy} onPress={() => cancel.mutate(c.id)} />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={s.topBar}>
      <Pressable onPress={() => goBack('/featured/promotions')} style={s.iconButton} accessibilityLabel="Go back">
        <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
      </Pressable>
      <Text style={s.topTitle}>Promotion</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={s.iconButton} />
        <HomeMenuButton />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  headline: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  zone: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  countdownText: { ...Typography.labelMd, color: Colors.secondary },
  reviewNote: { ...Typography.bodySm, color: Colors.onWarning, marginTop: Spacing.sm },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: 4, flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 4 },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, maxWidth: '60%', textAlign: 'right' },
  actions: { marginTop: Spacing.lg, gap: Spacing.sm },
});
