import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useQuery } from '@tanstack/react-query';
import PrimaryButton from '@/components/PrimaryButton';
import { getVoteReceipt } from '@/features/voting/api/voting.api';
import VoteReceiptCard from '@/features/voting/components/VoteReceiptCard';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';

export default function VoteReceiptScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const [shareOpen, setShareOpen] = React.useState(false);

  const { data: tx, isLoading } = useQuery({
    queryKey: ['voting', 'receipt', transactionId],
    queryFn: () => getVoteReceipt(transactionId ?? ''),
    enabled: !!transactionId,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Vote Receipt</Text>
        <Pressable onPress={() => setShareOpen(true)} style={styles.backBtn}>
          <Share2 size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {isLoading ? (
          <View style={styles.empty}><Text style={styles.emptyText}>Loading receipt…</Text></View>
        ) : tx ? (
          <VoteReceiptCard transaction={tx} />
        ) : (
          <View style={styles.empty}><Text style={styles.emptyText}>Receipt not found.</Text></View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Back to My Votes" onPress={() => router.push('/voting/my-votes')} variant="secondary" />
      </View>

      {tx && (
        <ShareBottomSheet
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          contestantName={tx.contestantName ?? 'Contestant'}
          shareText={`I voted ${tx.votes} times for ${tx.contestantName} in ${tx.contestTitle}! 🎤 Ref: ${tx.reference}`}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:   { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:     { ...Typography.titleLg, color: Colors.onSurface },
  content:   { padding: Spacing.containerMargin, paddingBottom: 100 },
  empty:     { paddingVertical: Spacing.xxl, alignItems: 'center' },
  emptyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer:    { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
