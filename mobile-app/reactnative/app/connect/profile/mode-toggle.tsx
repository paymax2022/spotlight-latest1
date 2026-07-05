import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Heart,
  Briefcase,
  Eye,
  Pencil,
  Image as ImageIcon,
  Lock,
  BadgeCheck,
  ChevronRight,
  Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useUnifiedProfile, useSetModeVisibility } from '@/features/connect/profile/hooks';
import type { ConnectMode, ModeProfile } from '@/features/connect/profile/types';

// PR-01 — Per-mode profile hub. Date (romantic) and Network (professional) are
// SEPARATE profiles with their own visibility wall and intent. This screen never
// blends the two — it switches between them.
const MODE_OPTIONS: { value: ConnectMode; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'network', label: 'Network' },
];

export default function ModeToggle() {
  const [mode, setMode] = useState<ConnectMode>('date');
  const { data, isLoading, error, refetch } = useUnifiedProfile();
  const setVisibility = useSetModeVisibility();

  const profile: ModeProfile | undefined =
    mode === 'date' ? data?.dateProfile : data?.networkProfile;
  const modeLabel = mode === 'date' ? 'Date' : 'Network';
  const ModeIcon = mode === 'date' ? Heart : Briefcase;

  const rows: { key: string; label: string; icon: React.ReactNode; onPress: () => void }[] = [
    {
      key: 'view',
      label: 'Preview as others see it',
      icon: <Eye size={20} color={Colors.primary} strokeWidth={2} />,
      onPress: () => router.push(`/connect/profile/view?mode=${mode}`),
    },
    {
      key: 'edit',
      label: 'Edit profile',
      icon: <Pencil size={20} color={Colors.primary} strokeWidth={2} />,
      onPress: () => router.push(`/connect/profile/edit?mode=${mode}`),
    },
    {
      key: 'photos',
      label: 'Photos',
      icon: <ImageIcon size={20} color={Colors.primary} strokeWidth={2} />,
      onPress: () => router.push(`/connect/profile/photos?mode=${mode}`),
    },
    {
      key: 'privacy',
      label: 'Privacy & visibility',
      icon: <Lock size={20} color={Colors.primary} strokeWidth={2} />,
      onPress: () => router.push('/connect/profile/privacy'),
    },
    {
      key: 'badges',
      label: 'Verification badges',
      icon: <BadgeCheck size={20} color={Colors.primary} strokeWidth={2} />,
      onPress: () => router.push('/connect/profile/badges'),
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your profile" />

      {isLoading ? (
        <StateView kind="loading" message="Loading your profile…" />
      ) : error || !data || !profile ? (
        <StateView
          kind="error"
          title="Couldn't load your profile"
          message="Check your connection and try again."
          icon="UserX"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.segmentWrap}>
            <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
          </View>

          <View style={styles.infoRow}>
            <Users size={14} color={ConnectColors.muted} strokeWidth={2} />
            <Text style={styles.infoText}>
              Your Date and Network profiles are separate. People only ever see the
              one for the mode they found you in.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.modeBadge}>
                <ModeIcon size={15} color={ConnectColors.brand} strokeWidth={2.2} />
                <Text style={styles.modeBadgeText}>{modeLabel} profile</Text>
              </View>
            </View>

            <ToggleRow
              label={`Visible in ${modeLabel}`}
              sub={
                profile.visible
                  ? `Discoverable in ${modeLabel}`
                  : `Hidden — you won't appear in ${modeLabel}`
              }
              value={profile.visible}
              onValueChange={(v) => setVisibility.mutate({ mode, visible: v })}
              disabled={setVisibility.isPending}
              divider
            />

            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Headline</Text>
              <Text style={styles.metaValue}>{profile.headline || 'Not set yet'}</Text>
              <Text style={[styles.metaLabel, styles.metaLabelSpaced]}>
                {mode === 'date' ? 'Looking for' : 'Here to'}
              </Text>
              <View style={styles.intentPill}>
                <Text style={styles.intentText}>{profile.intent}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.group}>Manage {modeLabel.toLowerCase()} profile</Text>
          <View style={styles.linksCard}>
            {rows.map((row, i) => (
              <Pressable
                key={row.key}
                style={[styles.linkRow, i < rows.length - 1 && styles.linkDivider]}
                onPress={row.onPress}
              >
                <View style={styles.linkIcon}>{row.icon}</View>
                <Text style={styles.linkLabel}>{row.label}</Text>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingBottom: 60 },
  segmentWrap: { marginTop: Spacing.sm },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.md,
  },
  infoText: { ...Typography.labelSm, color: ConnectColors.muted, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.iconBgPurple,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  modeBadgeText: { ...Typography.labelSm, color: ConnectColors.brand, fontWeight: '700' },
  metaBlock: { paddingTop: Spacing.sm },
  metaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaLabelSpaced: { marginTop: Spacing.md },
  metaValue: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  intentPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.iconBgBlue,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.full,
    marginTop: Spacing.xs,
  },
  intentText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' },
  group: {
    ...Typography.labelMd,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginHorizontal: Spacing.containerMargin,
  },
  linksCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginHorizontal: Spacing.containerMargin,
    paddingHorizontal: Spacing.md,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  linkDivider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  linkIcon: { width: 24, alignItems: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
