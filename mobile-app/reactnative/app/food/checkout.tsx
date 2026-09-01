import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
import { withPlusCode } from '@/lib/addressLookup';
import type { LatLng } from '@/features/food/types';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { usePlaceOrder, useDeliveryQuote } from '@/features/food/hooks';
import {
  useCartStore, cartSubtotalKobo, cartItemCount, cartPackageCount, cartPackagingKobo,
  aggregateCartLines, cartPackagesPayload, MAX_SAME_FOOD_PER_PACKAGE,
} from '@/features/food/cartStore';
import { resolveRestaurantName, groupPackagesByRestaurant, UNKNOWN_RESTAURANT_ID } from '@/features/food/restaurantName';
import { formatNaira } from '@/features/food/utils';
import { resolveDeliveryFee } from '@/features/food/deliveryFee';
import { useRestaurant, useRestaurantNames } from '@/features/food/hooks';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { CartNutritionSummary } from '@/features/nutrition';

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.priceRow}>
      <Text style={[s.priceLabel, strong && s.priceLabelStrong]}>{label}</Text>
      <Text style={[s.priceValue, strong && s.priceValueStrong]}>{value}</Text>
    </View>
  );
}

function SubLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.subRow}>
      <Text style={[s.subLabel, strong && s.subLabelStrong]}>{label}</Text>
      <Text style={[s.subValue, strong && s.subValueStrong]}>{value}</Text>
    </View>
  );
}

export default function CheckoutScreen() {
  const { packages, restaurantId, restaurantName, clear, addItem, decrementItem, addPackage, removePackage } = useCartStore();
  const { data: restaurant } = useRestaurant(restaurantId ?? undefined);

  // Names for the OTHER restaurants in a multi-restaurant cart. Lines added in
  // this session carry their own name; the per-id lookup below covers carts
  // hydrated from storage or the server, whose lines predate that field.
  //
  // This used to seed the map from the WHOLE discovery list. That list is now
  // paged, so it would have named only the restaurants that happened to be on
  // page 1 — and the by-id fetch already covers every case it did, without
  // depending on a shop being open or on the first page.
  const restaurantNameById = useMemo(() => {
    const m = new Map<string, string>();
    // The cart's primary restaurant is known to the store even when discovery
    // does not list it (e.g. it has since closed).
    if (restaurantId && restaurantName) m.set(restaurantId, restaurantName);
    return m;
  }, [restaurantId, restaurantName]);

  // The cart's restaurant groups, in render order. Lifted out of the JSX so the
  // unresolved ids below can be computed before rendering.
  const restaurantGroups = useMemo(() => groupPackagesByRestaurant(packages, restaurantId), [packages, restaurantId]);

  // Ids that neither a captured line name nor the cart's own primary restaurant
  // can name. Fetched by id, which has no is_open filter and no paging — a cart
  // outlives opening hours, and discovery is `WHERE is_open = TRUE`. Usually
  // empty, in which case no request is made.
  const unresolvedRestaurantIds = useMemo(
    () =>
      restaurantGroups
        .filter(({ rid, packages: ps }) => {
          if (!rid || rid === UNKNOWN_RESTAURANT_ID) return false; // nothing to fetch
          if (restaurantNameById.has(rid)) return false;
          return !ps.some((p) => p.lines.some((l) => l.restaurantName?.trim()));
        })
        .map(({ rid }) => rid),
    [restaurantGroups, restaurantNameById],
  );
  const fetchedNames = useRestaurantNames(unresolvedRestaurantIds);

  const lookupRestaurantName = useCallback(
    (id: string) => restaurantNameById.get(id) ?? fetchedNames.get(id),
    [restaurantNameById, fetchedNames],
  );
  const placeOrder = usePlaceOrder();
  // Two-option checkout modal: Pay with Wallet, or Pay with Card/Transfer (Paystack gateway).
  const pay = usePurchasePayment<Awaited<ReturnType<typeof placeOrder.mutateAsync>>>();
  const [address, setAddress] = useState('');
  const [addressLocation, setAddressLocation] = useState<LatLng | null>(null);
  const [addressPlusCode, setAddressPlusCode] = useState<string>('');
  // After payment succeeds we flash a confirmation, then route to tracking.
  const [paid, setPaid] = useState<{ orderId: string; chargedKobo: number } | null>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subtotal = cartSubtotalKobo(packages);
  // Distance/time-based delivery quote for the picked drop-off. Keyed by coords,
  // so react-query refetches when the buyer changes location. SERVER stays
  // authoritative on placeOrder — this only drives the pre-payment estimate.
  const quoteQ = useDeliveryQuote(restaurantId ?? undefined, addressLocation);
  const quote = quoteQ.data;
  // A quote is a SERVER price and is always used; flat_fallback only means it is
  // not distance-based. The old rule discarded a flat-fallback quote in favour of
  // restaurant.deliveryFeeKobo — a field with no column and no DTO behind it —
  // so the fee rendered as ₦0 for every restaurant without coordinates while
  // PlaceOrder still charged the real one.
  const deliveryQuoteView = resolveDeliveryFee(quote);
  const deliveryFee = deliveryQuoteView.feeKobo;
  const deliveryKnown = deliveryQuoteView.known;
  const deliveryEstimated = deliveryQuoteView.estimated;
  const deliveryCalculating = Boolean(addressLocation) && quoteQ.isPending && !quote;
  // Only a distance-based quote carries a breakdown worth showing.
  const haveQuote = deliveryKnown && !deliveryEstimated;
  // Service fee shown as an estimate; the SERVER computes the authoritative total.
  const serviceFee = Math.round(subtotal * 0.05);
  // Mandatory take-away packaging — one pack fee PER takeaway package the customer
  // added (the package is the container). Cannot be removed.
  const packFee = restaurant?.packagingFeeKobo ?? 0;
  const packCount = cartPackageCount(packages);
  const packagingFee = cartPackagingKobo(packages, packFee);
  const estTotal = subtotal + deliveryFee + serviceFee + packagingFee;
  const count = cartItemCount(packages);
  // Aggregated lines (across packages) drive pricing + the nutrition summary.
  const aggregated = useMemo(() => aggregateCartLines(packages), [packages]);
  const dishIds = useMemo(() => aggregated.map((l) => l.itemId), [aggregated]);

  // Increment a portion within a specific pack (protein is uncapped; a main caps at 2).
  const onIncrement = (pkgId: string, line: { itemId: string; name: string; priceKobo: number; isProtein?: boolean }) => {
    if (!restaurant) return;
    const res = addItem(
      restaurant.id,
      restaurant.name,
      { id: line.itemId, name: line.name, priceKobo: line.priceKobo, available: true, foodType: line.isProtein ? 'protein' : 'regular' },
      pkgId,
    );
    if (!res.ok && res.reason === 'max_per_pack') {
      Alert.alert('Max 2 per pack', `At most ${MAX_SAME_FOOD_PER_PACKAGE} of "${line.name}" per takeaway pack. Add another pack to add more.`);
    }
  };

  const belowMin = useMemo(
    () => (restaurant ? subtotal < restaurant.minOrderKobo : false),
    [restaurant, subtotal],
  );

  const onPlace = () => {
    if (!restaurantId || !address.trim() || belowMin || placeOrder.isPending || paid) return;
    // Open the two-option modal. Wallet pays from balance; Card/Transfer charges
    // on the Paystack gateway. Either way placeOrder (the fulfilment) runs on
    // confirmation, with its own Idempotency-Key.
    pay.start({
      amountKobo: estTotal,
      title: 'Pay & place order',
      domain: 'food_order',
      charge: () =>
        placeOrder.mutateAsync({
          restaurantId: restaurantId || '', // primary restaurant (from route)
          items: aggregated.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            restaurantId: l.restaurantId, // multi-restaurant: include per-item restaurant
          })),
          packageCount: packCount,
          packages: cartPackagesPayload(packages),
          deliveryAddress: withPlusCode(address.trim(), addressPlusCode),
          deliveryLocation: addressLocation,
        }),
      onPaid: (order) => {
        // Server-authoritative amount charged.
        setPaid({ orderId: order.id, chargedKobo: order.totalKobo });
        clear();
        navTimer.current = setTimeout(() => {
          router.replace(`/food/orders/${order.id}`);
        }, 1400);
      },
    });
  };

  // Payment confirmation screen — shown after the wallet is charged.
  if (paid) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.paidWrap}>
          <View style={s.paidIcon}>
            <Icons.CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={1.8} />
          </View>
          <Text style={s.paidTitle}>Payment successful</Text>
          <Text style={s.paidAmount}>{formatNaira(paid.chargedKobo)} charged</Text>
          <Text style={s.paidSub}>Taking you to your order…</Text>
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} />
          <Pressable
            onPress={() => {
              if (navTimer.current) clearTimeout(navTimer.current);
              router.replace(`/food/orders/${paid.orderId}`);
            }}
            accessibilityRole="button"
          >
            <Text style={s.paidLink}>Track order now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (count === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.topBar}>
          <Pressable onPress={() => goBack('/food')} style={s.iconButton} accessibilityLabel="Go back">
            <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
          <Text style={s.topTitle}>Checkout</Text>
          <View style={s.iconButton} />
        </View>
        <StateView kind="empty" icon="ShoppingCart" title="Your cart is empty" message="Add items from a restaurant to get started." actionLabel="Browse restaurants" onAction={() => router.replace('/food')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Checkout</Text>
        <View style={s.iconButton} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Group items by restaurant and display */}
        {(() => {
          // Grouping is memoized above (restaurantGroups) so the screen can
          // resolve names for closed/unlisted restaurants before rendering.
          return restaurantGroups.length === 0 ? null : (
            <View>
              {restaurantGroups.map(({ rid, packages: rPackages }, restIndex) => (
                <View key={rid} style={restIndex > 0 && { marginTop: Spacing.lg }}>
                  {/* Restaurant name header */}
                  <View style={s.restaurantSection}>
                    <Text style={s.restaurantSectionTitle}>
                      {resolveRestaurantName(
                        rPackages.flatMap((p) => p.lines),
                        rid,
                        restIndex,
                        lookupRestaurantName,
                      )}
                    </Text>
                  </View>

                  {/* Takeaway packs for this restaurant */}
                  {rPackages.map((pkg, pkgIndex) => (
                    <View key={pkg.id} style={[s.card, shadow1, pkgIndex > 0 && { marginTop: Spacing.sm }]}>
                      <View style={s.packHeader}>
                        <View style={s.packHeaderLeft}>
                          <Icons.ShoppingBag size={16} color={Colors.primary} strokeWidth={2.2} />
                          <Text style={s.packTitle}>Takeaway pack {pkgIndex + 1}</Text>
                        </View>
                        <Pressable onPress={() => removePackage(pkg.id)} hitSlop={8} accessibilityLabel={`Remove pack ${pkgIndex + 1}`}>
                          <Icons.Trash2 size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                        </Pressable>
                      </View>
                      <View style={s.divider} />
                      {pkg.lines.map((l) => {
                        const atMax = !l.isProtein && l.qty >= MAX_SAME_FOOD_PER_PACKAGE;
                        return (
                          <View key={l.itemId} style={s.itemRow}>
                            <View style={s.itemNameWrap}>
                              <Text style={s.itemName} numberOfLines={1}>{l.name}</Text>
                              {l.isProtein ? <View style={s.proteinTag}><Text style={s.proteinTagText}>protein</Text></View> : null}
                            </View>
                            <View style={s.stepper}>
                              <Pressable onPress={() => decrementItem(pkg.id, l.itemId)} style={s.stepBtn} accessibilityLabel="Remove one">
                                <Icons.Minus size={14} color={Colors.primary} strokeWidth={2.4} />
                              </Pressable>
                              <Text style={s.qty}>{l.qty}</Text>
                              <Pressable
                                onPress={() => onIncrement(pkg.id, l)}
                                style={[s.stepBtn, atMax && s.stepBtnDisabled]}
                                disabled={atMax}
                                accessibilityLabel="Add one"
                              >
                                <Icons.Plus size={14} color={atMax ? Colors.outline : Colors.primary} strokeWidth={2.4} />
                              </Pressable>
                            </View>
                            <Text style={s.itemPrice}>{formatNaira(l.priceKobo * l.qty)}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          );
        })()}

        <View style={s.packActionsRow}>
          <Pressable style={[s.actionButton, s.actionButtonAdd]} onPress={() => addPackage(restaurantId ?? undefined, restaurantName ?? undefined)} accessibilityRole="button">
            <Icons.Plus size={16} color={Colors.primary} strokeWidth={2.6} />
            <Text style={s.actionButtonText}>Add another pack</Text>
          </Pressable>
          <Pressable style={[s.actionButton, s.actionButtonShop]} onPress={() => router.push('/food')} accessibilityRole="button">
            <Icons.Plus size={16} color={Colors.white} strokeWidth={2.6} />
            <Text style={[s.actionButtonText, s.actionButtonTextShop]}>Add more food</Text>
          </Pressable>
        </View>
        <Text style={s.packNote}>One main dish per pack (up to {MAX_SAME_FOOD_PER_PACKAGE} portions); proteins like meat & fish can be added on top.</Text>

        {/* Delivery address — proxy (Google) lookup with offline fallback, returning
            a map-ready coordinate + Plus Code, with confirm-on-map + GPS. */}
        <Text style={s.sectionLabel}>Delivery address</Text>
        <AddressAutocompleteInput
          value={address}
          onChangeText={(t) => {
            setAddress(t);
            setAddressLocation(null); // typed text no longer matches a geocoded pick
            setAddressPlusCode('');
          }}
          onSelect={(a: SelectedAddress) => {
            setAddress(a.label);
            setAddressLocation({ lat: a.lat, lng: a.lng });
            setAddressPlusCode(a.plusCode ?? '');
          }}
          near={restaurant?.location ?? undefined}
          resolved={Boolean(addressLocation)}
          surface="delivery"
          placeholder="Search your delivery address…"
        />

        {/* Price breakdown */}
        <Text style={s.sectionLabel}>Summary</Text>
        <View style={[s.card, shadow1]}>
          <Line label={`Subtotal (${count} item${count > 1 ? 's' : ''})`} value={formatNaira(subtotal)} />
          <Line
            label={
              !deliveryKnown
                ? 'Delivery fee (add your address)'
                : deliveryEstimated
                  ? 'Delivery fee (estimated)'
                  : 'Delivery fee'
            }
            value={
              deliveryCalculating
                ? 'Calculating…'
                : // Never render ₦0 for a fee nobody has quoted: the customer
                  // would read "free delivery" and then be charged at checkout.
                  deliveryKnown
                  ? formatNaira(deliveryFee)
                  : '—'
            }
          />
          {/* Distance/time delivery breakdown — only when we have a real quote.
              Non-zero lines only, each via formatNaira; integer kobo throughout. */}
          {haveQuote && quote?.breakdown ? (
            <View style={s.breakdown}>
              <View style={s.breakdownHeadRow}>
                <Icons.Bike size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={s.breakdownHead}>
                  {quote.breakdown.distance_km.toFixed(1)} km · ~{Math.round(quote.breakdown.eta_minutes)} min
                </Text>
              </View>
              <SubLine label="Base fee" value={formatNaira(quote.breakdown.base_kobo)} />
              {quote.breakdown.distance_kobo > 0 ? (
                <SubLine label="Extra distance" value={formatNaira(quote.breakdown.distance_kobo)} />
              ) : null}
              {quote.breakdown.time_kobo > 0 ? (
                <SubLine label="Extra time" value={formatNaira(quote.breakdown.time_kobo)} />
              ) : null}
              {quote.breakdown.surge_kobo > 0 ? (
                <SubLine label="Surge" value={formatNaira(quote.breakdown.surge_kobo)} />
              ) : null}
              {quote.breakdown.night_kobo > 0 ? (
                <SubLine label="Night surcharge" value={formatNaira(quote.breakdown.night_kobo)} />
              ) : null}
              {quote.breakdown.weather_kobo > 0 ? (
                <SubLine label="Weather surcharge" value={formatNaira(quote.breakdown.weather_kobo)} />
              ) : null}
              {quote.breakdown.handling_kobo > 0 ? (
                <SubLine label="Handling" value={formatNaira(quote.breakdown.handling_kobo)} />
              ) : null}
              {quote.breakdown.promo_kobo > 0 ? (
                <SubLine label="Promo discount" value={`−${formatNaira(quote.breakdown.promo_kobo)}`} />
              ) : null}
              <SubLine label="Delivery total" value={formatNaira(quote.breakdown.total_kobo)} strong />
            </View>
          ) : null}
          <Line label={`Takeaway packaging (${packCount} pack${packCount > 1 ? 's' : ''})`} value={formatNaira(packagingFee)} />
          <Line label="Service fee" value={formatNaira(serviceFee)} />
          <View style={s.divider} />
          <Line label="Estimated total" value={formatNaira(estTotal)} strong />
          <Text style={s.note}>
            {deliveryEstimated
              ? 'Add your delivery address to get an exact distance-based delivery fee. '
              : ''}
            Takeaway packaging is required so the restaurant can pack your order. Final total is confirmed by the server when you place the order.
          </Text>
        </View>

        {/* Estimated nutrition + allergens for the whole cart (honest range). */}
        <Text style={s.sectionLabel}>Nutrition & allergens</Text>
        <CartNutritionSummary ids={dishIds} />

        {belowMin && restaurant ? (
          <Text style={s.warn}>Minimum order is {formatNaira(restaurant.minOrderKobo)}. Add {formatNaira(restaurant.minOrderKobo - subtotal)} more to continue.</Text>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        <PrimaryButton
          label={`Pay & place order · ${formatNaira(estTotal)}`}
          onPress={onPlace}
          loading={placeOrder.isPending}
          disabled={!address.trim() || belowMin}
        />
        <Text style={s.payHint}>You'll be taken to the secure payment gateway (Paystack) to complete payment.</Text>
      </View>

      {/* Two-option payment modal (wallet / card-transfer via Paystack). */}
      <PaymentSheet controller={pay} />
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
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  restHeader: { marginBottom: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  restName: { ...Typography.titleMd, color: Colors.onSurface },
  restMeta: { ...Typography.labelMd, color: Colors.secondary },
  restaurantSection: { marginBottom: Spacing.md, paddingBottom: Spacing.sm, borderBottomWidth: 2, borderBottomColor: Colors.primary },
  restaurantSectionTitle: { ...Typography.titleMd, color: Colors.primary, fontWeight: '600' as const },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  packHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  packHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  packTitle: { ...Typography.labelLg, color: Colors.onSurface },
  addPackRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  addPackRowText: { ...Typography.labelMd, color: Colors.primary },
  packActionsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  actionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5 },
  actionButtonAdd: { borderStyle: 'dashed' as const, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  actionButtonShop: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionButtonText: { ...Typography.labelMd, color: Colors.primary },
  actionButtonTextShop: { color: Colors.white },
  packNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  itemNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemName: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1 },
  proteinTag: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  proteinTagText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 28, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  stepBtnDisabled: { opacity: 0.5 },
  qty: { ...Typography.labelMd, color: Colors.onSurface, minWidth: 16, textAlign: 'center' },
  itemPrice: { ...Typography.labelMd, color: Colors.onSurface, minWidth: 72, textAlign: 'right' },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  priceLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  priceLabelStrong: { ...Typography.labelLg, color: Colors.onSurface },
  priceValue: { ...Typography.bodyMd, color: Colors.onSurface },
  priceValueStrong: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.sm },
  breakdown: { marginTop: 2, marginBottom: Spacing.xs, paddingLeft: Spacing.sm, borderLeftWidth: 2, borderLeftColor: Colors.surfaceContainerHigh, gap: 1 },
  breakdownHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  breakdownHead: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  subRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  subLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  subLabelStrong: { ...Typography.labelMd, color: Colors.onSurface },
  subValue: { ...Typography.caption, color: Colors.onSurfaceVariant },
  subValueStrong: { ...Typography.labelMd, color: Colors.onSurface },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  warn: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  payHint: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  paidWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xs },
  paidIcon: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  paidTitle: { ...Typography.titleLg, color: Colors.onSurface },
  paidAmount: { ...Typography.titleMd, color: Colors.tertiaryContainer, marginTop: 2 },
  paidSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  paidLink: { ...Typography.labelLg, color: Colors.primary, marginTop: Spacing.lg },
});
