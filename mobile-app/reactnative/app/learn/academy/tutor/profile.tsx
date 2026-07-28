import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Star, ShieldCheck, CalendarClock, BookOpen, Wrench } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatNaira } from '@/features/academy/constants';
import { useTutorMe } from '@/features/academy/hooks';

const COLOR_KEY = (k: string) => (Colors as unknown as Record<string, string>)[k] ?? Colors.iconBgPurple;

/** T2 — Tutor profile: bio, ratings, availability (read view of the public card). */
export default function TutorProfile() {
  const me = useTutorMe();
  if (me.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading profile…" /></SafeAreaView>;
  if (me.isError || !me.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Profile" /><StateView kind="error" title="Could not load profile" /></SafeAreaView>;

  const t = me.data;
  const verified = t.verifyState === 'verified';
  const initials = t.displayName.split(' ').map((w) => w[0]).slice(0, 2).join('');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My tutor profile" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Identity card */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.idRow}>
            <View style={[styles.avatar, { backgroundColor: COLOR_KEY(t.avatarColorKey) }]}><Text style={styles.avatarText}>{initials}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.displayName}</Text>
              <View style={styles.ratingRow}>
                <Star size={14} color={Colors.gold} fill={Colors.gold} />
                <Text style={styles.ratingText}>{t.rating.toFixed(1)} · {t.ratingCount} reviews</Text>
              </View>
            </View>
          </View>
          <View style={styles.tagRow}>
            <Chip label={verified ? 'Verified tutor' : 'KYC pending'} color={verified ? Colors.teal : Colors.onWarning} bg={verified ? Colors.iconBgTeal : Colors.iconBgGold} small />
            <Chip label={`${formatNaira(t.hourlyRateKobo)}/hr`} color={Colors.secondary} bg={Colors.iconBgBlue} small />
          </View>
        </View>

        {/* Bio */}
        <Text style={styles.section}>About</Text>
        <View style={[styles.card, shadow1]}><Text style={styles.bio}>{t.bio}</Text></View>

        {/* Subjects */}
        <View style={styles.sectionRow}><BookOpen size={16} color={Colors.onSurfaceVariant} /><Text style={styles.section}>Subjects</Text></View>
        <View style={styles.chipsWrap}>
          {t.subjects.map((s) => <Chip key={s} label={s} color={Colors.onSurface} bg={Colors.surfaceContainerHigh} small />)}
        </View>

        {/* Trades (optional) */}
        {t.trades.length ? (
          <>
            <View style={styles.sectionRow}><Wrench size={16} color={Colors.onSurfaceVariant} /><Text style={styles.section}>Trades</Text></View>
            <View style={styles.chipsWrap}>{t.trades.map((s) => <Chip key={s} label={s} color={Colors.onSurface} bg={Colors.surfaceContainerHigh} small />)}</View>
          </>
        ) : null}

        {/* Availability */}
        <View style={styles.sectionRow}><CalendarClock size={16} color={Colors.onSurfaceVariant} /><Text style={styles.section}>Availability</Text></View>
        <View style={[styles.card, shadow1]}>
          {t.availability.length ? t.availability.map((a, i) => (
            <View key={a} style={[styles.slotRow, i > 0 && styles.slotDivider]}><Text style={styles.slotText}>{a}</Text></View>
          )) : <Text style={styles.empty}>No slots set yet.</Text>}
        </View>

        <View style={[styles.verifiedNote]}>
          <ShieldCheck size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.verifiedText}>This is how learners see your profile in the tutor marketplace.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  tagRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.md },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  bio: { ...Typography.bodyMd, color: Colors.onSurface },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  slotRow: { paddingVertical: Spacing.sm },
  slotDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  slotText: { ...Typography.bodyMd, color: Colors.onSurface },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  verifiedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  verifiedText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
});
