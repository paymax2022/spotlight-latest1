import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ShoppingCart,
  MessageCircle,
  Plus,
  Minus,
  ShieldCheck,
  CircleAlert,
  BadgeCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SymptomDisclaimerBar from '@/features/health/components/SymptomDisclaimerBar';
import { formatNaira } from '@/features/health/constants/health.constants';
import {
  isNotMatched,
  NO_DOSING_COPY,
  type PharmacySkuOption,
  type SymptomClassGroup,
} from '@/features/health/api/symptomSearch.api';
import { useSymptomSearch, useClassSkus } from '@/features/health/api/symptomSearch.hooks';
import { useSymptomSearchStore, skuToCartProduct } from '@/features/health/pharmacy/symptomSearchStore';
import { useCartStore } from '@/features/health/pharmacy/cartStore';

/**
 * Results (PRD §8, Journey A step 3) — tier-branched:
 *  • T1/T2 → therapeutic-class GROUPS (never a single "best drug"), each group a
 *    header + usage note + live SKU cards. Suppressed classes are simply absent.
 *  • T2 additionally gates add-to-cart behind a mandatory "confirm with
 *    pharmacist" step (one-tap free chat).
 *  • T3/T4 → replaced by the full-screen escalation card (no products).
 * Add-to-cart reuses the EXISTING pharmacy cart (cartStore) — one checkout path.
 */
export default function SymptomResultsScreen() {
  const { terms, refiners } = useSymptomSearchStore();
  const { data, isLoading, isError, error, refetch } = useSymptomSearch(terms, refiners);
  const count = useCartStore((s) => s.count());

  // T2 mandatory pharmacist-confirmation step (Journey B / PRD §4 tier table).
  const [chatOpened, setChatOpened] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirmation = Boolean(data?.pharmacist_confirmation_required);
  const addLocked = needsConfirmation && !confirmed;

  // No terms (deep link / stale stack) → back to the symptom home.
  useEffect(() => {
    if (terms.length === 0) router.replace('/health/pharmacy/symptom');
  }, [terms.length]);

  // T3/T4: escalation card is the WHOLE screen — never products (Journey C/D).
  useEffect(() => {
    if (data && (data.tier === 'T3' || data.tier === 'T4')) {
      router.replace('/health/pharmacy/symptom/escalation');
    }
  }, [data]);

  const openPharmacistChat = () => {
    setChatOpened(true);
    router.push('/health/pharmacy/pharmacist-consult');
  };

  const renderBody = () => {
    if (isLoading || terms.length === 0) {
      return <StateView kind="loading" message="Finding options for your symptoms…" />;
    }

    // NEVER dead-end (PRD Goal 2): every failure offers retry + a human.
    if (isError) {
      const notMatched = isNotMatched(error);
      return (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <StateView
            kind={notMatched ? 'empty' : 'error'}
            compact
            icon={notMatched ? 'SearchX' : undefined}
            title={notMatched ? "We couldn't match those words yet" : "Couldn't load options"}
            message={
              notMatched
                ? 'Try different words or the symptom chips — or just ask a pharmacist directly, free of charge.'
                : 'Check your connection and try again — or ask a pharmacist directly, free of charge.'
            }
            actionLabel={notMatched ? 'Try different words' : 'Retry'}
            onAction={notMatched ? () => router.back() : () => refetch()}
          />
          <Pressable style={[styles.fallbackCard, shadow1]} onPress={openPharmacistChat}>
            <View style={[styles.fallbackIcon, { backgroundColor: Colors.iconBgBlue }]}>
              <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.fallbackTitle}>Speak to a pharmacist — free</Text>
              <Text style={styles.fallbackSub}>Describe your symptoms in chat and get guided options.</Text>
            </View>
          </Pressable>
        </ScrollView>
      );
    }

    if (!data || data.tier === 'T3' || data.tier === 'T4') {
      // Redirecting to the escalation screen.
      return <StateView kind="loading" message="One moment…" />;
    }

    const groups = [...(data.class_groups ?? [])].sort((a, b) => a.rank - b.rank);

    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.forLine}>Options for: {terms.join(' · ')}</Text>

        {/* T2 — mandatory pharmacist confirmation before add-to-cart (fail-closed) */}
        {needsConfirmation ? (
          <View style={[styles.confirmCard, confirmed && styles.confirmCardDone]}>
            <View style={styles.confirmHead}>
              {confirmed ? (
                <BadgeCheck size={18} color={Colors.teal} strokeWidth={2} />
              ) : (
                <CircleAlert size={18} color={Colors.onWarning} strokeWidth={2} />
              )}
              <Text style={[styles.confirmTitle, confirmed && styles.confirmTitleDone]}>
                {confirmed ? 'Pharmacist confirmation noted' : 'Confirm with a pharmacist first'}
              </Text>
            </View>
            {!confirmed ? (
              <>
                <Text style={styles.confirmBody}>
                  For your situation, a pharmacist should confirm these options before you buy. The chat is free
                  and takes a minute.
                </Text>
                <PrimaryButton label="Chat with a pharmacist — free" onPress={openPharmacistChat} />
                {chatOpened ? (
                  <Pressable onPress={() => setConfirmed(true)} style={styles.confirmDoneBtn} accessibilityRole="button">
                    <Text style={styles.confirmDoneText}>A pharmacist confirmed my options</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {groups.length === 0 ? (
          <StateView
            kind="empty"
            compact
            icon="Pill"
            title="No suitable options to show"
            message="A pharmacist can guide you personally — free of charge."
            actionLabel="Ask a pharmacist"
            onAction={openPharmacistChat}
          />
        ) : (
          groups.map((g) => <ClassGroupSection key={g.class_id} group={g} addLocked={addLocked} />)
        )}

        <View style={styles.safety}>
          <ShieldCheck size={13} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.safetyText}>
            All options are NAFDAC-registered. {NO_DOSING_COPY}
          </Text>
        </View>

        {count > 0 ? (
          <Pressable style={[styles.cartCta, shadow1]} onPress={() => router.push('/health/pharmacy/cart')}>
            <ShoppingCart size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.cartCtaText}>View cart · {count} item{count > 1 ? 's' : ''}</Text>
            <Text style={styles.cartCtaAmount}>{formatNaira(useCartStore.getState().cart().subtotalKobo)}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Your options"
        subtitle="General options for your symptoms"
        rightSlot={
          <Pressable onPress={() => router.push('/health/pharmacy/cart')} hitSlop={8} accessibilityLabel="Cart">
            <ShoppingCart size={22} color={Colors.primary} strokeWidth={2} />
            {count > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{count}</Text>
              </View>
            ) : null}
          </Pressable>
        }
      />
      {renderBody()}
      <SymptomDisclaimerBar />
    </SafeAreaView>
  );
}

/** One therapeutic-class group: header + usage note + live SKUs. */
function ClassGroupSection({ group, addLocked }: { group: SymptomClassGroup; addLocked: boolean }) {
  const { refiners } = useSymptomSearchStore();
  const { data: skus, isLoading, isError, refetch } = useClassSkus(group.class_id, refiners.who);

  return (
    <View style={styles.group}>
      <Text style={styles.groupName}>{group.name}</Text>
      {group.usage_note ? <Text style={styles.groupNote}>{group.usage_note}</Text> : null}

      {isLoading ? (
        <StateView kind="loading" compact message="Checking live stock…" />
      ) : isError ? (
        <StateView kind="error" compact hideIcon title="Couldn't load products" actionLabel="Retry" onAction={refetch} />
      ) : (skus ?? []).length === 0 ? (
        <Text style={styles.groupEmpty}>No stock nearby right now.</Text>
      ) : (
        (skus ?? []).map((sku) => <SkuRow key={sku.id} sku={sku} addLocked={addLocked} />)
      )}
    </View>
  );
}

/** SKU card — brand, pack size, ₦ price from kobo, EXISTING-cart add controls. */
function SkuRow({ sku, addLocked }: { sku: PharmacySkuOption; addLocked: boolean }) {
  const add = useCartStore((s) => s.add);
  const setQty = useCartStore((s) => s.setQty);
  const line = useCartStore((s) => s.lines.find((l) => l.productId === sku.product_id));
  const capped = sku.max_qty_per_window != null && (line?.qty ?? 0) >= sku.max_qty_per_window;
  const disabled = !sku.in_stock || addLocked;

  return (
    <View style={[styles.sku, shadow1]}>
      <View style={styles.flex}>
        <Text style={styles.skuName} numberOfLines={1}>
          {sku.name}
          {sku.classification === 'PHARMACY_ONLY' ? <Text style={styles.pharmOnly}>  · Pharmacy-only</Text> : null}
        </Text>
        <Text style={styles.skuMeta} numberOfLines={1}>
          {sku.brand} · {sku.pack_size}
        </Text>
        <Text style={styles.skuNafdac} numberOfLines={1}>NAFDAC {sku.nafdac_reg_no}</Text>
        <Text style={styles.skuPrice}>{formatNaira(sku.price_kobo)}</Text>
        {!sku.in_stock ? <Text style={styles.oos}>Out of stock</Text> : null}
      </View>

      {line ? (
        <View style={styles.stepper}>
          <Pressable onPress={() => setQty(sku.product_id, line.qty - 1)} hitSlop={6} style={styles.stepBtn} accessibilityLabel="Decrease quantity">
            <Minus size={15} color={Colors.primary} strokeWidth={2.5} />
          </Pressable>
          <Text style={styles.stepQty}>{line.qty}</Text>
          <Pressable
            onPress={() => !capped && setQty(sku.product_id, line.qty + 1)}
            hitSlop={6}
            style={[styles.stepBtn, capped && styles.stepBtnOff]}
            accessibilityLabel="Increase quantity"
          >
            <Plus size={15} color={capped ? Colors.outline : Colors.primary} strokeWidth={2.5} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => !disabled && add(skuToCartProduct(sku))}
          style={[styles.addBtn, disabled && styles.addBtnOff]}
          accessibilityRole="button"
          accessibilityLabel={addLocked ? 'Confirm with a pharmacist to add' : `Add ${sku.name} to cart`}
        >
          <Plus size={16} color={disabled ? Colors.outline : Colors.onPrimary} strokeWidth={2.5} />
          <Text style={[styles.addText, disabled && styles.addTextOff]}>Add</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.lg },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { ...Typography.caption, color: Colors.onSecondary, fontWeight: '700' as const, fontSize: 10 },
  forLine: { ...Typography.labelMd, color: Colors.onSurfaceVariant },

  confirmCard: {
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  confirmCardDone: { backgroundColor: Colors.iconBgTeal },
  confirmHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  confirmTitle: { ...Typography.labelLg, color: Colors.onWarning, flex: 1 },
  confirmTitleDone: { color: Colors.teal },
  confirmBody: { ...Typography.bodySm, color: Colors.onWarning, lineHeight: 19 },
  confirmDoneBtn: { alignSelf: 'center', paddingVertical: Spacing.xs },
  confirmDoneText: { ...Typography.labelMd, color: Colors.secondary },

  group: { gap: Spacing.xs },
  groupName: { ...Typography.titleMd, color: Colors.onSurface },
  groupNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: 2 },
  groupEmpty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },

  sku: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginTop: Spacing.xs,
  },
  skuName: { ...Typography.labelLg, color: Colors.onSurface },
  pharmOnly: { ...Typography.caption, color: Colors.secondary },
  skuMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  skuNafdac: { ...Typography.caption, color: Colors.teal },
  skuPrice: { ...Typography.labelLg, fontSize: 15, color: Colors.primary, marginTop: 2 },
  oos: { ...Typography.caption, color: Colors.error, marginTop: 1 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 36,
  },
  addBtnOff: { backgroundColor: Colors.surfaceContainerHigh },
  addText: { ...Typography.labelMd, color: Colors.onPrimary },
  addTextOff: { color: Colors.outline },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { borderColor: Colors.outlineVariant },
  stepQty: { ...Typography.labelLg, color: Colors.onSurface, minWidth: 18, textAlign: 'center' },

  fallbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  fallbackIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  fallbackTitle: { ...Typography.labelLg, color: Colors.onSurface },
  fallbackSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  safety: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 8,
  },
  safetyText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 15 },

  cartCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cartCtaText: { ...Typography.labelLg, color: Colors.onPrimary, flex: 1 },
  cartCtaAmount: { ...Typography.labelLg, color: Colors.onPrimary },
});
