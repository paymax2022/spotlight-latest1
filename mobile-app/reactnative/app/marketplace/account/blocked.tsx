// ── Screen 32 — Blocked users ────────────────────────────────────────────────
// User-controlled safety list. GET /blocks → list; DELETE /blocks/:id → unblock.
// Empty state is an invitation, not a bare blank.
import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { MarketColors } from '@/features/marketplace';
import { useBlocks, useUnblockUser } from '@/features/marketplace/api/account.hooks';
import type { Block } from '@/features/marketplace/api/account.api';

export default function BlockedUsers() {
  const blocks = useBlocks();
  const unblock = useUnblockUser();
  const items = blocks.data ?? [];

  const confirmUnblock = (b: Block) => {
    const name = b.blockedUserName ?? 'this user';
    Alert.alert('Unblock user?', `${name} will be able to contact you and see your listings again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', style: 'destructive', onPress: () => unblock.mutate(b.id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Blocked users" />
      {blocks.isLoading && !blocks.data ? (
        <StateView kind="loading" message="Loading your blocked list…" />
      ) : items.length === 0 ? (
        <StateView
          kind="empty"
          icon="UserX"
          title="No one blocked"
          message="When you block someone, they can’t message you or see your listings. You can unblock them here anytime."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const name = item.blockedUserName ?? `User ${item.blockedUserId.slice(0, 6)}`;
            return (
              <View style={styles.row}>
                <View style={styles.avatar}><UserX size={18} color={MarketColors.muted} /></View>
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.meta}>Blocked {new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                <Pressable
                  style={styles.unblockBtn}
                  onPress={() => confirmUnblock(item)}
                  disabled={unblock.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${name}`}
                >
                  <Text style={styles.unblockText}>Unblock</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: MarketColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  name: { ...Typography.titleMd, color: MarketColors.text },
  meta: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 1 },
  unblockBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.brand },
  unblockText: { ...Typography.labelLg, color: MarketColors.brand },
});
