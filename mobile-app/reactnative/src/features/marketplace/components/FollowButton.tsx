import React from 'react';
import { Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { UserPlus, UserCheck } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { useAuthStore } from '@/store/authStore';
import { alertAsync } from '@/lib/confirm';
import { MarketColors } from '../constants';
import { useFollowedSellers, useFollowSeller, useUnfollowSeller } from '../api/account.hooks';

interface Props {
  sellerId: string;
  sellerName?: string;
  /** Smaller pill for use inside cards. */
  compact?: boolean;
}

/** Follow / Following toggle for a seller. Hidden on your own profile. The state comes
 *  from the signed-in followed list (the public seller read cannot know the viewer),
 *  and flips optimistically — see useFollowSeller. */
export default function FollowButton({ sellerId, sellerName, compact }: Props) {
  const me = useAuthStore((s) => s.user?.id);
  const followed = useFollowedSellers();
  const follow = useFollowSeller();
  const unfollow = useUnfollowSeller();

  if (!sellerId || sellerId === me) return null;

  const isFollowing = (followed.data ?? []).some((f) => f.sellerId === sellerId);
  const busy = follow.isPending || unfollow.isPending;

  const toggle = () => {
    const onError = (e: unknown) =>
      alertAsync({ title: isFollowing ? 'Could not unfollow' : 'Could not follow', message: (e as Error)?.message ?? 'Please try again.' });
    if (isFollowing) unfollow.mutate(sellerId, { onError });
    else follow.mutate({ sellerId, sellerName }, { onError });
  };

  const Icon = isFollowing ? UserCheck : UserPlus;
  return (
    <Pressable
      style={[styles.btn, compact && styles.compact, isFollowing ? styles.on : styles.off]}
      onPress={toggle}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected: isFollowing, busy }}
      accessibilityLabel={isFollowing ? `Unfollow ${sellerName ?? 'seller'}` : `Follow ${sellerName ?? 'seller'}`}
    >
      {busy ? <ActivityIndicator size="small" color={isFollowing ? '#fff' : MarketColors.brand} /> : <Icon size={compact ? 14 : 16} color={isFollowing ? '#fff' : MarketColors.brand} />}
      <Text style={[styles.label, isFollowing ? styles.labelOn : styles.labelOff]}>{isFollowing ? 'Following' : 'Follow'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, borderWidth: 1.5, borderColor: MarketColors.brand },
  compact: { paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  on: { backgroundColor: MarketColors.brand },
  off: { backgroundColor: 'transparent' },
  label: { ...Typography.labelLg, fontWeight: '700' },
  labelOn: { color: '#fff' },
  labelOff: { color: MarketColors.brand },
});
