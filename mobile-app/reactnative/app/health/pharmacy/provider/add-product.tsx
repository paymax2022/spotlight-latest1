import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, CircleAlert, Boxes, Pill } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useMyPharmacy, useProviderCatalog, useUpsertProduct } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function ProviderAddProductScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const productId = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : undefined;
  const editing = Boolean(productId);

  const { data: mine, isLoading: mineLoading } = useMyPharmacy();
  const { data: shelf } = useProviderCatalog();
  const save = useUpsertProduct();

  const existing = useMemo(() => (shelf ?? []).find((p) => p.productId === productId), [shelf, productId]);

  const [name, setName] = useState('');
  const [nafdacReg, setNafdacReg] = useState('');
  const [priceNaira, setPriceNaira] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [rxRequired, setRxRequired] = useState(false);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string>();

  // Prefill once the shelf has loaded, so editing starts from the saved values
  // rather than the owner's last keystroke.
  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setNafdacReg(existing.nafdacReg);
    setPriceNaira(String(existing.priceKobo / 100));
    setStockQty(existing.stock > 0 ? String(existing.stock) : '');
    setRxRequired(existing.rxRequired);
    setActive(existing.active);
  }, [existing]);

  if (mineLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={editing ? 'Edit product' : 'List a product'} />
        <StateView kind="loading" message="Checking your pharmacy…" />
      </SafeAreaView>
    );
  }

  // HL-2: POST /products is scoped to the health_providers row that only exists once
  // the pharmacy application is approved, so listing is impossible before that.
  if (!mine?.providerId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={editing ? 'Edit product' : 'List a product'} />
        <StateView
          kind="empty"
          icon="ShieldCheck"
          title="Verification comes first"
          message={
            mine?.businessName
              ? `${mine.businessName} is still being verified. Only an approved pharmacy can list products (HL-2).`
              : 'You need an approved pharmacy before you can list products (HL-2).'
          }
          actionLabel="Go to verification"
          onAction={() => router.replace('/health/pharmacy/provider/onboarding')}
        />
      </SafeAreaView>
    );
  }

  if (editing && !existing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Edit product" />
        <StateView
          kind="empty"
          icon="Boxes"
          title="Product not found"
          message="This line is no longer on your shelf. It may have been removed."
          actionLabel="Back to inventory"
          onAction={() => router.replace('/health/pharmacy/provider/catalog')}
        />
      </SafeAreaView>
    );
  }

  const priceKobo = Math.round((parseFloat(priceNaira.replace(/,/g, '')) || 0) * 100);
  const parsedStock = stockQty.trim() === '' ? 0 : Math.floor(Number(stockQty));
  const canSave = name.trim() !== '' && nafdacReg.trim() !== '' && priceKobo > 0 && !save.isPending;

  const onSave = async () => {
    setError(undefined);
    try {
      await save.mutateAsync({
        providerId: mine.providerId,
        input: {
          id: productId,
          name: name.trim(),
          nafdacReg: nafdacReg.trim(),
          priceKobo,
          rxRequired,
          stockQty: Number.isFinite(parsedStock) && parsedStock > 0 ? parsedStock : 0,
          active,
        },
      });
      router.replace('/health/pharmacy/provider/catalog');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this product.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={editing ? 'Edit product' : 'List a product'}
        subtitle={mine.businessName || 'Your pharmacy'}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.hlStrip}>
          <ShieldCheck size={13} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.hlText}>
            Only NAFDAC-registered products can be listed. A blank or unregistered reference is rejected when you save (HL-5).
          </Text>
        </View>

        <TextInputField
          label="Product name"
          placeholder="e.g. Amoxicillin"
          value={name}
          onChangeText={setName}
        />
        <TextInputField
          label="NAFDAC registration number"
          placeholder="e.g. A4-0123"
          value={nafdacReg}
          onChangeText={setNafdacReg}
          autoCapitalize="characters"
        />
        <TextInputField
          label="Price per unit (₦)"
          placeholder="2850"
          value={priceNaira}
          onChangeText={setPriceNaira}
          keyboardType="decimal-pad"
        />
        {priceKobo > 0 ? (
          <Text style={styles.hint}>{formatNaira(priceKobo)} per unit, charged to the patient at order time.</Text>
        ) : null}

        <TextInputField
          label="Stock on hand (optional)"
          placeholder="Leave blank to sell without tracking"
          value={stockQty}
          onChangeText={setStockQty}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>
          Tracked stock is counted down per order and the listing disappears when it reaches zero. Untracked products stay
          listed regardless of quantity.
        </Text>

        <View style={styles.toggleRow}>
          <View style={styles.toggleBody}>
            <Text style={styles.toggleLabel}>Prescription-only</Text>
            <Text style={styles.toggleSub}>Patients must present a pharmacist-verified e-Rx before this can be dispensed (HL-3).</Text>
          </View>
          <Switch
            value={rxRequired}
            onValueChange={setRxRequired}
            trackColor={{ true: Colors.secondaryContainer, false: Colors.outlineVariant }}
            thumbColor={Colors.white}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleBody}>
            <Text style={styles.toggleLabel}>Listed for sale</Text>
            <Text style={styles.toggleSub}>Turn off to take this line off the shelf without deleting it.</Text>
          </View>
          <Switch
            value={active}
            onValueChange={setActive}
            trackColor={{ true: Colors.secondaryContainer, false: Colors.outlineVariant }}
            thumbColor={Colors.white}
          />
        </View>

        {rxRequired ? (
          <View style={[styles.banner, styles.bannerWarn]}>
            <CircleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
            <Text style={[styles.bannerText, { color: Colors.onWarning }]}>
              Prescription-only medicines are dispensed once against a verified Rx, and only from your own queue.
            </Text>
          </View>
        ) : null}

        <View style={[styles.card, shadow1]}>
          <View style={styles.previewRow}>
            <View style={[styles.iconBox, { backgroundColor: Colors.iconBgTeal }]}>
              <Pill size={16} color={Colors.teal} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewName} numberOfLines={1}>{name.trim() || 'Product name'}</Text>
              <Text style={styles.previewMeta}>
                {nafdacReg.trim() ? `NAFDAC ${nafdacReg.trim().toUpperCase()}` : 'NAFDAC reference required'}
                {rxRequired ? ' · Rx required' : ' · Over the counter'}
              </Text>
            </View>
            <Text style={styles.previewPrice}>{priceKobo > 0 ? formatNaira(priceKobo) : '—'}</Text>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={editing ? 'Save changes' : 'Add to inventory'}
          onPress={onSave}
          loading={save.isPending}
          disabled={!canSave}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  hlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  hlText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 15 },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: -Spacing.xs, marginBottom: Spacing.md, lineHeight: 16 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  bannerWarn: { backgroundColor: Colors.iconBgGold },
  bannerText: { ...Typography.bodySm, flex: 1, lineHeight: 18 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  toggleBody: { flex: 1, gap: 2 },
  toggleLabel: { ...Typography.labelLg, color: Colors.onSurface },
  toggleSub: { ...Typography.caption, color: Colors.onSurfaceVariant, lineHeight: 15 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  previewName: { ...Typography.labelLg, color: Colors.onSurface },
  previewMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  previewPrice: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
