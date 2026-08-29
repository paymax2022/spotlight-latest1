import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldCheck, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import { useAssets, useScreenAddress, useAddAddress } from '@/features/crypto/hooks/useCrypto';
import { WHITELIST_DISCLOSURE } from '@/features/crypto/constants/crypto.constants';

export default function NewAddressScreen() {
  const params = useLocalSearchParams<{ symbol?: string }>();
  const assets = useAssets();
  const tradable = useMemo(() => (assets.data ?? []).filter((a) => a.status === 'active' && a.withdrawalEnabled), [assets.data]);

  const [symbolId, setSymbolId] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');

  const screen = useScreenAddress();
  const add = useAddAddress();

  const selected =
    tradable.find((a) => a.id === symbolId) ??
    tradable.find((a) => a.symbol === params.symbol) ??
    tradable[0];
  const networks = selected?.supportedNetworks ?? [];
  const activeNetwork = networks.find((n) => n.id === networkId) ?? networks[0];

  if (assets.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Add address" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (!selected || !activeNetwork) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Add address" />
        <StateView kind="empty" icon="BookMarked" title="No assets available" message="No withdrawable assets right now." />
      </SafeAreaView>
    );
  }

  const flagged = screen.data?.risk === 'flagged';
  const cleared = screen.data?.risk === 'clear';
  const canSave = address.trim().length > 0 && cleared && !add.isPending;

  const runScreen = () => { if (address.trim()) screen.mutate(address.trim()); };

  const save = async () => {
    await add.mutateAsync({ label: label.trim(), symbol: selected.symbol, networkId: activeNetwork.id, address: address.trim() });
    goBack('/crypto/addresses');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add address" subtitle="Whitelist a withdrawal destination" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Asset chooser */}
        <Text style={styles.label}>Asset</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {tradable.map((a) => {
            const active = a.id === selected.id;
            return (
              <Pressable key={a.id} onPress={() => { setSymbolId(a.id); setNetworkId(null); screen.reset(); }} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <AssetIcon symbol={a.symbol} color={a.iconColor} size={24} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.symbol}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Network chooser */}
        <Text style={[styles.label, styles.mt]}>Network</Text>
        <View style={styles.netRow}>
          {networks.map((n) => {
            const active = n.id === activeNetwork.id;
            return (
              <Pressable key={n.id} onPress={() => { setNetworkId(n.id); screen.reset(); }} style={[styles.netChip, active && styles.netChipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.netText, active && styles.netTextActive]}>{n.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.netWarn}>
          <TriangleAlert size={13} color={Colors.onWarning} strokeWidth={2} />
          <Text style={styles.netWarnText}>Send only {selected.symbol} on {activeNetwork.name}. Sending another asset or using the wrong network will lose your funds.</Text>
        </View>

        {/* Label + address */}
        <View style={styles.mt}>
          <TextInputField label="Label" placeholder="e.g. My Ledger" value={label} onChangeText={setLabel} maxLength={32} />
          <TextInputField
            label="Wallet address"
            placeholder={`Paste the ${selected.symbol} address`}
            value={address}
            onChangeText={(t) => { setAddress(t); screen.reset(); }}
            autoCapitalize="none"
            autoCorrect={false}
            onBlur={runScreen}
          />
        </View>

        {/* Screening result */}
        {screen.isPending ? (
          <View style={styles.screenRow}>
            <ShieldCheck size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.screenText}>Screening address…</Text>
          </View>
        ) : flagged ? (
          <View style={[styles.screenBox, styles.screenBoxBad]}>
            <ShieldAlert size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.screenBadText}>{screen.data?.reason ?? 'This address could not be verified.'}</Text>
          </View>
        ) : cleared ? (
          <View style={[styles.screenBox, styles.screenBoxOk]}>
            <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.screenOkText}>Address screened and cleared. It will be whitelisted on save.</Text>
          </View>
        ) : null}

        {/* Whitelist disclosure */}
        <View style={styles.disc}>
          <Text style={styles.discText}>{WHITELIST_DISCLOSURE}</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {cleared ? (
          <PrimaryButton label="Whitelist address" onPress={save} loading={add.isPending} disabled={!canSave} />
        ) : (
          <PrimaryButton label={screen.isPending ? 'Screening…' : 'Screen address'} onPress={runScreen} loading={screen.isPending} disabled={!address.trim() || screen.isPending} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  mt: { marginTop: Spacing.md },
  chipRow: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.sm + 2, paddingVertical: 6,
  },
  chipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  netRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  netChip: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  netChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  netText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  netTextActive: { color: Colors.primary },
  netWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
  netWarnText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  screenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  screenText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  screenBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: Spacing.md, borderRadius: Radius.lg, padding: Spacing.md },
  screenBoxOk: { backgroundColor: Colors.iconBgTeal },
  screenBoxBad: { backgroundColor: Colors.errorContainer },
  screenOkText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  screenBadText: { ...Typography.labelSm, color: Colors.error, flex: 1, lineHeight: 18 },
  disc: { marginTop: Spacing.lg },
  discText: { ...Typography.caption, color: Colors.onSurfaceVariant, lineHeight: 16 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
