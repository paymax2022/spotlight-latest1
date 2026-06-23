import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, BadgeCheck, HandCoins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMatchableCampaign } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira, progressPct } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CsrCampaignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useMatchableCampaign(id);

  if (isLoading) return <SafeAreaView style={styles.safe}><StateView kind="loading" /></SafeAreaView>;
  if (isError || !c) return <SafeAreaView style={styles.safe}><StateView kind="error" title="Campaign not found" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  const pct = progressPct(c.raisedKobo, c.goalKobo);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.cover}>
          {c.coverImage ? <Image source={{ uri: c.coverImage }} style={styles.coverImg} resizeMode="cover" /> : <View style={[styles.coverImg, styles.coverPlaceholder]} />}
          <SafeAreaView edges={['top']} style={styles.coverBar}>
            <Pressable onPress={() => router.back()} style={styles.circleBtn} accessibilityLabel="Go back"><ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} /></Pressable>
          </SafeAreaView>
        </View>
        <View style={styles.container}>
          <View style={styles.tagRow}>
            <Text style={styles.tag}>{c.impactTag} · {c.category}</Text>
            {c.verified && <View style={styles.verified}><BadgeCheck size={13} color={Colors.secondary} strokeWidth={2.2} /><Text style={styles.verifiedText}>Verified</Text></View>}
          </View>
          <Text style={styles.title}>{c.title}</Text>

          <View style={styles.card}>
            <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
            <View style={styles.progRow}><Text style={styles.raised}>{formatNaira(c.raisedKobo)}</Text><Text style={styles.pct}>{pct}%</Text></View>
            <Text style={styles.goal}>of {formatNaira(c.goalKobo)} · {c.contributorCount.toLocaleString('en-NG')} backers</Text>
          </View>

          <View style={styles.matchInfo}>
            <HandCoins size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.matchInfoText}>Set up a corporate match to multiply every contribution to this campaign, up to a cap you choose.</Text>
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.ctaBar}>
        <PrimaryButton label="Set up matching" onPress={() => router.push(`/crowdfunding/csr/match/${c.id}`)} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 100 },
  cover: { height: 200, backgroundColor: Colors.surfaceContainerHigh },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: { backgroundColor: Colors.surfaceContainerHigh },
  coverBar: { position: 'absolute', top: 0, left: Spacing.containerMargin, paddingTop: Spacing.sm },
  circleBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  tag: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  verifiedText: { ...Typography.caption, color: Colors.secondary, fontWeight: '600' as const },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.md },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  progRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: Spacing.sm },
  raised: { ...Typography.titleLg, color: Colors.onSurface },
  pct: { ...Typography.labelMd, color: Colors.teal },
  goal: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  matchInfo: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  matchInfoText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  ctaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.96)', borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
});
