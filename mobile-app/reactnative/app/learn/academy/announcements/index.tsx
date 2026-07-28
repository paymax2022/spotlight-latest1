import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Megaphone, Pin, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useAnnouncements } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

/** C7 — Announcements: program & sponsor messages. */
export default function AnnouncementsScreen() {
  const ann = useAnnouncements();
  if (ann.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading announcements…" /></SafeAreaView>;

  const sorted = [...(ann.data ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcements" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {sorted.length ? sorted.map((a) => (
          <View key={a.id} style={[styles.card, shadow1, a.pinned && styles.pinned]}>
            <View style={styles.top}>
              <View style={[styles.icon, a.kind === 'sponsor' && { backgroundColor: Colors.iconBgTeal }]}>
                {a.kind === 'sponsor' ? <Gift size={18} color={Colors.teal} /> : <Megaphone size={18} color={Colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{a.title}</Text>
                  {a.pinned ? <Pin size={14} color={Colors.primary} /> : null}
                </View>
                <View style={styles.metaRow}>
                  <Chip label={a.kind === 'sponsor' ? (a.sponsor ?? 'Sponsor') : 'Program'} color={a.kind === 'sponsor' ? Colors.teal : Colors.secondary} bg={a.kind === 'sponsor' ? Colors.iconBgTeal : Colors.iconBgBlue} small />
                  <Text style={styles.date}>{formatDate(a.ts)}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.body}>{a.body}</Text>
          </View>
        )) : (
          <StateView kind="empty" icon="Megaphone" title="No announcements" message="Program and sponsor updates appear here." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8 },
  pinned: { borderWidth: 1, borderColor: Colors.outlineVariant },
  top: { flexDirection: 'row', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  date: { ...Typography.caption, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
