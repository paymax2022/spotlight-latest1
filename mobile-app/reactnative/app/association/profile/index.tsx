import React from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Pencil, ShieldCheck, History, ChevronRight, Check, CheckCircle2, Phone, Mail, Briefcase, Heart, Users, Settings, LifeBuoy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMyProfile, usePrivacy } from '@/features/association/hooks/useProfile';
import { computeCompletion } from '@/features/association/api/profile.api';
import { initials } from '@/features/association/utils/associationFormatters';

export default function ProfileDashboard() {
  const profile = useMyProfile();
  const privacy = usePrivacy();

  if (profile.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My profile" />
        <StateView kind="loading" message="Loading profile…" />
      </SafeAreaView>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My profile" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => profile.refetch()} />
      </SafeAreaView>
    );
  }

  const p = profile.data;
  const completion = computeCompletion(p, privacy.data ?? { showPhone: false, showEmail: true, showInDirectory: true, showProfession: true });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My profile"
        rightSlot={
          <Pressable onPress={() => router.push('/association/profile/edit')} hitSlop={8} accessibilityLabel="Edit profile">
            <Pencil size={18} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {p.photoUrl ? <Image source={{ uri: p.photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials(p.fullName)}</Text>}
          </View>
          <Text style={styles.name}>{p.fullName}</Text>
          <Text style={styles.memberId}>{p.memberId}</Text>
          <Text style={styles.meta}>{p.categoryLabel}{p.chapterName ? ` · ${p.chapterName}` : ''}</Text>
        </View>

        {/* Completion */}
        {completion.percent < 100 ? (
          <View style={[styles.completionCard, shadow1]}>
            <View style={styles.completionHead}>
              <Text style={styles.completionTitle}>Profile {completion.percent}% complete</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${completion.percent}%` }]} />
            </View>
            {completion.items.filter((i) => !i.done).slice(0, 3).map((i) => (
              <Pressable key={i.key} style={styles.todoRow} onPress={() => router.push('/association/profile/edit')}>
                <View style={styles.todoDot} />
                <Text style={styles.todoText}>{i.label}</Text>
                <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={[styles.completeBanner, shadow1]}>
            <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.completeText}>Your profile is complete</Text>
          </View>
        )}

        {/* Detail */}
        <View style={[styles.card, shadow1]}>
          <Detail icon={<Phone size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Phone" value={p.phone} />
          <Detail icon={<Mail size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Email" value={p.email} />
          <Detail icon={<Briefcase size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Profession" value={p.profession} />
          <Detail icon={<Heart size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Emergency" value={`${p.emergency.name} · ${p.emergency.phone}`} />
          <Detail icon={<Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Next of kin" value={`${p.nextOfKin.name} (${p.nextOfKin.relationship})`} />
        </View>

        {/* Links */}
        <LinkRow icon={<ShieldCheck size={18} color={Colors.primary} strokeWidth={2} />} label="Privacy settings" onPress={() => router.push('/association/profile/privacy')} />
        <LinkRow icon={<History size={18} color={Colors.primary} strokeWidth={2} />} label="Activity history" onPress={() => router.push('/association/profile/activity')} />
        <LinkRow icon={<Check size={18} color={Colors.primary} strokeWidth={2} />} label="View public profile" onPress={() => router.push('/association/member/m1')} />
        <LinkRow icon={<LifeBuoy size={18} color={Colors.primary} strokeWidth={2} />} label="Help & support" onPress={() => router.push('/association/support')} />
        <LinkRow icon={<Settings size={18} color={Colors.primary} strokeWidth={2} />} label="Settings" onPress={() => router.push('/association/settings')} />
      </ScrollView>
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

function LinkRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.linkRow, shadow1]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.linkIcon}>{icon}</View>
      <Text style={styles.linkLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
  identity: { alignItems: 'center', gap: 4, paddingTop: Spacing.sm },
  avatar: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.headlineMd, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  memberId: { ...Typography.labelMd, color: Colors.onSurfaceVariant, letterSpacing: 0.5 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  completionCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  completionHead: { flexDirection: 'row', justifyContent: 'space-between' },
  completionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  progressTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  todoDot: { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: Colors.gold },
  todoText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  completeBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  completeText: { ...Typography.labelMd, color: Colors.teal },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  detailLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 92 },
  detailValue: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  linkIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
