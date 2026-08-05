import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronDown, Headphones } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useHelpArticles } from '@/features/connect/hooks/useConnect';

// ST-14 — Help & support. FAQ, contact, ticket.
export default function Help() {
  const { data, isLoading, error, refetch } = useHelpArticles();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Help & support" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load help" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.contactCard}>
            <View style={styles.contactIcon}><Headphones size={22} color={Colors.onPrimary} strokeWidth={2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>Need a hand?</Text>
              <Text style={styles.contactBody}>Our support team typically replies within a few hours.</Text>
            </View>
          </View>
          <PrimaryButton label="Contact support" onPress={() => router.push('/services/support')} />

          <Text style={styles.group}>Frequently asked</Text>
          <View style={styles.card}>
            {data.map((a, i, arr) => {
              const isOpen = open === a.id;
              return (
                <View key={a.id} style={i < arr.length - 1 ? styles.divider : undefined}>
                  <Pressable style={styles.faqHead} onPress={() => setOpen(isOpen ? null : a.id)}>
                    <Text style={styles.faqQ}>{a.question}</Text>
                    <ChevronDown
                      size={18}
                      color={Colors.outline}
                      strokeWidth={2}
                      style={isOpen ? styles.chevOpen : undefined}
                    />
                  </Pressable>
                  {isOpen ? <Text style={styles.faqA}>{a.answer}</Text> : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md, paddingTop: Spacing.sm },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md },
  contactIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  contactTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  contactBody: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  faqHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, gap: Spacing.sm },
  faqQ: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  faqA: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingBottom: Spacing.md },
});
