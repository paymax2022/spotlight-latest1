import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { HeartHandshake, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { formatNaira } from '@/features/academy/constants';
import { useSponsorships, usePledgeSponsorship } from '@/features/academy/fees/hooks';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import type { SponsorshipOpportunity } from '@/features/academy/fees/types';

/** PA-14 — Sponsor a student (extends academy scholarships). SF-7: first-name only. */
export default function SponsorAStudent() {
  const sponsorships = useSponsorships();
  const pledge = usePledgeSponsorship();

  if (sponsorships.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Sponsor a student" />
        <StateView kind="loading" message="Loading students…" />
      </SafeAreaView>
    );
  }

  const list = sponsorships.data ?? [];

  const onPledge = async (o: SponsorshipOpportunity) => {
    const doPledge = (naira: number) => {
      const kobo = Math.round(naira * 100);
      if (kobo <= 0) return;
      pledge.mutate(
        { opportunityId: o.id, amountKobo: kobo },
        {
          onSuccess: () => alertAsync({ title: 'Thank you', message: `Your ${formatNaira(kobo)} pledge to ${o.studentFirstName} is confirmed.` }),
          onError: (e) => alertAsync({ title: 'Could not pledge', message: (e as Error).message }),
        },
      );
    };
    if (Alert.prompt) {
      Alert.prompt('Sponsor ' + o.studentFirstName, 'Pledge amount (₦)', (v) => doPledge(parseFloat(v || '') || 0), 'plain-text', '5000', 'numeric');
    } else {
      // Android fallback: pledge a sensible default share.
      const ok = await confirmAsync({ title: 'Sponsor ' + o.studentFirstName, message: `Pledge ${formatNaira(500_000)} towards ${o.studentFirstName}'s fees?`, confirmLabel: 'Pledge' });
      if (ok) doPledge(5000);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Sponsor a student" subtitle="PA-14" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.intro, shadow1]}>
          <View style={styles.introIcon}><HeartHandshake size={22} color={Colors.primary} /></View>
          <Text style={styles.introText}>
            Help a verified student stay in school. Funds go straight to the school's fees account. To protect minors, only first names are shown.
          </Text>
        </View>

        {list.length ? list.map((o) => <SponsorCard key={o.id} o={o} onPledge={() => onPledge(o)} busy={pledge.isPending} />) : (
          <StateView kind="empty" icon="HeartHandshake" title="No students right now" message="Check back soon for students who need support." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SponsorCard({ o, onPledge, busy }: { o: SponsorshipOpportunity; onPledge: () => void; busy: boolean }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[o.icon] ?? Icons.GraduationCap;
  const pct = o.targetKobo > 0 ? Math.round((o.raisedKobo / o.targetKobo) * 100) : 0;
  const funded = o.raisedKobo >= o.targetKobo;
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.head}>
        <View style={styles.iconWrap}><Icon size={20} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{o.studentFirstName} · {o.classLabel}</Text>
          <Text style={styles.school}>{o.schoolName}</Text>
        </View>
        {o.sponsored ? <Chip label="You pledged" color={Colors.teal} bg={Colors.iconBgTeal} small /> : null}
      </View>
      <Text style={styles.story}>{o.story}</Text>

      <View style={styles.progressRow}>
        <Text style={styles.raised}>{formatNaira(o.raisedKobo)}</Text>
        <Text style={styles.target}>of {formatNaira(o.targetKobo)}</Text>
      </View>
      <ProgressBar pct={pct} color={funded ? Colors.teal : Colors.primary} style={{ marginTop: 4 }} />
      <View style={styles.footer}>
        <View style={styles.sponsors}><Users size={12} color={Colors.onSurfaceVariant} /><Text style={styles.sponsorsText}>{o.sponsorCount} sponsor{o.sponsorCount === 1 ? '' : 's'}</Text></View>
        {!funded ? (
          <Pressable style={styles.pledgeBtn} onPress={onPledge} disabled={busy}>
            <HeartHandshake size={15} color={Colors.onPrimary} /><Text style={styles.pledgeText}>Sponsor</Text>
          </Pressable>
        ) : (
          <Chip label="Fully funded" color={Colors.teal} bg={Colors.iconBgTeal} small />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  intro: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md },
  introIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest },
  introText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgGold },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  school: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  story: { ...Typography.bodyMd, color: Colors.onSurface },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  raised: { ...Typography.titleMd, color: Colors.primary },
  target: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  sponsors: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sponsorsText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pledgeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  pledgeText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
});
