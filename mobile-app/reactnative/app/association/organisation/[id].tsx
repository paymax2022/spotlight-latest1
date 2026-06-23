import React from 'react';
import { View, Text, ScrollView, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Users, GitBranch, BadgeCheck, CalendarDays, Globe, ShieldCheck, ListChecks, Layers,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useOrganisation } from '@/features/association/hooks/useAssociation';
import { formatCount, formatNaira, initials } from '@/features/association/utils/associationFormatters';
import { GROUP_TYPE_LABEL } from '@/features/association/constants/association.constants';

export default function OrganisationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const org = useOrganisation(id);

  if (org.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Organisation" />
        <StateView kind="loading" message="Loading organisation…" />
      </SafeAreaView>
    );
  }
  if (org.isError || !org.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Organisation" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => org.refetch()} />
      </SafeAreaView>
    );
  }

  const o = org.data;
  const ctaLabel = o.requiresPayment ? `Join · ${formatNaira(o.registrationFeeKobo)}` : 'Join organisation';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Organisation" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Cover + identity */}
        {o.coverUrl ? <Image source={{ uri: o.coverUrl }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]} />}
        <View style={styles.identity}>
          <View style={styles.logo}>
            {o.logoUrl ? <Image source={{ uri: o.logoUrl }} style={styles.logoImg} /> : <Text style={styles.logoText}>{o.acronym ?? initials(o.name)}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={2}>{o.name}</Text>
              {o.verified && <BadgeCheck size={18} color={Colors.secondary} strokeWidth={2.2} />}
            </View>
            <Text style={styles.category}>{o.category}{o.location ? ` · ${o.location}` : ''}</Text>
          </View>
        </View>

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <Stat icon={<Users size={16} color={Colors.primary} strokeWidth={2} />} label={formatCount(o.memberCount, 'members')} />
          <Stat icon={<GitBranch size={16} color={Colors.primary} strokeWidth={2} />} label={formatCount(o.chapterCount, 'chapters')} />
          {o.foundedYear ? <Stat icon={<CalendarDays size={16} color={Colors.primary} strokeWidth={2} />} label={`Est. ${o.foundedYear}`} /> : null}
        </View>

        {/* Group type */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}>
            <ShieldCheck size={16} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.cardTitle}>{GROUP_TYPE_LABEL[o.groupType]}</Text>
          </View>
          <Text style={styles.body}>{o.approvalSummary}</Text>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.body}>{o.description}</Text>

        {/* Membership categories */}
        <Text style={styles.sectionTitle}>Membership categories</Text>
        <View style={styles.gap8}>
          {o.membershipCategories.map((c) => (
            <View key={c.id} style={[styles.rowCard, shadow1]}>
              <Layers size={16} color={Colors.secondary} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.label}</Text>
                {c.description ? <Text style={styles.rowSub}>{c.description}</Text> : null}
              </View>
              <Text style={styles.rowAmount}>{c.duesKobo === 0 ? 'Free' : formatNaira(c.duesKobo)}</Text>
            </View>
          ))}
        </View>

        {/* Requirements */}
        <Text style={styles.sectionTitle}>What you’ll need</Text>
        <View style={styles.gap8}>
          {o.requirements.map((r) => (
            <View key={r.id} style={styles.reqRow}>
              <ListChecks size={15} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.reqText}>{r.label}{r.required ? '' : ' (optional)'}</Text>
            </View>
          ))}
        </View>

        {o.website ? (
          <View style={[styles.reqRow, { marginTop: Spacing.md }]}>
            <Globe size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={[styles.reqText, { color: Colors.secondary }]}>{o.website.replace(/^https?:\/\//, '')}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky join CTA */}
      <View style={styles.footer}>
        <PrimaryButton label={ctaLabel} onPress={() => router.push(`/association/join/${o.id}`)} />
      </View>
    </SafeAreaView>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120 },
  cover: { width: '100%', height: 140 },
  coverFallback: { backgroundColor: Colors.surfaceContainerHigh },
  identity: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'center',
    paddingHorizontal: Spacing.containerMargin, marginTop: -28,
  },
  logo: {
    width: 64, height: 64, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 2, borderColor: Colors.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...shadow1,
  },
  logoImg: { width: '100%', height: '100%' },
  logoText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...Typography.titleLg, color: Colors.onSurface, flexShrink: 1 },
  category: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  stat: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  statText: { ...Typography.labelSm, color: Colors.onSurface },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant,
    padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, gap: 6,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin },
  gap8: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowAmount: { ...Typography.labelMd, color: Colors.primary },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  reqText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
});
