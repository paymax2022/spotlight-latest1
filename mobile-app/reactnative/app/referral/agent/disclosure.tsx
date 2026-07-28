import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, Check, Percent, CircleDollarSign, Layers } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira } from '@/features/referral/constants/format';
import { useAgentDisclosure, useAcceptAgentDisclosure } from '@/features/referral/agent/hooks';

// M-AGT-07 — Agent earnings disclosure: caps, activity-based terms, compliance.
// This is the load-bearing pyramid-line disclosure for agents (PRD §7, §10).
export default function AgentDisclosureScreen() {
  const { data, isLoading, isError, refetch } = useAgentDisclosure();
  const accept = useAcceptAgentDisclosure();
  const accepted = data?.accepted || accept.data?.ok;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings disclosure" />
      {isLoading ? (
        <StateView kind="loading" message="Loading disclosure…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Banner */}
          <View style={styles.banner}>
            <View style={styles.bannerIcon}><ShieldCheck size={24} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
            <Text style={styles.bannerTitle}>Activity-based earnings only</Text>
            <Text style={styles.bannerBody}>You earn from your network's verified activity — never for recruiting people. Read and accept these terms before earning overrides.</Text>
          </View>

          {/* Key figures */}
          <View style={styles.figures}>
            <View style={styles.figure}>
              <View style={styles.figIcon}><Percent size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <Text style={styles.figValue}>{Math.round(data.overrideRate * 100)}%</Text>
              <Text style={styles.figLabel}>of verified activity</Text>
            </View>
            <View style={styles.figure}>
              <View style={styles.figIcon}><CircleDollarSign size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <Text style={styles.figValue}>{formatNaira(data.capKobo)}</Text>
              <Text style={styles.figLabel}>cap per period</Text>
            </View>
            <View style={styles.figure}>
              <View style={styles.figIcon}><Layers size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <Text style={styles.figValue}>{data.maxDepth} level</Text>
              <Text style={styles.figLabel}>max depth</Text>
            </View>
          </View>

          {/* Terms */}
          <Text style={styles.sectionTitle}>The terms</Text>
          <View style={styles.terms}>
            {data.points.map((p, i) => (
              <View key={i} style={[styles.term, i < data.points.length - 1 && styles.termBorder]}>
                <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} style={styles.termCheck} />
                <Text style={styles.termText}>{p}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.version}>Disclosure version {data.version}</Text>

          {accepted ? (
            <View style={styles.acceptedBox}>
              <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.4} />
              <Text style={styles.acceptedText}>You've accepted these terms.</Text>
            </View>
          ) : (
            <PrimaryButton label="I understand and accept" onPress={() => accept.mutate(data.version)} loading={accept.isPending} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  banner: { alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  bannerIcon: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  bannerBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  figures: { flexDirection: 'row', gap: Spacing.sm },
  figure: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md, paddingHorizontal: 4 },
  figIcon: { width: 34, height: 34, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  figValue: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '800' as const, textAlign: 'center' },
  figLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  terms: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  term: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.md },
  termBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  termCheck: { marginTop: 2 },
  termText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  version: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  acceptedBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, paddingVertical: Spacing.md },
  acceptedText: { ...Typography.labelLg, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
