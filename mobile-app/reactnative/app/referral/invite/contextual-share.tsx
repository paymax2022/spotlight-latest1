import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Share2, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useContextualPrompt } from '@/features/referral/invite/hooks';
import type { ShareContext } from '@/features/referral/invite/types';

const VALID: ShareContext[] = ['paid_bill', 'won_contest', 'listed_property', 'sent_money', 'first_savings'];

// M-INV-06 — Contextual share prompt (post-action: paid a bill, won, listed
// property). Opened with ?context=paid_bill etc.; defaults to paid_bill.
export default function ContextualShareScreen() {
  const params = useLocalSearchParams<{ context?: string }>();
  const context: ShareContext = VALID.includes(params.context as ShareContext)
    ? (params.context as ShareContext)
    : 'paid_bill';
  const { data, isLoading, isError, refetch } = useContextualPrompt(context);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Share the moment" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.iconWrap}><Sparkles size={22} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.title}>{data.title}</Text>
            <Text style={styles.body}>{data.body}</Text>
          </View>

          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Your message</Text>
            <Text style={styles.previewText}>{data.message}</Text>
          </View>

          <DisclosureCard tone="compliant" body="Share genuine moments. You only earn when invited friends verify and actually transact — never for signups alone." />

          <Pressable
            style={styles.shareBtn}
            onPress={() => Share.share({ message: data.message }).catch(() => {})}
            accessibilityRole="button"
          >
            <Share2 size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.shareText}>Share now</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  iconWrap: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  preview: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 6 },
  previewLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  previewText: { ...Typography.bodyMd, color: Colors.onSurface },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md },
  shareText: { ...Typography.labelLg, color: Colors.onPrimary },
});
