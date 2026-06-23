import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

export default function MembershipCardScreen() {
  const card = useMembershipCard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Membership card" />
      {card.isLoading ? (
        <StateView kind="loading" message="Loading card…" />
      ) : card.isError || !card.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => card.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <MembershipCardView card={card.data} showQr />

          <View style={styles.actions}>
            <PrimaryButton
              label="Share"
              variant="secondary"
              onPress={() => Alert.alert('Share card', 'Sharing is not available in this preview build.')}
              style={styles.actionBtn}
              fullWidth={false}
            />
            <PrimaryButton
              label="Download"
              variant="secondary"
              onPress={() => Alert.alert('Download card', 'Download is not available in this preview build.')}
              style={styles.actionBtn}
              fullWidth={false}
            />
          </View>

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
  noteCard: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
