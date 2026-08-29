import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, BadgeCheck, Users, Lock, Play, HandCoins, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SectionHeader from '@/components/SectionHeader';
import { useStorefront } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira } from '@/features/creators/constants/creators.constants';
import type { GatedContent } from '@/features/creators/types';

export default function Storefront() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStorefront(id ?? '');

  const initials = store.data?.creator.displayName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{store.data?.creator.displayName ?? 'Storefront'}</Text>
        <View style={styles.iconBtn} />
      </View>

      {store.isLoading ? (
        <StateView kind="loading" message="Loading storefront…" />
      ) : store.isError || !store.data ? (
        <StateView kind="error" title="Couldn't load storefront" message="Please try again." actionLabel="Retry" onAction={() => store.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Creator header */}
          <View style={styles.hero}>
            <View style={[styles.avatar, { backgroundColor: store.data.creator.avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{store.data.creator.displayName}</Text>
              {store.data.creator.verified ? <BadgeCheck size={18} color={CreatorsColors.accent} /> : null}
            </View>
            <Text style={styles.handle}>{store.data.creator.handle} · {store.data.creator.category}</Text>
            <View style={styles.subsRow}>
              <Users size={14} color={CreatorsColors.muted} />
              <Text style={styles.subsText}>{store.data.creator.subscriberCount.toLocaleString('en-NG')} subscribers</Text>
            </View>
            <Text style={styles.bio}>{store.data.creator.bio}</Text>

            <View style={styles.ctaRow}>
              <PrimaryButton
                label={store.data.isSubscribed ? 'Subscribed' : 'Subscribe'}
                onPress={() => router.push(`/creators/subscribe?creatorId=${store.data!.creator.id}`)}
                disabled={store.data.isSubscribed}
                style={{ flex: 1 }}
              />
              {store.data.creator.acceptsTips ? (
                <Pressable style={styles.tipBtn} onPress={() => router.push(`/creators/tip?creatorId=${store.data!.creator.id}`)}>
                  <HandCoins size={18} color={CreatorsColors.brand} />
                  <Text style={styles.tipText}>Tip</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Content */}
          <SectionHeader title="Content" style={styles.sectionHeader} />
          {store.data.content.length === 0 ? (
            <StateView kind="empty" compact title="No content yet" message="This creator hasn't posted yet." icon="Play" />
          ) : (
            <View style={{ gap: Spacing.sm }}>
              {store.data.content.map((c) => (
                <ContentRow key={c.id} content={c} onPress={() => router.push(`/creators/gated/${c.id}`)} />
              ))}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ContentRow({ content, onPress }: { content: GatedContent; onPress: () => void }) {
  const locked = content.gated && !content.entitled;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
      <View style={[styles.thumb, { backgroundColor: content.thumbColor }]}>
        {locked ? <Lock size={18} color="#FFFFFF" /> : <Play size={18} color="#FFFFFF" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{content.title}</Text>
        <View style={styles.rowMeta}>
          <Text style={styles.rowMetaText}>{content.kind}{content.durationLabel ? ` · ${content.durationLabel}` : ''}</Text>
          {content.ageRestricted ? (
            <View style={styles.ageChip}><ShieldAlert size={11} color={CreatorsColors.danger} /><Text style={styles.ageText}>18+</Text></View>
          ) : null}
        </View>
      </View>
      {locked ? (
        <Text style={styles.lockLabel}>{content.priceKobo ? formatNaira(content.priceKobo) : 'Subscriber'}</Text>
      ) : (
        <Text style={styles.freeLabel}>Open</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  hero: { alignItems: 'center', backgroundColor: CreatorsColors.surface, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...shadow1 },
  avatar: { width: 80, height: 80, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  avatarText: { ...Typography.headlineMd, color: '#FFFFFF' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...Typography.headlineMd, color: CreatorsColors.text },
  handle: { ...Typography.bodyMd, color: CreatorsColors.muted },
  subsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  subsText: { ...Typography.labelSm, color: CreatorsColors.muted },
  bio: { ...Typography.bodySm, color: CreatorsColors.text, textAlign: 'center', marginTop: 6 },
  ctaRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, width: '100%' },
  tipBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: CreatorsColors.brand, borderRadius: Radius.lg, paddingHorizontal: 20, justifyContent: 'center' },
  tipText: { ...Typography.labelLg, color: CreatorsColors.brand },
  sectionHeader: { marginTop: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CreatorsColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  thumb: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.titleMd, color: CreatorsColors.text },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowMetaText: { ...Typography.labelSm, color: CreatorsColors.muted, textTransform: 'capitalize' },
  ageChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: CreatorsColors.dangerBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full },
  ageText: { ...Typography.caption, color: CreatorsColors.danger },
  lockLabel: { ...Typography.labelMd, color: CreatorsColors.brand },
  freeLabel: { ...Typography.labelMd, color: CreatorsColors.ok },
});
