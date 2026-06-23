import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Share2, ChevronRight, Plus, Inbox, MessagesSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useReferrals } from '@/features/doctor/hooks';
import { REFERRAL_STATUS_LABELS } from '@/features/doctor/constants';
import type { SpecialistReferral, ReferralStatus } from '@/types/doctor.phase2';

const STATUS_TONE: Record<ReferralStatus, StatusTone> = {
  draft:     'neutral',
  sent:      'info',
  accepted:  'brand',
  scheduled: 'warning',
  completed: 'success',
  declined:  'danger',
};

export default function ReferralsScreen() {
  const { data: referrals = [], isLoading, isError, refetch } = useReferrals();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Referrals"
        right={
          <Pressable onPress={() => router.push('/(doctor)/referrals/new')} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="New referral">
            <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {/* Section P — incoming inbox + opinion history entry points */}
      <View style={styles.tabs}>
        <Pressable style={styles.tab} onPress={() => router.push('/(doctor)/referrals/incoming')} accessibilityRole="button" accessibilityLabel="Incoming referrals">
          <Inbox size={16} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.tabText}>Incoming</Text>
        </Pressable>
        <Pressable style={styles.tab} onPress={() => router.push('/(doctor)/referrals/incoming?opinions=1')} accessibilityRole="button" accessibilityLabel="Opinion requests">
          <MessagesSquare size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.tabText}>Opinions</Text>
        </Pressable>
      </View>

      {isLoading && referrals.length === 0 ? (
        <StateView variant="loading" label="Loading referrals" />
      ) : isError ? (
        <StateView variant="error" message="We could not load referrals." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {referrals.length === 0 ? (
            <StateView variant="empty" icon={Share2} title="No referrals yet" message="Specialist referrals you create will appear here." />
          ) : (
            referrals.map((r) => <ReferralRow key={r.id} referral={r} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ReferralRow({ referral }: { referral: SpecialistReferral }) {
  const date = new Date(referral.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/(doctor)/referrals/${referral.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Referral ${referral.ref} for ${referral.patient.name}`}
    >
      <View style={[styles.icon, { backgroundColor: referral.specialist.avatarColor }]}>
        <Text style={styles.iconText}>{referral.specialist.initials}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{referral.specialist.specialty}</Text>
        <Text style={styles.meta} numberOfLines={1}>{referral.patient.name} · {referral.ref}</Text>
        <Text style={styles.meta} numberOfLines={1}>{referral.specialist.name} · {date}</Text>
      </View>
      <View style={styles.right}>
        <StatusBadge label={REFERRAL_STATUS_LABELS[referral.status]} tone={STATUS_TONE[referral.status]} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  addBtn:   { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  tabs:     { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  tab:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 44, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tabText:  { ...Typography.labelMd, color: Colors.onSurface },
  content:  { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  card:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  icon:     { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  iconText: { ...Typography.labelLg, color: Colors.white, fontWeight: '800' },
  body:     { flex: 1, gap: 2 },
  name:     { ...Typography.titleMd, color: Colors.onSurface },
  meta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:    { alignItems: 'flex-end', gap: Spacing.xs },
});
