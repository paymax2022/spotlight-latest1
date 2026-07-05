import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, ChevronRight, User } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useCustomerLookup } from '@/features/insurance/agent';
import { InsuranceColors, formatNaira, TIER_LABEL } from '@/features/insurance/constants/insurance.constants';
import type { AgentCustomer } from '@/features/insurance/agent';

/** Agent: customer lookup / select (PRD §15.2). Assisted-sale subject. */
export default function CustomerLookup() {
  const [query, setQuery] = useState('');
  const customers = useCustomerLookup(query);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Find a customer" subtitle="Assisted sales" />

      <View style={styles.searchWrap}>
        <TextInputField
          value={query}
          onChangeText={setQuery}
          placeholder="Search name or phone number"
          leftIcon={<Search size={18} color={Colors.onSurfaceVariant} />}
          autoCapitalize="none"
        />
      </View>

      {customers.isLoading ? (
        <StateView kind="loading" message="Searching customers…" />
      ) : customers.isError ? (
        <StateView kind="error" title="Couldn't search" actionLabel="Retry" onAction={() => customers.refetch()} />
      ) : (customers.data ?? []).length === 0 ? (
        <StateView kind="empty" title="No customers found" message="Try a different name or phone number." icon="User" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {(customers.data ?? []).map((c) => (
            <CustomerRow key={c.id} customer={c} onPress={() => router.push(`/insurance/agent/recommend?customerId=${c.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CustomerRow({ customer, onPress }: { customer: AgentCustomer; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.avatar}><User size={20} color={InsuranceColors.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{customer.fullName}</Text>
        <Text style={styles.meta}>{customer.phone} · {customer.location}</Text>
        <Text style={styles.meta}>Wallet {formatNaira(customer.walletKobo)} · {TIER_LABEL[customer.kycTier]}</Text>
      </View>
      <ChevronRight size={20} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  searchWrap: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: InsuranceColors.border, padding: Spacing.md,
  },
  pressed: { opacity: 0.9 },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
