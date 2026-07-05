import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useTradeTracks } from '@/features/academy/hooks';

/** A11/S1 — Trade selection: pick or switch your trade. */
export default function TradeTracksScreen() {
  const tracks = useTradeTracks();
  if (tracks.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading trades…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose a trade" subtitle="Build a skill, earn a credential" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>Pick one trade to focus on. You build a portfolio, pass a practical assessment, then unlock real Paymax earning roles.</Text>
        {tracks.data?.map((t) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[t.icon] ?? Icons.Wrench;
          return (
            <Pressable key={t.id} style={[styles.card, shadow1, t.chosen && styles.chosen]} onPress={() => router.push('/learn/academy/trade')}>
              <View style={styles.icon}><Icon size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{t.name}</Text>
                  {t.chosen ? <CheckCircle2 size={16} color={Colors.teal} /> : null}
                </View>
                <Text style={styles.sub} numberOfLines={1}>{t.tagline}</Text>
                {t.chosen ? <ProgressBar pct={t.progressPct} style={{ marginTop: 6 }} /> : null}
                <View style={styles.roles}>
                  {t.unlocksRoles.map((r) => <Chip key={r} label={r} color={Colors.secondary} bg={Colors.iconBgBlue} small />)}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  chosen: { borderWidth: 1.5, borderColor: Colors.primary },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
});
