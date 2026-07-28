import React from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTickets } from '@/features/crowdfunding/hooks/useExtras';
import { relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { TicketStatus } from '@/features/crowdfunding/types/crowdfunding.types';

const META: Record<TicketStatus, { label: string; fg: string; bg: string }> = {
  OPEN: { label: 'Open', fg: Colors.secondary, bg: Colors.iconBgBlue },
  PENDING: { label: 'Awaiting reply', fg: '#B65A00', bg: Colors.iconBgOrange },
  RESOLVED: { label: 'Resolved', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  CLOSED: { label: 'Closed', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export default function TicketListScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useTickets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Support tickets"
        rightSlot={
          <Pressable onPress={() => router.push('/crowdfunding/support/create')} hitSlop={8} accessibilityLabel="New ticket">
            <Plus size={22} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load tickets" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const meta = META[item.status];
            const last = item.messages[item.messages.length - 1];
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/crowdfunding/support/ticket/${item.id}`)} accessibilityRole="button">
                <View style={styles.body}>
                  <View style={styles.headRow}>
                    <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
                    <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>{last?.from === 'support' ? 'Support: ' : 'You: '}{last?.body}</Text>
                  <Text style={styles.meta}>{item.reference} · {relativeTime(item.updatedAt)}</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <StateView kind="empty" icon="Ticket" title="No support tickets" message="Need help? Create a ticket and we'll respond quickly." actionLabel="Create ticket" onAction={() => router.push('/crowdfunding/support/create')} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 60, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  body: { flex: 1, gap: 3 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  subject: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.caption, color: Colors.outline },
});
