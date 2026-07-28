import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useReferralList } from '@/features/referral/rewards/hooks';
import { formatNaira, formatDate, RewardColors } from '@/features/referral/rewards/constants';
import { RewardHeader, Chip } from '@/features/referral/rewards/components';
import type { ReferredUser } from '@/features/referral/rewards/types';

// PRD §5.1.3 — My Referrals. First name / avatar (initial) + masked contact,
// Active/Inactive chip (30-day rolling rule), join date, lifetime contribution.
// Inactive users are shown plainly, not hidden — transparency on the count.
export default function MyReferrals() {
  const { data, isLoading, isError, refetch } = useReferralList();
  const referrals = data?.referrals ?? [];
  const activeCount = referrals.filter((r) => r.active).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <RewardHeader title="My referrals" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load your referrals" actionLabel="Retry" onAction={refetch} />
      ) : referrals.length === 0 ? (
        <StateView
          kind="empty"
          icon="Users"
          title="No referrals yet"
          message="Invite someone with your code — they'll appear here once they sign up."
        />
      ) : (
        <FlatList
          data={referrals}
          keyExtractor={(r) => r.referred_user_id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.summaryRow}>
              <Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.summaryText}>
                {activeCount} active · {referrals.length - activeCount} inactive
              </Text>
            </View>
          }
          renderItem={({ item }) => <ReferralRow item={item} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        />
      )}
    </SafeAreaView>
  );
}

function ReferralRow({ item }: { item: ReferredUser }) {
  const initial = item.masked_contact.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, !item.active && styles.avatarInactive]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.masked_contact}</Text>
        <Text style={styles.meta}>Joined {formatDate(item.joined_at)}</Text>
      </View>
      <View style={styles.rowRight}>
        {item.active ? (
          <Chip label="Active" fg={RewardColors.ok} bg={RewardColors.okBg} />
        ) : (
          <Chip label="Inactive" fg={RewardColors.muted} bg={RewardColors.surfaceAlt} />
        )}
        <Text style={styles.contribution}>{formatNaira(item.lifetime_earned_kobo)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.md },
  summaryText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: RewardColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: RewardColors.border, padding: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarInactive: { backgroundColor: Colors.surfaceContainerHigh },
  avatarText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' },
  name: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: Spacing.xs },
  contribution: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
});
