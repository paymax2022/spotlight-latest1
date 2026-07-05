import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CustomerCard from '@/features/stays/components/agent-CustomerCard';
import { useCustomerLookup } from '@/features/stays/agent';

/** Agent: customer lookup / select (PRD §20.1). Booking acts on this identity. */
export default function CustomerLookupScreen() {
  const [q, setQ] = useState('');
  const customers = useCustomerLookup(q);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Find customer" subtitle="Agent-assisted booking" />
      <View style={styles.banner}>
        <ShieldCheck size={16} color={Colors.primary} />
        <Text style={styles.bannerText}>The booking is created on the customer's account — never your own.</Text>
      </View>
      <View style={styles.searchBox}>
        <Search size={18} color={Colors.onSurfaceVariant} />
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder="Search by name, phone or email"
          placeholderTextColor={Colors.onSurfaceVariant}
          autoCapitalize="none"
        />
      </View>

      {customers.isLoading ? (
        <StateView kind="loading" message="Searching customers…" />
      ) : customers.isError ? (
        <StateView kind="error" title="Search failed" actionLabel="Retry" onAction={() => customers.refetch()} />
      ) : (customers.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="UserSearch" title="No customers found" message="Try a different name, phone or email." />
      ) : (
        <FlatList
          data={customers.data}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          renderItem={({ item }) => (
            <CustomerCard
              customer={item}
              onPress={() => router.push({ pathname: '/stays/agent/assisted-search', params: { customerId: item.id } })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  bannerText: { ...Typography.caption, color: Colors.onSurface, flex: 1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  input: { flex: 1, paddingVertical: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
});
