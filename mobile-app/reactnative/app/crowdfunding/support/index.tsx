import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronDown, ChevronUp, MessageSquarePlus, Ticket, LifeBuoy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import { useHelpArticles } from '@/features/crowdfunding/hooks/useExtras';

export default function HelpCenterScreen() {
  const { data, isLoading, isError, refetch } = useHelpArticles();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const filtered = (data ?? []).filter(
    (a) => search.trim() === '' || a.question.toLowerCase().includes(search.toLowerCase()) || a.topic.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Help center" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <LifeBuoy size={28} color={Colors.primary} strokeWidth={1.8} />
          <Text style={styles.heroTitle}>How can we help?</Text>
        </View>
        <SearchBar placeholder="Search help articles…" value={search} onChangeText={setSearch} />

        {/* Quick actions */}
        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={() => router.push('/crowdfunding/support/create')} accessibilityRole="button">
            <View style={styles.actionIcon}><MessageSquarePlus size={20} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.actionLabel}>Contact support</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => router.push('/crowdfunding/support/tickets')} accessibilityRole="button">
            <View style={styles.actionIcon}><Ticket size={20} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.actionLabel}>My tickets</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Frequently asked</Text>
        {isLoading ? (
          <StateView kind="loading" compact />
        ) : isError ? (
          <StateView kind="error" compact title="Couldn't load articles" actionLabel="Retry" onAction={refetch} />
        ) : filtered.length === 0 ? (
          <StateView kind="empty" compact icon="SearchX" title="No articles found" message="Try a different search, or contact support." />
        ) : (
          filtered.map((a) => {
            const isOpen = open === a.id;
            return (
              <Pressable key={a.id} style={styles.faq} onPress={() => setOpen(isOpen ? null : a.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                <View style={styles.faqHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topic}>{a.topic}</Text>
                    <Text style={styles.question}>{a.question}</Text>
                  </View>
                  {isOpen ? <ChevronUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <ChevronDown size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                </View>
                {isOpen && <Text style={styles.answer}>{a.answer}</Text>}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 60 },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  actions: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  faq: { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topic: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.4 },
  question: { ...Typography.labelLg, color: Colors.onSurface },
  answer: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
