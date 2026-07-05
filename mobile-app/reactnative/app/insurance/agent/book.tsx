import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, TrendingUp } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useAgentBook } from '@/features/insurance/agent';
import { POLICY_STATE_LABEL, InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';
import type { AgentBookEntry } from '@/features/insurance/agent';

/** Agent: policy book — policies this agent sold, attached to customers (PRD §15.2/§16). */
export default function AgentBook() {
  const book = useAgentBook();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My book"
        subtitle="Policies you've sold"
        rightSlot={
          <Pressable onPress={() => router.push('/insurance/agent/commission')} hitSlop={10} accessibilityLabel="Commission">
            <TrendingUp size={22} color={InsuranceColors.brand} />
          </Pressable>
        }
      />

      {book.isLoading ? (
        <StateView kind="loading" message="Loading your book…" />
      ) : book.isError ? (
        <StateView kind="error" title="Couldn't load book" actionLabel="Retry" onAction={() => book.refetch()} />
      ) : (book.data ?? []).length === 0 ? (
        <StateView
          kind="empty"
          title="No policies yet"
          message="Find a customer and sell your first policy."
          icon="ClipboardList"
          actionLabel="Find a customer"
          onAction={() => router.push('/insurance/agent/customer-lookup')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {(book.data ?? []).map((b) => (
            <BookRow key={b.policyId} entry={b} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BookRow({ entry }: { entry: AgentBookEntry }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/insurance/agent/assisted-claim?customerId=${entry.customerId}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{entry.productName}</Text>
          <Text style={styles.sub} numberOfLines={1}>{entry.customerName} · {POLICY_STATE_LABEL[entry.state] ?? entry.state}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>Premium {formatNaira(entry.premiumKobo)}</Text>
        <Text style={styles.commission}>+{formatNaira(entry.commissionKobo)} commission</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  commission: { ...Typography.labelLg, color: InsuranceColors.ok },
});
