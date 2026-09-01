import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import { useRestaurant } from '@/features/food/hooks';
import { useCartStore, cartItemCount, cartSubtotalKobo, MAX_SAME_FOOD_PER_PACKAGE } from '@/features/food/cartStore';
import { packsForRestaurant } from '@/features/food/packScope';
import { formatNaira, formatNairaWhole } from '@/features/food/utils';
import { DynamicIcon } from '@/features/food/components';
import type { MenuItem } from '@/features/food/types';
import { DishNutritionBlock } from '@/features/nutrition';

function MenuRow({
  item,
  qty,
  onAdd,
  onRemove,
}: {
  item: MenuItem;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const [showNutrition, setShowNutrition] = React.useState(false);
  return (
    <View style={[mr.wrap, !item.available && { opacity: 0.5 }]}>
    <View style={mr.row}>
      <View style={mr.body}>
        <Text style={mr.name}>{item.name}</Text>
        {item.description ? (
          <Text style={mr.desc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text style={mr.price}>{formatNaira(item.priceKobo)}</Text>
        {/* Nutrition + allergen disclosure (honest, additive). */}
        <Pressable
          onPress={() => setShowNutrition((v) => !v)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={showNutrition ? 'Hide nutrition' : 'Show nutrition & allergens'}
          style={mr.nutriToggle}
        >
          <Icons.Leaf size={13} color={Colors.tertiaryContainer} strokeWidth={2.2} />
          <Text style={mr.nutriToggleText}>
            {showNutrition ? 'Hide nutrition & allergens' : 'Nutrition & allergens'}
          </Text>
          <Icons.ChevronDown
            size={14}
            color={Colors.onSurfaceVariant}
            strokeWidth={2.2}
            style={{ transform: [{ rotate: showNutrition ? '180deg' : '0deg' }] }}
          />
        </Pressable>
        {!item.available ? <Text style={mr.unavailable}>Unavailable</Text> : null}
      </View>
      {item.available ? (
        qty > 0 ? (
          <View style={mr.stepper}>
            <Pressable onPress={onRemove} style={mr.stepBtn} accessibilityLabel="Remove one">
              <Icons.Minus size={16} color={Colors.primary} strokeWidth={2.4} />
            </Pressable>
            <Text style={mr.qty}>{qty}</Text>
            <Pressable onPress={onAdd} style={mr.stepBtn} accessibilityLabel="Add one">
              <Icons.Plus size={16} color={Colors.primary} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onAdd} style={({ pressed }) => [mr.addBtn, pressed && { opacity: 0.85 }]} accessibilityLabel={`Add ${item.name}`}>
            <Icons.Plus size={18} color={Colors.white} strokeWidth={2.6} />
          </Pressable>
        )
      ) : null}
    </View>
    {showNutrition ? (
      <View style={mr.nutriBlock}>
        <DishNutritionBlock dishId={item.id} />
      </View>
    ) : null}
    </View>
  );
}

const mr = StyleSheet.create({
  wrap: {
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  nutriToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  nutriToggleText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  nutriBlock: { paddingTop: Spacing.sm },
  body: { flex: 1, gap: 2 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  price: { ...Typography.labelMd, color: Colors.secondary, marginTop: 2 },
  unavailable: { ...Typography.labelSm, color: Colors.error, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepBtn: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  qty: { ...Typography.labelLg, color: Colors.onSurface, minWidth: 18, textAlign: 'center' },
});

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: restaurant, isLoading, isError, refetch } = useRestaurant(id);
  const { packages, restaurantId, activePackageId, addPackage, removePackage, setActivePackage, addItem, decrementItem, removeItem } = useCartStore();
  // Multi-restaurant: show THIS restaurant's packs. Cart may have items from
  // other restaurants too. See packsForRestaurant for why this is not the
  // cart-level restaurantId.
  const legacyMine = restaurantId === id;
  const myPackages = packsForRestaurant(packages, id, restaurantId);
  const mine = myPackages.length > 0 || legacyMine;
  const activeId = myPackages.some((p) => p.id === activePackageId) ? activePackageId : null;
  const activePkg = myPackages.find((p) => p.id === activeId) ?? null;

  // Cart totals across ALL restaurants (for display at bottom)
  const totalCartCount = cartItemCount(packages);
  const totalCartSubtotal = cartSubtotalKobo(packages);

  // Transient, non-blocking note shown when a regular item overflows into a new pack.
  const [overflowNote, setOverflowNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!overflowNote) return;
    const t = setTimeout(() => setOverflowNote(null), 2500);
    return () => clearTimeout(t);
  }, [overflowNote]);

  // Menu quantity reflects the ACTIVE pack (the same food can sit in several packs).
  const qtyFor = (itemId: string) => activePkg?.lines.find((l) => l.itemId === itemId)?.qty ?? 0;

  const onAddItem = (item: MenuItem) => {
    if (!restaurant) return;
    // Menu adds auto-overflow: when the active pack is full for a regular item (max
    // portions reached, or it already holds a different main), a NEW pack opens with
    // the selected item and becomes active — shopping just continues.
    const res = addItem(restaurant.id, restaurant.name, item, activeId ?? undefined, { autoOverflow: true });
    if (res.overflowed && res.packageIndex) {
      setOverflowNote(`Pack ${res.packageIndex} started for ${item.name}`);
    }
  };
  const onRemoveItem = (item: MenuItem) => {
    if (activeId) decrementItem(activeId, item.id);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.navigate('/food')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1}>
          {restaurant?.name ?? 'Restaurant'}
        </Text>
        <View style={s.iconButton} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading menu…" />
      ) : isError || !restaurant ? (
        <StateView kind="error" title="Couldn't load this restaurant" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <View style={[s.header, shadow1]}>
              <View style={[s.iconBox, { backgroundColor: restaurant.iconBg }]}>
                <DynamicIcon name={restaurant.icon} color={restaurant.iconColor} size={30} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.name}>{restaurant.name}</Text>
                <Text style={s.metaLine}>
                  {restaurant.tags.join(' · ')}
                </Text>
                <View style={s.metaRow}>
                  <Icons.Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                  <Text style={s.metaStrong}>{restaurant.rating.toFixed(1)}</Text>
                  <Text style={s.dot}>·</Text>
                  <Icons.Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={s.meta}>{restaurant.etaLabel}</Text>
                  {/* Only when a flat fee is actually known. The live DTO has no
                      such field, so this used to read "Delivery ₦0" — free
                      delivery, for a fee that is quoted by distance at checkout. */}
                  {typeof restaurant.deliveryFeeKobo === 'number' ? (
                    <>
                      <Text style={s.dot}>·</Text>
                      <Text style={s.meta}>Delivery {formatNairaWhole(restaurant.deliveryFeeKobo)}</Text>
                    </>
                  ) : null}
                </View>
                {restaurant.address ? <Text style={s.address}>{restaurant.address}</Text> : null}
              </View>
            </View>

            {/* Takeaway packs — the "mother" container. Add a pack, then add food
                into the ACTIVE pack (max 2 of the same item per pack). Each pack
                lists its food; tap × to remove a food from that pack. */}
            {!mine && totalCartCount > 0 ? (
              <View style={[s.cartFromOtherNote, shadow1]}>
                <Icons.ShoppingCart size={14} color={Colors.primary} strokeWidth={2} />
                <Text style={s.cartFromOtherText}>You have {totalCartCount} items from other restaurants. Add from here or proceed to checkout.</Text>
              </View>
            ) : null}
            <View style={s.packsHead}>
              <Text style={s.packBarTitle}>Takeaway packs{myPackages.length > 0 ? ` (${myPackages.length})` : ''}</Text>
              <Pressable onPress={() => addPackage(id, restaurant?.name)} style={s.addPackBtn} accessibilityRole="button" accessibilityLabel="Add takeaway pack">
                <Icons.Plus size={14} color={Colors.primary} strokeWidth={2.6} />
                <Text style={s.addPackText}>Add pack</Text>
              </Pressable>
            </View>
            {overflowNote ? (
              <View style={s.overflowNote}>
                <Icons.PackagePlus size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                <Text style={s.overflowNoteText}>{overflowNote}</Text>
              </View>
            ) : null}

            {myPackages.length === 0 ? (
              <View style={[s.packEmptyCard, shadow1]}>
                <Text style={s.packHint}>
                  Add a takeaway pack, then put food into it from the menu. One main dish per pack
                  (up to {MAX_SAME_FOOD_PER_PACKAGE} portions); proteins like meat & fish can be added on top.
                </Text>
              </View>
            ) : (
              myPackages.map((p, i) => {
                const n = p.lines.reduce((a, l) => a + l.qty, 0);
                const active = p.id === activeId;
                return (
                  <View key={p.id} style={[s.packCard, shadow1, active && s.packCardActive]}>
                    <Pressable style={s.packCardHead} onPress={() => setActivePackage(p.id)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                      <Icons.ShoppingBag size={15} color={active ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2.2} />
                      <Text style={s.packCardTitle}>Pack {i + 1}{n > 0 ? ` · ${n}` : ''}</Text>
                      {active ? (
                        <View style={s.activeBadge}><Text style={s.activeBadgeText}>Adding here</Text></View>
                      ) : (
                        <Text style={s.tapToAdd}>Tap to add here</Text>
                      )}
                      <View style={{ flex: 1 }} />
                      <Pressable onPress={() => removePackage(p.id)} hitSlop={8} accessibilityLabel={`Remove pack ${i + 1}`}>
                        <Icons.Trash2 size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
                      </Pressable>
                    </Pressable>
                    {p.lines.length === 0 ? (
                      <Text style={s.packEmptyLine}>No food yet — pick from the menu below.</Text>
                    ) : (
                      p.lines.map((l) => (
                        <View key={l.itemId} style={s.packLine}>
                          <Text style={s.packLineName} numberOfLines={1}>{l.name}</Text>
                          <Text style={s.packLineQty}>×{l.qty}</Text>
                          <Pressable
                            onPress={() => removeItem(p.id, l.itemId)}
                            hitSlop={8}
                            style={s.packLineRemove}
                            accessibilityLabel={`Remove ${l.name} from pack ${i + 1}`}
                          >
                            <Icons.X size={14} color={Colors.error} strokeWidth={2.6} />
                          </Pressable>
                        </View>
                      ))
                    )}
                  </View>
                );
              })
            )}

            {restaurant.menu.map((cat) => (
              <View key={cat.id} style={s.section}>
                <Text style={s.sectionTitle}>{cat.name}</Text>
                {cat.items.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    qty={qtyFor(item.id)}
                    onAdd={() => onAddItem(item)}
                    onRemove={() => onRemoveItem(item)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>

          {totalCartCount > 0 ? (
            <Pressable style={[s.cartBar, shadow2]} onPress={() => router.push('/food/checkout')} accessibilityRole="button">
              <View style={s.cartBadge}>
                <Text style={s.cartBadgeText}>{totalCartCount}</Text>
              </View>
              <Text style={s.cartText}>View cart</Text>
              <Text style={s.cartCta}>{formatNaira(totalCartSubtotal)}</Text>
            </Pressable>
          ) : null}
        </>
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
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary, flex: 1, textAlign: 'center' },
  content: { padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 140 : 120 },
  header: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  iconBox: { width: 60, height: 60, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  metaLine: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  metaStrong: { ...Typography.labelSm, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { ...Typography.labelSm, color: Colors.outline },
  address: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  section: { marginTop: Spacing.lg },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  // takeaway packs
  packsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  packBarTitle: { ...Typography.titleMd, color: Colors.onSurface },
  addPackBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.primary },
  addPackText: { ...Typography.labelSm, color: Colors.primary },
  packHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  overflowNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 8, marginBottom: Spacing.sm },
  overflowNoteText: { ...Typography.labelSm, color: Colors.tertiaryContainer, flex: 1 },
  packEmptyCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  packCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm, gap: 6 },
  packCardActive: { borderColor: Colors.primary, borderWidth: 1.5 },
  packCardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  packCardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  activeBadge: { backgroundColor: Colors.primaryContainer, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  activeBadgeText: { ...Typography.caption, color: Colors.onPrimaryContainer, fontWeight: '700' as const },
  tapToAdd: { ...Typography.caption, color: Colors.onSurfaceVariant },
  packEmptyLine: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingTop: 2 },
  packLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.surfaceContainerHigh },
  packLineName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  packLineQty: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  packLineRemove: { width: 28, height: 28, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  cartFromOtherNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryContainer, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginBottom: Spacing.md },
  cartFromOtherText: { ...Typography.bodySm, color: Colors.onPrimaryContainer, flex: 1 },
  cartBar: {
    position: 'absolute',
    left: Spacing.containerMargin,
    right: Spacing.containerMargin,
    bottom: Platform.OS === 'ios' ? 32 : 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  cartBadge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  cartBadgeText: { ...Typography.labelSm, color: Colors.white },
  cartText: { ...Typography.labelMd, color: Colors.white, flex: 1 },
  cartCta: { ...Typography.labelLg, color: Colors.white },
});
