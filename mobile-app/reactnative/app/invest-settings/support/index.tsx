import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import TicketRow from '@/features/investsettings/components/TicketRow';
import { useTickets } from '@/features/investsettings/hooks/useSettings';
import { FAQ_LIST } from '@/features/investsettings/constants/settings.constants';

export default function SupportHomeScreen() {
  const { data, isLoading, isError, refetch } = useTickets();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Help & support"
        subtitle="FAQs and your tickets"
        rightSlot={
          <Pressable onPress={() => router.push('/invest-settings/support/new')} hitSlop={8} accessibilityRole="button" accessibilityLabel="New ticket">
            <Plus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* FAQ */}
        <SectionHeader title="Frequently asked" />
        <View style={styles.group}>
          {FAQ_LIST.map((faq, i) => {
            const open = expanded === faq.id;
            return (
              <View key={faq.id} style={[i < FAQ_LIST.length - 1 && styles.faqBorder]}>
                <Pressable onPress={() => setExpanded(open ? null : faq.id)} style={styles.faqHeader}>
                  <Text style={styles.faqQ}>{faq.question}</Text>
                  {open
                    ? <ChevronUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    : <ChevronDown size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                </Pressable>
                {open ? <Text style={styles.faqA}>{faq.answer}</Text> : null}
              </View>
            );
          })}
        </View>

        {/* Tickets */}
        <SectionHeader title="Your tickets" actionLabel="New ticket"
          onAction={() => router.push('/invest-settings/support/new')} style={styles.sectionHeader} />

        {isLoading ? (
          <StateView kind="loading" compact message="Loading tickets…" />
        ) : isError ? (
          <StateView kind="error" compact title="Couldn't load tickets" message="Please try again."
            actionLabel="Retry" onAction={() => refetch()} />
        ) : (data ?? []).length === 0 ? (
          <StateView kind="empty" compact icon="MessagesSquare" title="No tickets yet"
            message="Open a ticket and our team will get back to you."
            actionLabel="Create ticket" onAction={() => router.push('/invest-settings/support/new')} />
        ) : (
          <View style={styles.ticketList}>
            {data!.map((t) => (
              <TicketRow key={t.id} ticket={t} onPress={() => router.push(`/invest-settings/support/${t.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  group: {
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden',
  },
  faqBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  faqHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.md, padding: Spacing.md,
  },
  faqQ: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  faqA: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  sectionHeader: { marginTop: Spacing.sm },
  ticketList: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
});
