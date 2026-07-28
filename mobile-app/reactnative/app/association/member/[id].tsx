import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Phone, Mail, MapPin, Briefcase, CalendarDays, Users, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MembershipStatusBadge, { PaymentStandingBadge } from '@/features/association/components/MembershipStatusBadge';
import { useMember } from '@/features/association/hooks/useAssociation';
import { initials, formatDate } from '@/features/association/utils/associationFormatters';

export default function MemberDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const member = useMember(id);

  if (member.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Member" />
        <StateView kind="loading" message="Loading profile…" />
      </SafeAreaView>
    );
  }
  if (member.isError || !member.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Member" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => member.refetch()} />
      </SafeAreaView>
    );
  }

  const m = member.data;
  const canContact = !m.contactRestricted && (m.phone || m.email);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Member profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {m.photoUrl ? <Image source={{ uri: m.photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials(m.fullName)}</Text>}
          </View>
          <Text style={styles.name}>{m.fullName}</Text>
          <Text style={styles.memberId}>{m.memberId}</Text>
          <View style={styles.badgeRow}>
            <MembershipStatusBadge status={m.status} />
            <PaymentStandingBadge standing={m.paymentStanding} />
          </View>
        </View>

        {/* Detail rows */}
        <View style={[styles.card, shadow1]}>
          <Detail icon={<Briefcase size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Profession" value={m.profession ?? '—'} />
          <Detail icon={<Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Category" value={m.categoryLabel} />
          {m.chapterName ? <Detail icon={<MapPin size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Chapter" value={m.chapterName} /> : null}
          <Detail icon={<CalendarDays size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Member since" value={formatDate(m.joinedAt)} />
        </View>

        {/* Committees */}
        {m.committees.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Committees</Text>
            <View style={styles.chipRow}>
              {m.committees.map((c) => (
                <View key={c} style={styles.committeeChip}><Text style={styles.committeeText}>{c}</Text></View>
              ))}
            </View>
          </>
        ) : null}

        {/* Bio */}
        {m.bio ? (
          <>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bio}>{m.bio}</Text>
          </>
        ) : null}

        {/* Contact / privacy */}
        {m.contactRestricted ? (
          <View style={styles.privacyCard}>
            <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.privacyText}>This member has restricted their contact details.</Text>
          </View>
        ) : null}
      </ScrollView>

      {canContact ? (
        <View style={styles.footer}>
          {m.phone ? (
            <PrimaryButton label="Call" variant="secondary" fullWidth={false} style={styles.footerBtn}
              onPress={() => Linking.openURL(`tel:${m.phone}`)} />
          ) : null}
          {m.email ? (
            <PrimaryButton label="Email" fullWidth={false} style={styles.footerBtn}
              onPress={() => Linking.openURL(`mailto:${m.email}`)} />
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      {icon}
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
  identity: { alignItems: 'center', gap: 6, paddingTop: Spacing.sm },
  avatar: {
    width: 88, height: 88, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.headlineMd, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  memberId: { ...Typography.labelMd, color: Colors.onSurfaceVariant, letterSpacing: 0.5 },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  detailLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 96 },
  detailValue: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  committeeChip: { backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  committeeText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '600' as const },
  bio: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  privacyCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  privacyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  footerBtn: { flex: 1 },
});
