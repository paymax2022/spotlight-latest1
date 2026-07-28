import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Plus, ChevronRight, Wallet, PiggyBank, ReceiptText, HeartHandshake,
  Building2, LifeBuoy, Calendar, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatNaira, formatDate, daysUntil } from '@/features/academy/constants';
import { useFeesChildren, useVaults } from '@/features/academy/fees/hooks';
import type { FeesChild } from '@/features/academy/fees/types';

/** PA-02 — Family fees dashboard: children + balances, entry into every fees flow. */
export default function FeesFamilyDashboard() {
  const children = useFeesChildren();
  const vaults = useVaults();

  if (children.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="School fees" subtitle="Your family" />
        <StateView kind="loading" message="Loading your family…" />
      </SafeAreaView>
    );
  }
  if (children.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="School fees" />
        <StateView kind="error" title="Couldn't load fees" message="Please try again." actionLabel="Retry" onAction={() => children.refetch()} />
      </SafeAreaView>
    );
  }

  const kids = children.data ?? [];
  const totalOutstanding = kids.reduce((s, c) => s + c.outstandingKobo, 0);
  const totalSaved = vaults.data?.reduce((s, v) => s + v.savedKobo, 0) ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="School fees"
        subtitle="Your family"
        rightSlot={
          <Pressable onPress={() => router.push('/learn/academy/fees/onboarding')} hitSlop={8} accessibilityLabel="Link a child">
            <Plus size={22} color={Colors.primary} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={children.isRefetching} onRefresh={() => { children.refetch(); vaults.refetch(); }} tintColor={Colors.primary} />}
      >
        {/* Outstanding balance summary */}
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.summary, shadow3]}>
          <Text style={styles.summaryKicker}>TOTAL OUTSTANDING</Text>
          <Text style={styles.summaryAmount}>{formatNaira(totalOutstanding)}</Text>
          <View style={styles.summaryRow}>
            <PiggyBank size={15} color={Colors.gold} />
            <Text style={styles.summarySub}>{formatNaira(totalSaved)} saved across your vaults</Text>
          </View>
        </LinearGradient>

        {/* Children */}
        <Text style={styles.section}>Children</Text>
        {kids.length ? kids.map((c) => <ChildCard key={c.id} c={c} />) : (
          <StateView kind="empty" icon="Users" title="No children linked" message="Link a child to see their invoices and balances." actionLabel="Link a child" onAction={() => router.push('/learn/academy/fees/onboarding')} compact />
        )}

        {/* Quick links */}
        <Text style={styles.section}>Manage</Text>
        <View style={styles.grid}>
          <QuickLink icon={PiggyBank} label="Fees vault" onPress={() => router.push('/learn/academy/fees/vault')} />
          <QuickLink icon={ReceiptText} label="Receipts" onPress={() => router.push('/learn/academy/fees/receipts')} />
          <QuickLink icon={HeartHandshake} label="Sponsor a student" onPress={() => router.push('/learn/academy/fees/sponsor')} />
          <QuickLink icon={LifeBuoy} label="Hardship help" onPress={() => router.push('/learn/academy/fees/hardship')} />
          <QuickLink icon={Building2} label="School directory" onPress={() => router.push('/learn/academy/fees/directory')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChildCard({ c }: { c: FeesChild }) {
  const hasBalance = c.outstandingKobo > 0;
  const days = c.nextDueDate ? daysUntil(c.nextDueDate) : undefined;
  const urgent = days !== undefined && days <= 14;
  return (
    <Pressable
      style={[styles.childCard, shadow1]}
      onPress={() => c.linked
        ? router.push(`/learn/academy/fees/invoices/${c.id}`)
        : router.push('/learn/academy/fees/onboarding')}
    >
      <View style={[styles.avatar, { backgroundColor: (Colors as unknown as Record<string, string>)[c.avatarColorKey] ?? Colors.iconBgPurple }]}>
        <Text style={styles.avatarText}>{c.firstName.charAt(0)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.childHead}>
          <Text style={styles.childName}>{c.firstName} {c.lastName}</Text>
          {!c.linked ? <Chip label="Link pending" color={Colors.onWarning} bg={Colors.iconBgGold} small />
            : hasBalance ? <Chip label="Balance due" color={Colors.error} bg={Colors.errorContainer} small />
              : <Chip label="Up to date" color={Colors.teal} bg={Colors.iconBgTeal} small />}
        </View>
        <Text style={styles.childMeta}>{c.schoolName} · {c.classLabel}</Text>
        {c.linked ? (
          <View style={styles.childBottom}>
            <Text style={[styles.childBalance, hasBalance && { color: Colors.error }]}>
              {hasBalance ? formatNaira(c.outstandingKobo) : 'No fees due'}
            </Text>
            {c.nextDueDate ? (
              <View style={styles.dueChip}>
                {urgent ? <AlertCircle size={12} color={Colors.error} /> : <Calendar size={12} color={Colors.onSurfaceVariant} />}
                <Text style={[styles.dueText, urgent && { color: Colors.error }]}>Due {formatDate(c.nextDueDate)}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={styles.linkPrompt}>Tap to link with the school →</Text>
        )}
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

function QuickLink({ icon: Icon, label, onPress }: { icon: typeof Wallet; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.quick, shadow1]} onPress={onPress}>
      <View style={styles.quickIcon}><Icon size={20} color={Colors.primary} /></View>
      <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  summary: { borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  summaryKicker: { ...Typography.labelSm, color: Colors.inversePrimary, letterSpacing: 1, fontWeight: '700' },
  summaryAmount: { ...Typography.displayLg, color: Colors.onPrimary },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  summarySub: { ...Typography.labelSm, color: Colors.inversePrimary },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  childHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  childName: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  childMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  childBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  childBalance: { ...Typography.labelLg, color: Colors.teal, fontWeight: '700' },
  dueChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  linkPrompt: { ...Typography.bodySm, color: Colors.secondary, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quick: { width: '31%', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, minHeight: 92 },
  quickIcon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface },
});
