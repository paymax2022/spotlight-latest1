import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTickets } from '@/features/association/hooks/useSettings';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import { TICKET_STATUS_STYLE, TICKET_CATEGORY_LABEL } from '@/features/association/constants/support.constants';

export default function TicketList() {
  const tickets = useTickets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Support tickets"
        rightSlot={
          <Pressable onPress={() => router.push('/association/support/new')} hitSlop={8} accessibilityLabel="New ticket">
            <Plus size={20} color={Colors.secondary} strokeWidth={2.2} />
          </Pressable>
        }
      />
      {tickets.isLoading ? (
        <StateView kind="loading" message="Loading tickets…" />
      ) : tickets.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => tickets.refetch()} />
      ) : (tickets.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Inbox" title="No tickets yet" message="Create a ticket and our support team will help." actionLabel="Contact support" onAction={() => router.push('/association/support/new')} />
      ) : (
        <FlatList
          data={tickets.data ?? []}
          keyExtractor={(t) => t.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => {
            const st = TICKET_STATUS_STYLE[item.status];
            return (
              <Pressable onPress={() => router.push(`/association/support/${item.id}`)} style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={item.subject}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.pill, { backgroundColor: st.bg }]}>
                      <View style={[styles.dot, { backgroundColor: st.color }]} />
                      <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                    </View>
                    <Text style={styles.meta}>{TICKET_CATEGORY_LABEL[item.category]} · {relativeTime(item.updatedAt)}</Text>
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  pressed: { opacity: 0.9 },
  subject: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  pillText: { ...Typography.caption, fontWeight: '600' as const },
  meta: { ...Typography.caption, color: Colors.outline, flexShrink: 1 },
});
