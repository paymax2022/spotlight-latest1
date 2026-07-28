import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronDown, ChevronUp, MessageSquarePlus, Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useFaqs } from '@/features/association/hooks/useSettings';

export default function HelpCenter() {
  const faqs = useFaqs();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Help center" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Quick actions */}
        <View style={styles.actions}>
          <Pressable style={[styles.actionCard, shadow1]} onPress={() => router.push('/association/support/new')} accessibilityRole="button" accessibilityLabel="Create support ticket">
            <View style={styles.actionIcon}><MessageSquarePlus size={20} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.actionLabel}>Contact support</Text>
          </Pressable>
          <Pressable style={[styles.actionCard, shadow1]} onPress={() => router.push('/association/support/tickets')} accessibilityRole="button" accessibilityLabel="My tickets">
            <View style={styles.actionIcon}><Inbox size={20} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.actionLabel}>My tickets</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Frequently asked</Text>
        {faqs.isLoading ? (
          <StateView kind="loading" compact message="Loading…" />
        ) : faqs.isError ? (
          <StateView kind="error" compact title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => faqs.refetch()} />
        ) : (
          <View style={styles.gap}>
            {(faqs.data ?? []).map((f) => {
              const expanded = open === f.id;
              return (
                <Pressable key={f.id} style={[styles.faqCard, shadow1]} onPress={() => setOpen(expanded ? null : f.id)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={f.question}>
                  <View style={styles.faqHead}>
                    <Text style={styles.question}>{f.question}</Text>
                    {expanded ? <ChevronUp size={18} color={Colors.outline} strokeWidth={2} /> : <ChevronDown size={18} color={Colors.outline} strokeWidth={2} />}
                  </View>
                  {expanded ? <Text style={styles.answer}>{f.answer}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionCard: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.md },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  gap: { gap: Spacing.sm },
  faqCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  question: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  answer: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
