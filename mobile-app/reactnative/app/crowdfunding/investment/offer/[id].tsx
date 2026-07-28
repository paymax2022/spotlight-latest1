import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, BadgeCheck, AlertTriangle, FileText, TrendingUp, Lock, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useOffer } from '@/features/crowdfunding/hooks/useInvestment';
import { formatNaira, formatNairaCompact, progressPct } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function OfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: o, isLoading, isError, refetch } = useOffer(id);

  if (isLoading) return <SafeAreaView style={styles.safe}><StateView kind="loading" /></SafeAreaView>;
  if (isError || !o) return <SafeAreaView style={styles.safe}><StateView kind="error" title="Offer not found" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  const pct = progressPct(o.raisedKobo, o.targetKobo);
  const open = o.status === 'OPEN' || o.status === 'CLOSING_SOON';

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.cover}>
          {o.coverImage ? <Image source={{ uri: o.coverImage }} style={styles.coverImg} resizeMode="cover" /> : <View style={[styles.coverImg, styles.coverPlaceholder]} />}
          <SafeAreaView edges={['top']} style={styles.coverBar}>
            <Pressable onPress={() => router.back()} style={styles.circleBtn} accessibilityLabel="Go back"><ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} /></Pressable>
          </SafeAreaView>
        </View>

        <View style={styles.container}>
          <View style={styles.metaRow}>
            <Text style={styles.model}>{o.model.replace('_', ' ')}</Text>
            {o.issuerVerified && <View style={styles.verified}><BadgeCheck size={13} color={Colors.secondary} strokeWidth={2.2} /><Text style={styles.verifiedText}>Verified issuer</Text></View>}
          </View>
          <Text style={styles.title}>{o.title}</Text>
          <Text style={styles.issuer}>{o.issuerName} · {o.sector} · {o.location}</Text>
          <Text style={styles.summary}>{o.summary}</Text>

          {/* Progress */}
          <View style={styles.card}>
            <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
            <View style={styles.progRow}>
              <Text style={styles.raised}>{formatNaira(o.raisedKobo)}</Text>
              <Text style={styles.pct}>{pct}%</Text>
            </View>
            <Text style={styles.goal}>of {formatNaira(o.targetKobo)} · {o.investorCount} investors</Text>
          </View>

          {/* Terms */}
          <View style={styles.termsGrid}>
            <Term icon={<TrendingUp size={15} color={Colors.tertiaryContainer} strokeWidth={2} />} label="Projected return" value={`${o.projectedReturnPct}%`} />
            <Term icon={<Clock size={15} color={Colors.secondary} strokeWidth={2} />} label="Term" value={`${o.termMonths} months`} />
            <Term icon={<Lock size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Lock-in" value={`${o.lockInMonths} months`} />
            <Term icon={<AlertTriangle size={15} color={o.riskLevel === 'HIGH' ? Colors.error : '#B65A00'} strokeWidth={2} />} label="Risk" value={o.riskLevel} />
          </View>

          {/* Risk warnings */}
          <View style={styles.riskCard}>
            <View style={styles.riskHead}><AlertTriangle size={16} color={Colors.error} strokeWidth={2} /><Text style={styles.riskTitle}>Risk warnings</Text></View>
            {o.riskWarnings.map((w, i) => <Text key={i} style={styles.riskItem}>•  {w}</Text>)}
          </View>

          {/* Offer document */}
          <Pressable style={styles.docRow} accessibilityRole="button">
            <FileText size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.docText}>{o.offerDocumentLabel}</Text>
            <Text style={styles.docOpen}>Open</Text>
          </Pressable>

          {/* Use of proceeds */}
          <Text style={styles.sectionTitle}>Use of proceeds</Text>
          {o.useOfProceeds.map((u) => (
            <View key={u.label} style={styles.useRow}>
              <Text style={styles.useLabel}>{u.label}</Text>
              <Text style={styles.useAmount}>{formatNairaCompact(u.amountKobo)}</Text>
            </View>
          ))}

          <Text style={styles.cooling}>A {o.coolingOffDays}-day cooling-off period applies after you invest.</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.ctaBar}>
        {open ? (
          <PrimaryButton label={`Invest · min ${formatNairaCompact(o.minTicketKobo)}`} onPress={() => router.push(`/crowdfunding/investment/invest/${o.id}`)} />
        ) : (
          <PrimaryButton label="This offer is closed" onPress={() => {}} disabled />
        )}
      </SafeAreaView>
    </View>
  );
}

function Term({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.term}>
      <View style={styles.termHead}>{icon}<Text style={styles.termLabel}>{label}</Text></View>
      <Text style={styles.termValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 110 },
  cover: { height: 220, backgroundColor: Colors.surfaceContainerHigh },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: { backgroundColor: Colors.surfaceContainerHigh },
  coverBar: { position: 'absolute', top: 0, left: Spacing.containerMargin, paddingTop: Spacing.sm },
  circleBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 2 },
  model: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  verifiedText: { ...Typography.caption, color: Colors.secondary, fontWeight: '600' as const },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  issuer: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: 2 },
  summary: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.md },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  progRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: Spacing.sm },
  raised: { ...Typography.titleLg, color: Colors.onSurface },
  pct: { ...Typography.labelMd, color: Colors.teal },
  goal: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  termsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  term: { width: '47.5%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  termHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  termLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  termValue: { ...Typography.titleMd, color: Colors.onSurface },
  riskCard: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md, gap: 4 },
  riskHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  riskTitle: { ...Typography.labelMd, color: Colors.error },
  riskItem: { ...Typography.bodySm, color: Colors.onSurface },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  docText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  docOpen: { ...Typography.labelMd, color: Colors.secondary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  useRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  useLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  useAmount: { ...Typography.labelMd, color: Colors.onSurface },
  cooling: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
  ctaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.96)', borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
});
