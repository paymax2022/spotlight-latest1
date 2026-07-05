import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Swords, Clock, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';

const DURATIONS = [
  { value: 180, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
];

/** PK battle setup / matchmaking (PRD §10.7 LB-05). */
export default function PkInviteScreen() {
  const [duration, setDuration] = useState(300);
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState(false);

  function findOpponent() {
    setMatching(true);
    setTimeout(() => { setMatching(false); setMatched(true); }, 1400);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="PK battle" subtitle="Challenge another host" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}><Swords size={32} color={ConnectColors.brand} strokeWidth={2} /></View>
        <Text style={styles.title}>Set up a PK battle</Text>
        <Text style={styles.sub}>You and another live host compete for gifts. The side with the most gift value (real Naira) wins the round.</Text>

        <Text style={styles.label}>Battle length</Text>
        <View style={styles.durRow}>
          {DURATIONS.map((d) => {
            const active = duration === d.value;
            return (
              <Pressable key={d.value} style={[styles.durChip, active && styles.durChipActive]} onPress={() => setDuration(d.value)}>
                <Clock size={14} color={active ? ConnectColors.brand : Colors.onSurfaceVariant} strokeWidth={2.2} />
                <Text style={[styles.durText, active && styles.durTextActive]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.rulesBox}>
          <Text style={styles.rulesTitle}>Fair-play rules</Text>
          <Text style={styles.rule}>• Gifts are real money — no fake or self-gifting.</Text>
          <Text style={styles.rule}>• Vote/gift laundering is detected and reversed.</Text>
          <Text style={styles.rule}>• The losing side keeps all gifts already received.</Text>
        </View>

        {matched ? (
          <View style={styles.matchedBox}>
            <CircleCheck size={18} color={ConnectColors.ok} strokeWidth={2.2} />
            <Text style={styles.matchedText}>Matched with Bola — starting in 3…</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {matched ? (
          <PrimaryButton label="Start battle" onPress={() => router.replace({ pathname: '/connect/live/pk-battle-view', params: { id: 'pk_1' } })} />
        ) : (
          <PrimaryButton label={matching ? 'Finding opponent…' : 'Find opponent'} onPress={findOpponent} loading={matching} disabled={matching} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  hero: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  durRow: { flexDirection: 'row', gap: Spacing.sm },
  durChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1.5, borderColor: ConnectColors.border, backgroundColor: Colors.surfaceContainerLowest },
  durChipActive: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  durText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  durTextActive: { color: ConnectColors.brand, fontWeight: '700' as const },
  rulesBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm, gap: 4 },
  rulesTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 2 },
  rule: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  matchedBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ConnectColors.okBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  matchedText: { ...Typography.labelMd, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border },
});
