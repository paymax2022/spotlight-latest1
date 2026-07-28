import React, { useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  MapPin, Heart, Calculator, FileText, ChevronDown, ChevronUp, AlertTriangle, Building2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useOffering, useToggleWatch } from '@/features/fractionalre/hooks';
import { useInvestDraft } from '@/features/fractionalre/store/investDraftStore';
import { KIND_LABEL, PAYOUT_FREQ_LABEL } from '@/features/fractionalre/constants';
import { formatNaira, formatYield, tenorLabel } from '@/features/fractionalre/utils';
import RiskBandPill from '@/features/fractionalre/components/RiskBandPill';
import TitleVerifiedBadge from '@/features/fractionalre/components/TitleVerifiedBadge';
import FundingProgressBar from '@/features/fractionalre/components/FundingProgressBar';
import OfferCountdown from '@/features/fractionalre/components/OfferCountdown';
import ReturnsCalculator from '@/features/fractionalre/components/ReturnsCalculator';
import CapTableMini from '@/features/fractionalre/components/CapTableMini';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';

export default function OfferingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offering = useOffering(id);
  const toggleWatch = useToggleWatch();
  const begin = useInvestDraft((s) => s.begin);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  if (offering.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Opportunity" />
        <StateView kind="loading" message="Loading opportunity…" />
      </SafeAreaView>
    );
  }
  const o = offering.data;
  if (!o) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Opportunity" />
        <StateView kind="error" title="Not found" message="This opportunity is unavailable." />
      </SafeAreaView>
    );
  }

  const closed = o.status === 'closed' || o.status === 'funded' || o.status === 'settled';

  const onInvest = () => {
    begin(o.id, o.unitPriceKobo);
    router.push(`/fractionalre/${o.id}/invest` as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={KIND_LABEL[o.kind]}
        rightSlot={
          <Pressable hitSlop={10} onPress={() => toggleWatch.mutate({ id: o.id, watched: o.watched })}>
            <Heart size={22} color={o.watched ? Colors.error : Colors.onSurface} fill={o.watched ? Colors.error : 'transparent'} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Image source={{ uri: o.coverImageUrl }} style={styles.cover} />

        <View style={styles.header}>
          <Text style={styles.title}>{o.title}</Text>
          <View style={styles.locRow}>
            <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.loc}>{o.location}</Text>
          </View>
          <View style={styles.badges}>
            <RiskBandPill band={o.riskBand} />
            <TitleVerifiedBadge verified={o.titleVerified} />
          </View>
        </View>

        {/* Key metrics */}
        <View style={styles.metricCard}>
          <Metric label="Proj. yield" value={`${formatYield(o.projectedYieldBps)} p.a.`} />
          <Metric label="Tenor" value={tenorLabel(o.tenorMonths)} />
          <Metric label="Per unit" value={formatNaira(o.unitPriceKobo)} />
          <Metric label="Payouts" value={PAYOUT_FREQ_LABEL[o.payoutFrequency]} />
        </View>

        {/* Funding + countdown */}
        <Section title="Funding">
          <FundingProgressBar raisedKobo={o.raisedKobo} targetKobo={o.targetKobo} />
          <View style={styles.fundRow}>
            <Text style={styles.fundMeta}>Min {o.minUnits} unit{o.minUnits > 1 ? 's' : ''}</Text>
            <OfferCountdown closesAt={o.closesAt} inline />
          </View>
        </Section>

        {/* Returns + calculator entry */}
        <Section title="Returns">
          <ReturnsCalculator offering={o} editable={false} />
          <Pressable style={styles.calcBtn} onPress={() => router.push(`/fractionalre/${o.id}/calculator` as never)}>
            <Calculator size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.calcBtnText}>Open full calculator</Text>
          </Pressable>
        </Section>

        {/* Asset */}
        <Section title="The asset">
          <Text style={styles.body}>{o.summary}</Text>
          <View style={styles.assetMeta}>
            <Building2 size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.assetMetaText}>{o.assetDescription}</Text>
          </View>
          <Text style={styles.sponsor}>Sponsor: {o.sponsor} · Held in {o.spvName}</Text>
        </Section>

        {/* Cap table */}
        <Section title="Capital structure">
          <CapTableMini slices={o.capTable} />
        </Section>

        {/* Risk */}
        <Section title="Risk factors">
          {o.riskFactors.map((r) => (
            <View key={r} style={styles.riskRow}>
              <AlertTriangle size={14} color={Colors.onWarning} strokeWidth={2} />
              <Text style={styles.body}>{r}</Text>
            </View>
          ))}
          <RiskRibbon compact />
        </Section>

        {/* Documents */}
        <Section title="Documents">
          {o.documents.map((d) => (
            <View key={d.id} style={styles.docRow}>
              <FileText size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.docLabel} numberOfLines={1}>{d.label}</Text>
              <Text style={styles.docSize}>{d.sizeKb} KB</Text>
            </View>
          ))}
        </Section>

        {/* FAQ */}
        <Section title="FAQ">
          {o.faq.map((f, i) => {
            const open = faqOpen === i;
            return (
              <Pressable key={f.q} style={styles.faqItem} onPress={() => setFaqOpen(open ? null : i)}>
                <View style={styles.faqHeader}>
                  <Text style={styles.faqQ}>{f.q}</Text>
                  {open ? <ChevronUp size={18} color={Colors.onSurfaceVariant} /> : <ChevronDown size={18} color={Colors.onSurfaceVariant} />}
                </View>
                {open ? <Text style={styles.faqA}>{f.a}</Text> : null}
              </Pressable>
            );
          })}
        </Section>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={closed ? 'Funding closed' : 'Invest'} onPress={onInvest} disabled={closed} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricVal}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xl, gap: Spacing.md },
  cover: { width: '100%', height: 210, backgroundColor: Colors.surfaceContainerHigh },
  header: { paddingHorizontal: Spacing.containerMargin, gap: 6 },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  badges: { flexDirection: 'row', gap: 8, marginTop: 4 },
  metricCard: {
    flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md,
  },
  metric: { width: '45%' },
  metricVal: { ...Typography.titleMd, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  fundRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fundMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, lineHeight: 22 },
  calcBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm },
  calcBtnText: { ...Typography.labelLg, color: Colors.secondary },
  assetMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  assetMetaText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  sponsor: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  riskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  docRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  docLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  docSize: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  faqItem: { borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant, paddingVertical: Spacing.sm },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  faqQ: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  faqA: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 6, lineHeight: 20 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
