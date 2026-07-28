import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Trash2, ShieldCheck, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import { useAddresses, useAssets, useDeleteAddress } from '@/features/crypto/hooks/useCrypto';

/** Mask a wallet address for list display: first 6 + last 4. */
function maskAddress(value: string): string {
  const v = value.replace(/\s/g, '');
  if (v.length <= 12) return v;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export default function CryptoAddressesScreen() {
  // `select=1` + `symbol` come from the withdrawal entry — picking returns the id.
  const params = useLocalSearchParams<{ select?: string; symbol?: string }>();
  const selecting = params.select === '1';
  const { data, isLoading, isError, refetch } = useAddresses(params.symbol);
  const assets = useAssets();
  const del = useDeleteAddress();
  const colorFor = (symbol: string) => assets.data?.find((a) => a.symbol === symbol)?.iconColor ?? Colors.primary;

  const pick = (id: string) => {
    if (selecting) router.replace({ pathname: '/crypto/withdraw', params: { symbol: params.symbol, addressId: id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Address book"
        subtitle={selecting ? 'Choose a destination' : 'Whitelisted withdrawal addresses'}
        rightSlot={
          <Pressable onPress={() => router.push({ pathname: '/crypto/addresses/new', params: { symbol: params.symbol } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add address">
            <Plus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading addresses…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load addresses" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="BookMarked" title="No saved addresses"
          message="Add and whitelist an address before you can withdraw to it."
          actionLabel="Add address" onAction={() => router.push({ pathname: '/crypto/addresses/new', params: { symbol: params.symbol } })}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => pick(item.id)}
              disabled={!selecting}
              accessibilityRole={selecting ? 'button' : undefined}
            >
              <AssetIcon symbol={item.symbol} color={colorFor(item.symbol)} />
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text style={styles.label}>{item.label}</Text>
                  {item.whitelisted ? <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} /> : null}
                </View>
                <Text style={styles.addr} numberOfLines={1}>{maskAddress(item.address)}</Text>
                <Text style={styles.meta}>{item.symbol} · {item.networkName}</Text>
              </View>
              {selecting ? (
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              ) : (
                <Pressable onPress={() => del.mutate(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete address">
                  <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  addr: { ...Typography.bodySm, color: Colors.onSurface, marginTop: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
