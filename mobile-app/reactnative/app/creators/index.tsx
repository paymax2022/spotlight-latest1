import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Search, Sparkles, Wallet, BookOpen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import CreatorStorefrontCard from '@/features/creators/components/creator-StorefrontCard';
import { useCreators } from '@/features/creators/hooks';
import { CreatorsColors } from '@/features/creators/constants/creators.constants';

export default function CreatorsDiscover() {
  const [query, setQuery] = useState('');
  const creators = useCreators(query);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Creators</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={CreatorsColors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search creators, categories…"
          placeholderTextColor={CreatorsColors.muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      </View>

      {creators.isLoading ? (
        <StateView kind="loading" message="Finding creators…" />
      ) : creators.isError ? (
        <StateView kind="error" title="Couldn't load creators" message="Please try again." actionLabel="Retry" onAction={() => creators.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Quick links */}
          <View style={styles.quickRow}>
            <Pressable style={styles.quick} onPress={() => router.push('/creators/become-creator')}>
              <View style={styles.quickIcon}><Sparkles size={18} color={CreatorsColors.brand} /></View>
              <Text style={styles.quickText}>Become a creator</Text>
            </Pressable>
            <Pressable style={styles.quick} onPress={() => router.push('/creators/my-subscriptions')}>
              <View style={styles.quickIcon}><BookOpen size={18} color={CreatorsColors.brand} /></View>
              <Text style={styles.quickText}>My subscriptions</Text>
            </Pressable>
            <Pressable style={styles.quick} onPress={() => router.push('/creators/earnings')}>
              <View style={styles.quickIcon}><Wallet size={18} color={CreatorsColors.brand} /></View>
              <Text style={styles.quickText}>Earnings</Text>
            </Pressable>
          </View>

          <SectionHeader title={query ? 'Results' : 'Discover creators'} style={styles.sectionHeader} />

          {(creators.data?.length ?? 0) === 0 ? (
            <StateView kind="empty" compact title="No creators found" message="Try a different search." icon="Search" />
          ) : (
            <View style={{ gap: Spacing.md }}>
              {creators.data!.map((c) => (
                <CreatorStorefrontCard key={c.id} creator={c} onPress={() => router.push(`/creators/storefront/${c.id}`)} />
              ))}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md, height: 48, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, paddingVertical: 0 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  quickRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  quick: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md },
  quickIcon: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: CreatorsColors.brandBg },
  quickText: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  sectionHeader: { marginTop: Spacing.sm },
});
