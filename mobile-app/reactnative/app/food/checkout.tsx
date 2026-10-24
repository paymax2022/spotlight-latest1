import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert, Switch, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
import { withPlusCode } from '@/lib/addressLookup';
import type { LatLng } from '@/features/food/types';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { usePlaceOrder, useDeliveryQuote, useOrderQuote, usePromoPreview } from '@/features/food/hooks';
import { useDebouncedValue } from '@/features/food/useDebouncedValue';
import { quoteRows, pricingSignature, isPriceChangedError, promoErrorMessage } from '@/features/food/quoteFlow';
import { lineKeyOf } from '@/features/food/modifiers';
import type { OrderQuote } from '@/features/food/types';
import {
  useCartStore, cartSubtotalKobo, cartItemCount, cartPackageCount,
  aggregateCartLines, cartPackagesPayload, MAX_SAME_FOOD_PER_PACKAGE,
} from '@/features/food/cartStore';
import { resolveRestaurantName, groupPackagesByRestaurant, UNKNOWN_RESTAURANT_ID } from '@/features/food/restaurantName';
import { formatNaira, newIdempotencyKey } from '@/features/food/utils';
import { resolveDeliveryFee } from '@/features/food/deliveryFee';
import { resolvePackagingFee } from '@/features/food/packagingFee';
import { estimateTotalKobo } from '@/features/food/estimate';
import { useRestaurant, useRestaurantNames, useCartRestaurantAvailability } from '@/features/food/hooks';
import { initiateFoodOrderPaystack, quoteOrder, FOOD_QUOTE_ENABLED } from '@/features/food/api';
import { usePurchasePayment, useGatewayCheckout, PaymentSheet } from '@/features/payments';
import { CartNutritionSummary } from '@/features/nutrition';
import { HomeMenuButton } from '@/components/HomeMenu';
import { api } from '@/api/client';
import { useQueryClient } from '@tanstack/react-query';

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
  const { packages, restaurantId, restaurantName, clear, addItem, decrementItem, addPackage, removePackage, removeRestaurants } = useCartStore();
  const { data: restaurant, isError: restaurantUnavailable, isPending: restaurantLoading } = useRestaurant(restaurantId ?? undefined);

  // Every kitchen in the cart, checked for existence — not just the primary, and
  // not just the ones that need naming: a kitchen can be perfectly nameable from
  // a captured line and still have been deleted since the cart was built.
  // The cart-level restaurantId is in here too, and that is the point. It is the
  // field useRestaurant (packaging) and useDeliveryQuote (delivery) are aimed at,
  // and being "first restaurant added, never updated" it can name a kitchen with
  // nothing left in the cart. Checking only the lines left a dead pointer
  // undetected and never re-derived, so BOTH fees sat at "—" forever with
  // nothing on screen explaining why.
  const cartRestaurantIds = useMemo(
    () =>
      [...new Set([
        ...packages.flatMap((p) => p.lines.map((l) => l.restaurantId)),
        restaurantId,
      ])].filter((x): x is string => !!x),
    [packages, restaurantId],
  );
  const goneRestaurantIdList = useCartRestaurantAvailability(cartRestaurantIds);

  // Remove them. A cart persists locally AND on the server, so it outlives the
  // ordinary — named, priced, adding to the total — while PlaceOrder can never
  // accept it and its delivery leg can never be quoted. Only a 404 gets here
  // (see availability.ts); a server error leaves the cart alone.
  const [prunedNotice, setPrunedNotice] = useState<string | null>(null);
  useEffect(() => {
    if (goneRestaurantIdList.length === 0) return;
    const out = removeRestaurants(goneRestaurantIdList);
    // Only speak up when food the customer chose actually left the cart. A
    // silent re-point (or dropping an empty pack) removes nothing they can
    // miss, and saying so would describe a loss that did not happen.
    if (out.removedItemCount === 0) return;
    const names = out.removedNames.join(', ');
    setPrunedNotice(
      `${names} ${out.removedIds.length > 1 ? 'are' : 'is'} no longer available, so ` +
        `${out.removedItemCount} item${out.removedItemCount === 1 ? '' : 's'} ` +
        `${out.removedItemCount === 1 ? 'was' : 'were'} removed from your order.`,
    );
  }, [goneRestaurantIdList, removeRestaurants]);

  // Names for the OTHER restaurants in a multi-restaurant cart. Lines added in
  // hydrated from storage or the server, whose lines predate that field.
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
  // Card/Transfer runs through a genuinely separate, server-initiated Paystack
  // rail (paystackcheckout on the Go side) — NOT usePurchasePayment's built-in
  // wallet debit ever occurs, so this works even without KYC (see onCard below
  // and initiateFoodOrderPaystack's doc comment).
  const paystackCheckout = useGatewayCheckout();
  const [paystackError, setPaystackError] = useState('');
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
  // not distance-based. The old rule discarded a flat-fallback quote in favour of
  // restaurant.deliveryFeeKobo — a field with no column and no DTO behind it —
  // so the fee rendered as ₦0 for every restaurant without coordinates while
  // PlaceOrder still charged the real one.
  const deliveryQuoteView = resolveDeliveryFee(quote);
  const deliveryFee = deliveryQuoteView.feeKobo;
  const deliveryKnown = deliveryQuoteView.known;
  const deliveryEstimated = deliveryQuoteView.estimated;
  const deliveryCalculating = Boolean(addressLocation) && quoteQ.isPending && !quote;
  // An address IS set and the quote came back an error — telling the buyer to
  // "add your address" here sends them to fix something that is not wrong.
  const deliveryFailed = Boolean(addressLocation) && quoteQ.isError && !quote;
  // Only a distance-based quote carries a breakdown worth showing.
  const haveQuote = deliveryKnown && !deliveryEstimated;
  // Mandatory take-away packaging — one pack fee PER takeaway package the customer
  // added (the package is the container). Cannot be removed.
  // Unknown is not free. `restaurant?.packagingFeeKobo ?? 0` rendered ₦0 whenever
  // the restaurant had not loaded, and the server charges the real per-pack fee
  // regardless — so the estimate was short by exactly that amount.
  const packagingView = resolvePackagingFee(packages, restaurant?.packagingFeeKobo);
  const packagingFee = packagingView.feeKobo;
  const packagingKnown = packagingView.known;
  const packCount = cartPackageCount(packages);
  // No service fee. Checkout used to add a hardcoded 5%, which the server does
  // not charge — it prices service fee from the restaurant's own service_fee_bp
  // (0 for every restaurant, and never exposed to the client). That invented
  // ₦560 on a real ₦12,801.40 order. See estimate.ts.
  const estTotal = estimateTotalKobo({
    subtotalKobo: subtotal,
    deliveryKobo: deliveryFee,
    packagingKobo: packagingFee,
  });
  // The estimate is missing a component the server will still charge. Say so
  // rather than presenting a total that reads as complete.
  const estIncomplete = !deliveryKnown || !packagingKnown;
  const count = cartItemCount(packages);
  // Aggregated lines (across packages) drive pricing + the nutrition summary.
  const aggregated = useMemo(() => aggregateCartLines(packages), [packages]);
  const dishIds = useMemo(() => [...new Set(aggregated.map((l) => l.itemId))], [aggregated]);

  // Increment a portion within a specific pack (protein is uncapped; a main caps at 2).
  const onIncrement = (pkgId: string, line: { itemId: string; name: string; priceKobo: number; isProtein?: boolean; modifiers?: { id: string; name: string; priceDeltaKobo: number }[] }) => {
    if (!restaurant) return;
    // The line price already includes modifier surcharges; addItem re-adds them,
    // so hand it the BASE price.
    const delta = (line.modifiers ?? []).reduce((n, m) => n + m.priceDeltaKobo, 0);
    const res = addItem(
      restaurant.id,
      restaurant.name,
      { id: line.itemId, name: line.name, priceKobo: line.priceKobo - delta, available: true, foodType: line.isProtein ? 'protein' : 'regular' },
      pkgId,
      line.modifiers && line.modifiers.length > 0 ? { modifiers: line.modifiers } : undefined,
    );
    if (!res.ok && res.reason === 'max_per_pack') {
      Alert.alert('Max 2 per pack', `At most ${MAX_SAME_FOOD_PER_PACKAGE} of "${line.name}" per takeaway pack. Add another pack to add more.`);
    }
  };

  const belowMin = useMemo(
    () => (restaurant ? subtotal < restaurant.minOrderKobo : false),
    [restaurant, subtotal],
  );

  // ── FOOD-UAT-C-011: promo entry (debounced live preview) ───────────────────
  const qc = useQueryClient();
  const [promoInput, setPromoInput] = useState('');
  const debouncedPromo = useDebouncedValue(promoInput.trim(), 500);
  const pricingItems = useMemo(
    () => aggregated.map((l) => ({ itemId: l.itemId, qty: l.qty, restaurantId: l.restaurantId, modifierIds: l.modifierIds })),
    [aggregated],
  );
  const baseCart = useMemo(
    () =>
      restaurantId
        ? { restaurantId, items: pricingItems, packageCount: packCount, deliveryAddress: address.trim(), deliveryLocation: addressLocation }
        : null,
    [restaurantId, pricingItems, packCount, address, addressLocation],
  );
  const baseSig = pricingSignature({
    restaurantId: restaurantId ?? '', items: pricingItems, packageCount: packCount,
    lat: addressLocation?.lat, lng: addressLocation?.lng,
  });
  const quoteEnabled = FOOD_QUOTE_ENABLED && Boolean(addressLocation) && count > 0 && !restaurantUnavailable;
  const promoQ = usePromoPreview(baseCart, debouncedPromo, baseSig, quoteEnabled);
  const promoSettling = promoInput.trim() !== debouncedPromo || (promoQ.isFetching && !promoQ.data);
  const promoApplied = Boolean(debouncedPromo) && promoQ.data?.valid === true ? debouncedPromo : '';
  const promoError =
    !debouncedPromo || promoSettling ? null
    : !addressLocation ? 'Add your delivery address to check this code.'
    : promoQ.isError ? "Couldn't check this code. Try again."
    : promoQ.data ? promoErrorMessage(promoQ.data)
    : null;

  // ── FOOD-UAT-C-007: server quote drives the displayed total + pay-sheet amount ──
  const quoteCart = useMemo(() => (baseCart ? { ...baseCart, promoCode: promoApplied || undefined } : null), [baseCart, promoApplied]);
  const quoteSig = pricingSignature({
    restaurantId: restaurantId ?? '', items: pricingItems, packageCount: packCount,
    lat: addressLocation?.lat, lng: addressLocation?.lng, promoCode: promoApplied,
  });
  const orderQuoteQ = useOrderQuote(quoteCart, quoteSig, quoteEnabled);
  const serverQuote: OrderQuote | undefined = orderQuoteQ.data;
  // "Price updated" modal: the total moved between what the buyer saw and what
  // the server now says (either on a fresh pre-sheet quote or a price_changed refusal).
  const [priceChange, setPriceChange] = useState<{ oldKobo: number; newKobo: number } | null>(null);

  // FOOD-UAT-H-001: marketing consent. Opt-in (off by default); recorded server-side
  // as an append-only user_consents row only when the buyer ticks it and places an order.
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const recordMarketingConsent = () => {
    if (!marketingOptIn) return;
    // Best-effort: consent capture must never block or fail a payment.
    void api.post('/api/finance/restaurant/consents', { kind: 'marketing', source: 'food_checkout' }).catch(() => {});
  };

  // Fetch a FRESH server quote (never a cached one) for the current cart.
  const freshQuote = async (): Promise<OrderQuote | null> => {
    if (!quoteCart) return null;
    try {
      const q = await quoteOrder(quoteCart);
      qc.setQueryData(['food', 'order-quote', quoteSig], q);
      return q;
    } catch {
      return null;
    }
  };

  const openPaySheet = (amountKobo: number, quote: OrderQuote | null) => {
    // Open the two-option modal. Wallet pays from balance and PlaceOrder runs on
    // confirmation. Card/Transfer runs onCard below — a separate server-initiated
    // Paystack rail that places the order itself once payment is verified, so
    // there is no `charge` call to make for that rail.
    pay.start({
      amountKobo,
      title: 'Pay & place order',
      domain: 'food_order',
      charge: async () => {
        try {
          return await placeOrder.mutateAsync({
            restaurantId: restaurantId || '', // primary restaurant (from route)
            items: aggregated.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              restaurantId: l.restaurantId, // multi-restaurant: include per-item restaurant
              modifierIds: l.modifierIds,
            })),
            packageCount: packCount,
            packages: cartPackagesPayload(packages),
            deliveryAddress: withPlusCode(address.trim(), addressPlusCode),
            deliveryLocation: addressLocation,
            quoteId: quote?.quoteId || undefined,
            promoCode: promoApplied || undefined,
          });
        } catch (e) {
          // The price moved since the quote. Re-quote and ask before charging more.
          if (isPriceChangedError(e)) {
            const q = await freshQuote();
            pay.close();
            if (q) setPriceChange({ oldKobo: amountKobo, newKobo: q.totalKobo });
            else setPaystackError('The price changed and we could not refresh it. Please try again.');
            throw new Error('Price updated. Please review the new total.');
          }
          throw e;
        }
      },
      onPaid: (order) => {
        // Server-authoritative amount charged.
        setPaid({ orderId: order.id, chargedKobo: order.totalKobo });
        clear();
        navTimer.current = setTimeout(() => {
          router.replace(`/food/orders/${order.id}`);
        }, 1400);
      },
      onCard: async () => {
        await paystackCheckout.start({
          domain: 'food_order',
          initialize: async ({ email }) => {
            const r = await initiateFoodOrderPaystack({
              email, // typed at checkout after the server answered email_required; else the registered email is used
              restaurantId: restaurantId || '',
              items: aggregated.map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                restaurantId: l.restaurantId,
                modifierIds: l.modifierIds,
              })),
              packageCount: packCount,
              packages: cartPackagesPayload(packages),
              deliveryAddress: withPlusCode(address.trim(), addressPlusCode),
              deliveryLocation: addressLocation,
              quoteId: quote?.quoteId || undefined,
              promoCode: promoApplied || undefined,
              idempotencyKey: newIdempotencyKey('food-order-paystack'),
            });
            if (!r.authorizationUrl) throw new Error('Paystack did not return a payment URL.');
            return { authorizationUrl: r.authorizationUrl, reference: r.reference };
          },
          onResolved: (res) => {
            // The order is placed server-side only once the charge is verified —
            // this screen hands off to a status resolver, same shape as the
            // utility-bills Paystack flow (app/services/paystack/[reference]).
            clear();
            router.replace(`/food/paystack/${encodeURIComponent(res.reference)}` as never);
          },
        });
      },
    });
  };

  const onPlace = async (opts?: { confirmedPrice?: boolean }) => {
    if (!restaurantId || !address.trim() || belowMin || placeOrder.isPending || paid) return;
    recordMarketingConsent();
    // not load it, the order cannot be placed and taking a payment first would
    // charge for something the server is about to refuse.
    if (restaurantUnavailable) return;
    setPaystackError('');
    // Mock mode / no resolved address: no server quote exists, so fall back to the
    // client estimate (the server still re-prices on placement).
    if (!quoteEnabled) {
      openPaySheet(estTotal, null);
      return;
    }
    // FOOD-UAT-C-007: the pay-sheet amount is the SERVER quote, fetched fresh.
    const q = await freshQuote();
    if (!q) {
      setPaystackError("We couldn't confirm the price for this order. Check your connection and try again.");
      return;
    }
    const shown = serverQuote?.totalKobo;
    if (!opts?.confirmedPrice && shown != null && shown !== q.totalKobo) {
      setPriceChange({ oldKobo: shown, newKobo: q.totalKobo });
      return;
    }
    openPaySheet(q.totalKobo, q);
  };

  useEffect(() => {
    if (paystackCheckout.error) setPaystackError(paystackCheckout.error);
  }, [paystackCheckout.error]);

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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={s.iconButton} />
            <HomeMenuButton />
          </View>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={s.iconButton} />
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* An order cannot be placed for a restaurant the server cannot load, and
            its delivery fee cannot be quoted either — which is what "the fee is
            not computing" looks like from the outside. Say so ABOVE the prices,
            not after the total. */}
        {/* What was removed, and why. The cart quietly shrinking is worse than the
            stale lines it replaces — the customer picked that food and has no
            other way to learn it went. */}
        {prunedNotice ? <Text style={s.blocker}>{prunedNotice}</Text> : null}

        {/* Still reachable when the PRIMARY restaurant fails for a reason that is
            not a 404 (a 500, say): nothing is removed in that case, so the order
            cannot proceed and the screen has to say so rather than sit there. */}
        {restaurantUnavailable && !prunedNotice ? (
          <Text style={s.blocker}>
            {restaurantName ? `We couldn't load "${restaurantName}"` : "We couldn't load this restaurant"}
            , so this order can't be placed and its delivery fee can't be priced. Try again in a moment.
          </Text>
        ) : null}
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
                          <View key={lineKeyOf(l)} style={s.itemRow}>
                            <View style={s.itemNameWrap}>
                              <View style={{ flexShrink: 1 }}>
                                <Text style={s.itemName} numberOfLines={1}>{l.name}</Text>
                                {l.modifiers && l.modifiers.length > 0 ? (
                                  <Text style={s.itemMods} numberOfLines={2}>{l.modifiers.map((m) => m.name).join(', ')}</Text>
                                ) : null}
                              </View>
                              {l.isProtein ? <View style={s.proteinTag}><Text style={s.proteinTagText}>protein</Text></View> : null}
                            </View>
                            <View style={s.stepper}>
                              <Pressable onPress={() => decrementItem(pkg.id, lineKeyOf(l))} style={s.stepBtn} accessibilityLabel="Remove one">
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

        {/* FOOD-UAT-C-011: promo code. Above the consent toggle, below the items. */}
        <Text style={s.sectionLabel}>Promo code</Text>
        <View style={[s.card, shadow1]}>
          <TextInput
            value={promoInput}
            onChangeText={setPromoInput}
            placeholder="Enter promo code"
            autoCapitalize="characters"
            autoCorrect={false}
            style={s.promoInput}
            accessibilityLabel="Promo code"
            testID="promo-input"
          />
          {promoSettling && promoInput.trim() ? <Text style={s.promoNote}>Checking…</Text> : null}
          {!promoSettling && promoApplied && promoQ.data ? (
            <Text style={s.promoOk} testID="promo-ok">Promo applied — {formatNaira(promoQ.data.discountKobo)} off</Text>
          ) : null}
          {promoError ? <Text style={s.promoErr} testID="promo-error">{promoError}</Text> : null}
        </View>

        {/* Price breakdown */}
        <Text style={s.sectionLabel}>Summary</Text>
        {serverQuote ? (
          <View style={[s.card, shadow1]} testID="quote-summary">
            {quoteRows(serverQuote).map((r) => (
              <React.Fragment key={r.key}>
                {r.strong ? <View style={s.divider} /> : null}
                <Line
                  label={r.key === 'subtotal' ? `Subtotal (${count} item${count > 1 ? 's' : ''})` : r.label}
                  value={`${r.kobo < 0 ? '−' : ''}${formatNaira(Math.abs(r.kobo))}`}
                  strong={r.strong}
                />
              </React.Fragment>
            ))}
            {serverQuote.promoRejection && promoApplied ? (
              <Text style={s.promoErr}>{promoErrorMessage({ valid: false, reason: serverQuote.promoRejection })}</Text>
            ) : null}
            <Text style={s.note}>Confirmed by the server. This is the amount you will pay.</Text>
          </View>
        ) : (
        <View style={[s.card, shadow1]}>
          <Line label={`Subtotal (${count} item${count > 1 ? 's' : ''})`} value={formatNaira(subtotal)} />
          <Line
            label={
              deliveryFailed
                ? "Delivery fee (couldn't be priced)"
                : !deliveryKnown
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
          <Line
            label={`Takeaway packaging (${packCount} pack${packCount > 1 ? 's' : ''})`}
            value={packagingKnown ? formatNaira(packagingFee) : restaurantLoading ? 'Calculating…' : '—'}
          />
          <View style={s.divider} />
          <Line label="Estimated total" value={formatNaira(estTotal)} strong />
          <Text style={s.note}>
            {estIncomplete
              ? 'This estimate is missing a charge the server will still apply, so the final amount will be higher. '
              : ''}
            {deliveryEstimated && !deliveryFailed
              ? 'Add your delivery address to get an exact distance-based delivery fee. '
              : ''}
            Takeaway packaging is required so the restaurant can pack your order. Final total is confirmed by the server when you place the order.
          </Text>
        </View>
        )}

        {/* Estimated nutrition + allergens for the whole cart (honest range). */}
        <Text style={s.sectionLabel}>Nutrition & allergens</Text>
        <CartNutritionSummary ids={dishIds} />

        <View style={s.consentRow}>
          <Text style={s.consentText}>Send me offers and promotions (optional). You can opt out any time.</Text>
          <Switch
            value={marketingOptIn}
            onValueChange={setMarketingOptIn}
            accessibilityLabel="Receive marketing offers and promotions"
          />
        </View>

        {belowMin && restaurant ? (
          <Text style={s.warn}>Minimum order is {formatNaira(restaurant.minOrderKobo)}. Add {formatNaira(restaurant.minOrderKobo - subtotal)} more to continue.</Text>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        <PrimaryButton
          label={`Pay & place order · ${formatNaira(serverQuote ? serverQuote.totalKobo : estTotal)}`}
          onPress={() => void onPlace()}
          loading={placeOrder.isPending}
          disabled={!address.trim() || belowMin || restaurantUnavailable}
        />
        <Text style={s.payHint}>You'll be taken to the secure payment gateway (Paystack) to complete payment.</Text>
        {paystackError ? <Text style={s.warn}>{paystackError}</Text> : null}
      </View>

      {/* FOOD-UAT-C-007: price moved since the buyer last saw it. */}
      <Modal visible={priceChange != null} transparent animationType="fade" onRequestClose={() => setPriceChange(null)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard} testID="price-changed-modal">
            <Text style={s.modalTitle}>Price updated</Text>
            <Text style={s.modalBody}>
              New total {priceChange ? formatNaira(priceChange.newKobo) : ''} (was {priceChange ? formatNaira(priceChange.oldKobo) : ''}). Confirm?
            </Text>
            <View style={s.modalActions}>
              <Pressable onPress={() => setPriceChange(null)} style={s.modalBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                <Text style={s.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPriceChange(null);
                  void onPlace({ confirmedPrice: true });
                }}
                style={[s.modalBtn, s.modalBtnPrimary]}
                accessibilityRole="button"
                accessibilityLabel="Keep"
              >
                <Text style={[s.modalBtnText, { color: Colors.white }]}>Keep</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Two-option payment modal (wallet / card-transfer via Paystack). */}
      <PaymentSheet controller={pay} />
      {/* Hosts the in-app Paystack checkout for the card/transfer rail. */}
      <paystackCheckout.Sheet />
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
  blocker: { ...Typography.bodySm, color: Colors.error, backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm },
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
  itemMods: { ...Typography.caption, color: Colors.onSurfaceVariant },
  promoInput: { borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, ...Typography.bodyMd, color: Colors.onSurface },
  promoNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  promoOk: { ...Typography.labelMd, color: Colors.tertiaryContainer, marginTop: Spacing.xs },
  promoErr: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  modalCard: { width: '100%', maxWidth: 380, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  modalTitle: { ...Typography.titleMd, color: Colors.onSurface },
  modalBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  modalBtn: { paddingHorizontal: Spacing.lg, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant },
  modalBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modalBtnText: { ...Typography.labelMd, color: Colors.primary },
  consentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginTop: Spacing.md },
  consentText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  payHint: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  paidWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xs },
  paidIcon: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  paidTitle: { ...Typography.titleLg, color: Colors.onSurface },
  paidAmount: { ...Typography.titleMd, color: Colors.tertiaryContainer, marginTop: 2 },
  paidSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  paidLink: { ...Typography.labelLg, color: Colors.primary, marginTop: Spacing.lg },
});
