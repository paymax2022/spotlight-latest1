import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Trophy, Award } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ContestantImage from './ContestantImage';
import { getEditionWinners, getEditionPrizes } from '../api/edition.api';
import type { EditionWinner, EditionPrize } from '../types/edition.types';

/**
 * MEET THE SPOTLIGHT RISING STAR WINNERS (§3). Renders only winners the server
 * has marked published for an edition whose results are published — the API
 * never returns an unauthorised winner, so this component does not gate again, it
 * just presents. The top rank gets the largest, most prestigious framing; the
 * rest share a complementary card. Tapping a card opens the individual's full
 * Rising Star profile. Renders nothing at all when there are no published winners.
 */
export default function WinnersSection({ contestId }: { contestId: string }) {
  const [winners, setWinners] = useState<EditionWinner[]>([]);
  const [prizes, setPrizes] = useState<EditionPrize[]>([]);

  useEffect(() => {
    if (!contestId) return;
    let alive = true;
    void Promise.all([getEditionWinners(contestId), getEditionPrizes(contestId)]).then(([w, p]) => {
      if (!alive) return;
      setWinners(w);
      setPrizes(p);
    });
    return () => { alive = false; };
  }, [contestId]);

  if (winners.length === 0) return null;

  const ordered = [...winners].sort((a, b) => (a.position_rank ?? 999) - (b.position_rank ?? 999));
  const top = ordered[0];
  const rest = ordered.slice(1);

  const prizeFor = (w: EditionWinner): EditionPrize | undefined =>
    prizes.find((p) => p.position_id && p.position_id === w.position_id);

  const openProfile = (w: EditionWinner) =>
    router.push(`/voting/contestant-profile?contestantId=${w.contestant_id}&contestId=${contestId}`);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Trophy size={20} color={Colors.primary} />
        <Text style={styles.heading}>MEET THE SPOTLIGHT RISING STAR WINNERS</Text>
      </View>

      {/* Overall winner — the largest, most prestigious presentation. */}
      <Pressable onPress={() => openProfile(top)} style={[styles.card, styles.topCard, shadow1]}>
        <View style={styles.badgeRow}>
          <View style={styles.topBadge}><Text style={styles.topBadgeText}>{top.position_title || 'Overall Winner'}</Text></View>
        </View>
        {/* Same door the rest of the voting surfaces use: the editions read hands back
            whatever contestants.photo_url holds, and only a value the photo reader can
            serve is worth asking for. */}
        <ContestantImage
          value={top.contestant_photo}
          style={styles.topPhoto}
          accessibilityLabel={top.contestant_name || 'Winner'}
          fallback={
            <View style={styles.photoFallback}><Text style={styles.photoInitial}>{(top.contestant_name || '?').charAt(0).toUpperCase()}</Text></View>
          }
        />
        <Text style={styles.topName}>{top.contestant_name || 'Winner'}</Text>
        {prizeFor(top) && <Text style={styles.prize}>{prizeLabel(prizeFor(top)!)}</Text>}
      </Pressable>

      {/* Runner-ups — distinctive but complementary. */}
      {rest.map((w) => {
        const pz = prizeFor(w);
        return (
          <Pressable key={w.id} onPress={() => openProfile(w)} style={[styles.card, styles.rowCard]}>
            <View style={styles.rankChip}><Award size={16} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{w.contestant_name || 'Winner'}</Text>
              <Text style={styles.rowPosition}>{w.position_title || `Place ${w.position_rank ?? ''}`}</Text>
              {pz && <Text style={styles.rowPrize}>{prizeLabel(pz)}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function prizeLabel(p: EditionPrize): string {
  const cash = p.amount_kobo != null && p.amount_kobo > 0
    ? `${p.currency} ${(p.amount_kobo / 100).toLocaleString()}`
    : '';
  return [cash, p.title || p.description].filter(Boolean).join(' · ');
}

// Vector photo frames are an edition-specific asset; until the framed asset is
// wired per edition, the overall winner is drawn in the plain circular
// styles.topPhoto frame and the runner-ups as text rows.

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md, marginTop: Spacing.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heading: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, letterSpacing: 0.4 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  topCard: { alignItems: 'center', paddingVertical: Spacing.lg, borderWidth: 2, borderColor: Colors.primary },
  badgeRow: { alignItems: 'center', marginBottom: Spacing.sm },
  topBadge: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  topBadgeText: { ...Typography.labelSm, color: '#fff', fontWeight: '700' },
  topPhoto: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: Colors.primary },
  photoFallback: { width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  photoInitial: { ...Typography.titleLg, color: Colors.primary },
  topName: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm, textAlign: 'center' },
  prize: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4, textAlign: 'center' },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rankChip: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  rowName: { ...Typography.titleMd, color: Colors.onSurface },
  rowPosition: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  rowPrize: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
