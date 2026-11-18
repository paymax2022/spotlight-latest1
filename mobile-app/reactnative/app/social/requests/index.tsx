import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { HandCoins } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import RequestRow from '@/features/social/components/RequestRow';
import { useRequests } from '@/features/social/hooks';
import { buildInbox } from '@/features/social/lib/requests';
import { SocialColors, formatNaira } from '@/features/social/constants/social.constants';

// The receiver's half of a cashtag request. Creating a request only tells the
// other person they owe money — this is where they see it and settle it.
export default function MoneyRequests() {
  const requests = useRequests();

  const list = requests.data ?? [];
  const inbox = buildInbox(list);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Money requests" />
      {requests.isLoading ? (
        <StateView kind="loading" message="Loading your requests…" />
      ) : requests.isError ? (
        <StateView kind="error" title="Couldn't load requests" actionLabel="Retry" onAction={() => requests.refetch()} />
      ) : list.length === 0 ? (
        <StateView
          kind="empty"
          title="No requests yet"
          message="Requests you send and requests sent to you both appear here."
          icon="HandCoins"
          actionLabel="Request money"
          onAction={() => router.push('/social/request')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Money the viewer owes — the actionable half, and why this screen exists. */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>To pay</Text>
            {inbox.pendingCount > 0 ? (
              <Text style={styles.sectionTotal}>{formatNaira(inbox.toPayKobo)} waiting</Text>
            ) : null}
          </View>
          {inbox.toPay.length === 0 ? (
            <Text style={styles.none}>Nothing is asking you for money right now.</Text>
          ) : (
            <View style={styles.card}>
              {inbox.toPay.map((req) => (
                <RequestRow key={req.id} req={req} onPress={() => router.push(`/social/requests/${req.id}`)} />
              ))}
            </View>
          )}

          {/* Money the viewer asked for. */}
          <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>You requested</Text>
          {inbox.requested.length === 0 ? (
            <View style={styles.emptyRequested}>
              <Text style={styles.none}>You haven’t asked anyone for money yet.</Text>
              <PrimaryButton
                label="Request money"
                onPress={() => router.push('/social/request')}
                style={styles.requestBtn}
              />
            </View>
          ) : (
            <View style={styles.card}>
              {inbox.requested.map((req) => (
                <RequestRow key={req.id} req={req} onPress={() => router.push(`/social/requests/${req.id}`)} />
              ))}
            </View>
          )}

          <View style={styles.infoCard}>
            <HandCoins size={18} color={SocialColors.brand} />
            <Text style={styles.infoText}>
              Paying a request moves money straight from your wallet to the person who asked.
              Declining tells them you won’t pay it, and cancels nothing on your balance.
            </Text>
          </View>

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingTop: Spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionTitleSpaced: { marginTop: Spacing.md },
  sectionTotal: { ...Typography.labelSm, color: SocialColors.danger },
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.xs, ...shadow1 },
  none: { ...Typography.bodySm, color: SocialColors.muted },
  emptyRequested: { gap: Spacing.sm },
  requestBtn: { alignSelf: 'flex-start' },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  infoText: { ...Typography.bodySm, color: SocialColors.muted, flex: 1 },
});
