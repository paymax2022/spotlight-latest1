import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Trash2, Plus, Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import SummaryRow from '@/features/fx/components/SummaryRow';
import { useSettings, useAddStablecoinAddress, useRemoveStablecoinAddress } from '@/features/fx/hooks/useFxAccount';
import { maskAccount } from '@/features/fx/utils/fxFormatters';

const ASSETS = ['USDC', 'USDT'];
const NETWORKS = ['Ethereum', 'Base', 'Tron', 'Polygon'];

export default function StablecoinAddressesScreen() {
  const { data, isLoading } = useSettings();
  const add = useAddStablecoinAddress();
  const remove = useRemoveStablecoinAddress();

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [asset, setAsset] = useState('USDC');
  const [network, setNetwork] = useState('Base');
  const [address, setAddress] = useState('');

  const ready = label.trim() && address.trim().length >= 10;

  const save = async () => {
    await add.mutateAsync({ label, asset: asset as 'USDC' | 'USDT', network, address });
    setAdding(false); setLabel(''); setAddress('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Stablecoin addresses"
        rightSlot={!adding ? <Pressable onPress={() => setAdding(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add address"><Plus size={22} color={Colors.secondary} strokeWidth={2} /></Pressable> : undefined}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {isLoading || !data ? <StateView kind="loading" /> : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {adding ? (
              <View style={styles.form}>
                <Text style={styles.formTitle}>New address</Text>
                <TextInputField label="Label" value={label} onChangeText={setLabel} placeholder="e.g. My USDC wallet" autoCapitalize="words" />
                <SelectField label="Asset" value={asset} options={ASSETS} searchable={false} onChange={setAsset} />
                <SelectField label="Network" value={network} options={NETWORKS} searchable={false} onChange={setNetwork} />
                <TextInputField label="Wallet address" value={address} onChangeText={setAddress} placeholder="0x… or T…" autoCapitalize="none" autoCorrect={false} />
                <View style={styles.formActions}>
                  <PrimaryButton label="Cancel" variant="secondary" onPress={() => setAdding(false)} fullWidth={false} style={styles.flexBtn} />
                  <PrimaryButton label="Save address" onPress={save} loading={add.isPending} disabled={!ready} fullWidth={false} style={styles.flexBtn} />
                </View>
              </View>
            ) : null}

            {data.stablecoinAddresses.length === 0 && !adding ? (
              <StateView kind="empty" icon="Coins" title="No linked addresses" message="Link a stablecoin wallet to receive or settle in USDC/USDT." actionLabel="Add address" onAction={() => setAdding(true)} compact />
            ) : (
              data.stablecoinAddresses.map((a) => (
                <View key={a.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={styles.assetRow}>
                      <View style={styles.assetIcon}><Coins size={16} color={Colors.teal} strokeWidth={2} /></View>
                      <View>
                        <Text style={styles.label}>{a.label}</Text>
                        <Text style={styles.net}>{a.asset} · {a.network}</Text>
                      </View>
                    </View>
                    <Pressable onPress={() => remove.mutate(a.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${a.label}`}>
                      <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                    </Pressable>
                  </View>
                  <SummaryRow label="Address" value={maskAccount(a.address)} copyable />
                </View>
              ))
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  form: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  formTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  formActions: { flexDirection: 'row', gap: Spacing.sm },
  flexBtn: { flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  assetIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  net: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
