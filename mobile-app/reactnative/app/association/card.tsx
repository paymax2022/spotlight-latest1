import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Share2, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MembershipCardView from '@/features/association/components/MembershipCardView';
import { useMembershipCard } from '@/features/association/hooks/useAssociation';
import { shareMembershipCard } from '@/features/association/utils/cardShare';
import { saveMembershipCard } from '@/features/association/utils/cardDownload';

export default function MembershipCardScreen() {
  const card = useMembershipCard();
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The captured view is the CARD, not the screen — capturing the screen would
  // put the buttons and the help text into the saved image.
  const cardRef = useRef(null);

  const onDownload = async () => {
    if (!card.data || saving) return;
    setSaving(true);
    setNote(null);
    try {
      const outcome = await saveMembershipCard(cardRef, card.data.memberId);
      if (outcome === 'saved') setNote('Card saved to your downloads.');
      else if (outcome === 'unsupported') setNote('Saving is not available on this device.');
      else if (outcome === 'failed') setNote("Couldn't save the card. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onShare = async () => {
    if (!card.data) return;
    const outcome = await shareMembershipCard(card.data);
    // The clipboard fallback is silent otherwise, and a button that copies
    // without saying so reads as a button that did nothing.
    if (outcome === 'copied') setNote('Card details copied to your clipboard.');
    else if (outcome === 'failed') setNote("Couldn't share the card. Please try again.");
    else setNote(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Membership card" />
      {card.isLoading ? (
        <StateView kind="loading" message="Loading card…" />
      ) : card.isError || !card.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => card.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View ref={cardRef} collapsable={false}>
            <MembershipCardView card={card.data} showQr />
          </View>

          <View style={styles.actions}>
            <PrimaryButton
              label="Share"
              variant="secondary"
              onPress={onShare}
              style={styles.actionBtn}
              fullWidth={false}
            />
            <PrimaryButton
              label={saving ? 'Saving…' : 'Download'}
              variant="secondary"
              onPress={onDownload}
              disabled={saving}
              style={styles.actionBtn}
              fullWidth={false}
            />
          </View>
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <PrimaryButton
            label="Verify a member's card"
            variant="secondary"
            onPress={() => router.push('/association/verify-card')}
          />

          <View style={styles.noteCard}>
            <Share2 size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.noteText}>
              Present this card and QR code for in-person verification. Admins can scan it to confirm your status offline.
            </Text>
          </View>
          <View style={styles.noteCard}>
            <Download size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.noteText}>
              Your card reflects live payment status. Settle outstanding dues to keep it active.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1 },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  noteCard: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
