import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { useOrders } from '@/features/food/hooks';
import { OrderListRow } from '@/features/food/components';

export default function CustomerOrdersScreen() {
  const { data, isLoading, isError, refetch } = useOrders('customer', { poll: true });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>My orders</Text>
        <View style={s.iconButton} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading your orders…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load orders" actionLabel="Retry" onAction={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="ReceiptText" title="No orders yet" message="Your food orders will appear here." actionLabel="Browse restaurants" onAction={() => router.replace('/food')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          {data.map((order) => (
            <OrderListRow key={order.id} order={order} onPress={() => router.push(`/food/orders/${order.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin },
});
