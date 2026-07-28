import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useSharePayload } from '@/features/referral/invite/hooks';

// M-INV-02 — Share by name (Mention-Me style): a friend redeems by typing the
// referrer's name at signup, no code needed.
export default function ShareByNameScreen() {
  const { data, isLoading, isError, refetch } = useSharePayload();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Share by name" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.nameCard}>
            <View style={styles.iconWrap}><Sparkles size={22} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.nameLabel}>Friends can redeem with your name</Text>
            <Text style={styles.name}>{data.referrerName}</Text>
            <Text style={styles.nameHint}>At signup, they choose "I was referred by a friend" and type your name — no code to remember.</Text>
          </View>

          <DisclosureCard
            tone="compliant"
            title="It still depends on real activity"
            body="Being named gets the attribution right, but you only earn once your friend verifies and genuinely uses Paymax."
          />

          <Pressable
            style={styles.shareBtn}
            onPress={() => Share.share({ message: `Sign up for Spotlight/Paymax and choose "referred by a friend" — my name is ${data.referrerName}. We both earn only when you actually use it.` }).catch(() => {})}
            accessibilityRole="button"
          >
            <Share2 size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.shareText}>Share instructions</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  nameCard: { alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  iconWrap: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  nameLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  name: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' as const },
  nameHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md },
  shareText: { ...Typography.labelLg, color: Colors.onPrimary },
});
