// ── Screen 27 — Meetup Mode (modal sheet) ────────────────────────────────────
// The safety net for the in-person cash path (the only path in the connect
// model). Safe-spot suggestions, a trip-share toggle, a check-in timer with an
// SOS shortcut, and an always-visible one-line nudge that Paymax doesn't hold
// funds for this deal. "Mark deal complete" opens the OPTIONAL, self-reported
// Review Composer.
//
// Modelled as a modal (not a route) so it needs no new entry in the Tabs shell.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, Switch, Alert } from 'react-native';
import { X, ShieldOff, Timer, TriangleAlert, Share2, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { MarketColors } from '@/features/marketplace';
import { useSafeSpots } from '@/features/marketplace/api/transact.hooks';
import MeetupSafeSpots from './MeetupSafeSpots';
import ReviewComposerSheet from './ReviewComposerSheet';
import { useSubmitReview } from '@/features/marketplace/api/transact.hooks';

const CHECKIN_SECONDS = 15 * 60; // 15-minute check-in window

export default function MeetupModeSheet({
  visible,
  listingTitle,
  dealId,
  onClose,
}: {
  visible: boolean;
  listingTitle: string;
  /** the Deal Room thread id — the review is self-reported against it. */
  dealId?: string;
  onClose: () => void;
}) {
  const spotsQ = useSafeSpots();
  const [spotId, setSpotId] = useState<string | null>(null);
  const [tripShare, setTripShare] = useState(false);
  const [timerOn, setTimerOn] = useState(false);
  const [remaining, setRemaining] = useState(CHECKIN_SECONDS);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Reviews are self-reported after "Mark deal complete" — keyed by the deal
  // thread (no order exists in the connect model).
  const submitReview = useSubmitReview(dealId ?? `deal_${listingTitle}`);

  useEffect(() => {
    if (!timerOn) return;
    if (remaining <= 0) {
      // Missed check-in → trusted-contact alert (not a silent timeout).
      setTimerOn(false);
      Alert.alert('Missed check-in', 'We would alert your trusted contact that you have not checked in. Are you safe?');
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [timerOn, remaining]);

  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Meetup mode</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={22} color={MarketColors.muted} /></Pressable>
          </View>

          {/* Off-platform nudge — always visible, in the moment. */}
          <View style={styles.nudge}>
            <ShieldOff size={16} color={MarketColors.danger} />
            <Text style={styles.nudgeText}>Paymax doesn't hold funds for this deal. Meet in a safe public place and pay only in person, once you've seen the item.</Text>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.section}>Suggested safe spots</Text>
            {spotsQ.isLoading ? (
              <Text style={styles.muted}>Finding verified-safe locations near you…</Text>
            ) : (
              <MeetupSafeSpots spots={spotsQ.data ?? []} selectedId={spotId} onSelect={setSpotId} />
            )}

            <View style={styles.toggleRow}>
              <Share2 size={18} color={MarketColors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Share my live location</Text>
                <Text style={styles.toggleSub}>A trusted contact can follow your trip to the meetup.</Text>
              </View>
              <Switch value={tripShare} onValueChange={setTripShare} />
            </View>

            <View style={styles.timerCard}>
              <View style={styles.timerHead}>
                <Timer size={18} color={MarketColors.brand} />
                <Text style={styles.timerTitle}>Check-in timer</Text>
                <Text style={styles.timerValue}>{timerOn ? mmss : '15:00'}</Text>
              </View>
              <Text style={styles.toggleSub}>Start it when you set off. If you don't check in, we alert your trusted contact.</Text>
              <View style={styles.timerBtns}>
                {!timerOn ? (
                  <Pressable style={styles.startBtn} onPress={() => { setRemaining(CHECKIN_SECONDS); setTimerOn(true); }}>
                    <Text style={styles.startText}>Start check-in</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.checkinBtn} onPress={() => { setTimerOn(false); Alert.alert('Checked in', 'Glad you arrived safely.'); }}>
                    <CheckCircle2 size={16} color={MarketColors.surface} />
                    <Text style={styles.startText}>I've arrived</Text>
                  </Pressable>
                )}
                <Pressable style={styles.sosBtn} onPress={() => Alert.alert('SOS', 'This would alert your trusted contact and share your location immediately.')}>
                  <TriangleAlert size={16} color={MarketColors.surface} />
                  <Text style={styles.sosText}>SOS</Text>
                </Pressable>
              </View>
            </View>

            <PrimaryButton
              label="Mark deal complete"
              variant="secondary"
              onPress={() => setReviewOpen(true)}
              style={{ marginTop: Spacing.lg }}
            />
            <Text style={[styles.muted, { textAlign: 'center', marginTop: Spacing.sm }]}>
              Meetup deals are self-reported — confirm only after you've received the item.
            </Text>
          </ScrollView>
        </View>
      </View>

      <ReviewComposerSheet
        visible={reviewOpen}
        submitting={submitReview.isPending}
        onSkip={() => { setReviewOpen(false); onClose(); }}
        onSubmit={(input) => {
          submitReview.mutate(input, { onSettled: () => { setReviewOpen(false); onClose(); } });
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.lg, maxHeight: '90%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title: { ...Typography.titleLg, color: MarketColors.text },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: MarketColors.dangerBg, borderRadius: Radius.md, padding: Spacing.sm + 2 },
  nudgeText: { ...Typography.labelSm, color: MarketColors.danger, flex: 1, fontWeight: '600', lineHeight: 16 },
  scroll: { paddingTop: Spacing.md, gap: Spacing.md },
  section: { ...Typography.titleMd, color: MarketColors.text },
  muted: { ...Typography.bodySm, color: MarketColors.muted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.md },
  toggleTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  toggleSub: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 2, lineHeight: 15 },
  timerCard: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  timerHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  timerTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700', flex: 1 },
  timerValue: { ...Typography.titleMd, color: MarketColors.brand },
  timerBtns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  startBtn: { flex: 1, backgroundColor: MarketColors.brand, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  checkinBtn: { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: MarketColors.ok, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  startText: { ...Typography.labelMd, color: MarketColors.surface, fontWeight: '700' },
  sosBtn: { flexDirection: 'row', gap: 6, backgroundColor: MarketColors.danger, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: Spacing.md },
  sosText: { ...Typography.labelMd, color: MarketColors.surface, fontWeight: '800' },
});
