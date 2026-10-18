import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  BusFront, MapPin, Search as SearchIcon, Star, ShieldCheck, Ticket,
  ChevronRight, Store, ArrowRight, Minus, Plus,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import SegmentedControl from '@/components/SegmentedControl';
import DatePickerField from '@/components/DatePickerField';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { BUS_ENABLED } from '@/features/mobility/constants/modes.constants';
import { useBusProviders, useProviderMe } from '@/features/mobility/hooks/useBusMarketplace';
import { useBusDraft, useBusGeoCities, useBusGeoStates, useBusV2Bookings } from '@/features/mobility/hooks/useBusV2';
import { startBusDraft, clearBusDraft } from '@/features/mobility/utils/busCheckoutDraft';
import { BUS_V2_BOOKING_STATUS_LABEL, busV2StatusTone } from '@/features/mobility/utils/busV2';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusProviderListItem } from '@/features/mobility/types/busProvider.types';
import type { BusTripType } from '@/features/mobility/types/busV2.types';

type Tab = 'book' | 'providers' | 'tickets';

const MAX_PAX = 10;
const dt = (iso: string) =>
  !iso || Number.isNaN(Date.parse(iso))
    ? '—'
    : new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });


export default function BusMarketplaceScreen() {
  // Deep-link params from a provider route "Book" action preselect the Book tab.
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab: Tab = params.tab === 'providers' || params.tab === 'tickets' ? params.tab : 'book';
  const [tab, setTab] = useState<Tab>(initialTab);
  const providerMe = useProviderMe();
  const hasProvider = Boolean(providerMe.data?.provider);
  const providerRoute = hasProvider ? '/mobility/bus/provider' : '/mobility/bus/provider/register';

  if (!BUS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Bus travel" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Bus travel"
        rightSlot={
          <Pressable
            onPress={() => router.push(providerRoute)}
            hitSlop={8}
            accessibilityLabel={hasProvider ? 'Provider dashboard' : 'Become a provider'}
          >
            <Store size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      <View style={styles.tabsWrap}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'book', label: 'Book' },
            { value: 'providers', label: 'Providers' },
            { value: 'tickets', label: 'My Tickets' },
          ]}
        />
      </View>

      {tab === 'book' && <BookTab />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'tickets' && <TicketsTab />}

      {/* Provider entry — label depends on whether the user already runs a provider */}
      {tab !== 'tickets' && (
        <Pressable style={styles.providerCta} onPress={() => router.push(providerRoute)}>
          <View style={styles.providerCtaIcon}><Store size={18} color={Colors.primary} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.providerCtaTitle}>{hasProvider ? 'Provider dashboard' : 'Become a provider'}</Text>
            <Text style={styles.providerCtaSub}>{hasProvider ? 'Manage routes, departures & bookings' : 'List your fleet and sell seats'}</Text>
          </View>
          <ArrowRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      )}
    </SafeAreaView>
  );
}

// BOOK — PRD v2: state/city pickers from backend geo reference data
// (bus_geo_state / bus_geo_city — never a hard-coded list), one-way vs return,
// travel date and passenger count. Search hands off to the results screen.
function BookTab() {
  const draft = useBusDraft();
  const geoStates = useBusGeoStates();

  const [tripType, setTripType] = useState<BusTripType>(draft?.search.tripType ?? 'oneway');
  const [fromStateId, setFromStateId] = useState(draft?.search.fromStateId ?? '');
  const [toStateId, setToStateId] = useState(draft?.search.toStateId ?? '');
  const [fromCityId, setFromCityId] = useState(draft?.search.fromCityId ?? '');
  const [toCityId, setToCityId] = useState(draft?.search.toCityId ?? '');
  const [date, setDate] = useState(draft?.search.date ?? '');
  const [returnDate, setReturnDate] = useState(draft?.search.returnDate ?? '');
  const [pax, setPax] = useState(draft?.search.pax ?? 1);

  const fromCities = useBusGeoCities(fromStateId || undefined);
  const toCities = useBusGeoCities(toStateId || undefined);

  // SelectField is string-valued; keep id ⇄ name maps for the geo rows.
  const stateNameById = useMemo(
    () => new Map((geoStates.data ?? []).map((s) => [s.id, s.name])),
    [geoStates.data],
  );
  const stateIdByName = useMemo(
    () => new Map((geoStates.data ?? []).map((s) => [s.name, s.id])),
    [geoStates.data],
  );
  const fromCityNameById = useMemo(
    () => new Map((fromCities.data ?? []).map((c) => [c.id, c.name])),
    [fromCities.data],
  );
  const fromCityIdByName = useMemo(
    () => new Map((fromCities.data ?? []).map((c) => [c.name, c.id])),
    [fromCities.data],
  );
  const toCityNameById = useMemo(
    () => new Map((toCities.data ?? []).map((c) => [c.id, c.name])),
    [toCities.data],
  );
  const toCityIdByName = useMemo(
    () => new Map((toCities.data ?? []).map((c) => [c.name, c.id])),
    [toCities.data],
  );

  // Origin and destination states/cities can never be identical.
  const fromStateOptions = useMemo(
    () => (geoStates.data ?? []).filter((s) => s.id !== toStateId).map((s) => s.name),
    [geoStates.data, toStateId],
  );
  const toStateOptions = useMemo(
    () => (geoStates.data ?? []).filter((s) => s.id !== fromStateId).map((s) => s.name),
    [geoStates.data, fromStateId],
  );
  const fromCityOptions = useMemo(
    () => (fromCities.data ?? []).filter((c) => c.id !== toCityId).map((c) => c.name),
    [fromCities.data, toCityId],
  );
  const toCityOptions = useMemo(
    () => (toCities.data ?? []).filter((c) => c.id !== fromCityId).map((c) => c.name),
    [toCities.data, fromCityId],
  );

  const canSearch =
    Boolean(fromStateId && toStateId && date) &&
    fromStateId !== toStateId &&
    fromCityId !== toCityId &&
    (tripType === 'oneway' || Boolean(returnDate));

  const onSearch = () => {
    if (!canSearch) return;
    startBusDraft({
      fromStateId,
      toStateId,
      fromCityId: fromCityId || undefined,
      toCityId: toCityId || undefined,
      fromState: stateNameById.get(fromStateId),
      toState: stateNameById.get(toStateId),
      fromCity: fromCityNameById.get(fromCityId),
      toCity: toCityNameById.get(toCityId),
      date,
      pax,
      tripType,
      returnDate: tripType === 'return' ? returnDate : undefined,
    });
    router.push('/mobility/bus/results');
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <View style={styles.tripKindWrap}>
        <SegmentedControl<BusTripType>
          value={tripType}
          onChange={(t) => { setTripType(t); if (t === 'oneway') setReturnDate(''); }}
          options={[
            { value: 'oneway', label: 'One-way' },
            { value: 'return', label: 'Return' },
          ]}
        />
      </View>

      <View style={[styles.hero, shadow1]}>
        <View style={styles.heroIcon}><BusFront size={22} color={Colors.primary} strokeWidth={2.2} /></View>
        <Text style={styles.heroTitle}>{tripType === 'return' ? 'Book there and back' : 'Travel between cities'}</Text>
        <Text style={styles.heroSub}>
          {tripType === 'return'
            ? 'Pick an outbound and a return departure — one booking covers both legs.'
            : 'Compare verified operators, board at intermediate stops, and travel with a QR boarding pass.'}
        </Text>
      </View>

      <View style={styles.searchCard}>
        {geoStates.isLoading ? (
          <StateView kind="loading" compact message="Loading destinations…" />
        ) : geoStates.isError ? (
          <MobilityEdgeState kind={errKind(geoStates.error)} compact actionLabel="Retry" onAction={() => geoStates.refetch()} />
        ) : (
          <>
            <SelectField
              label="From (state)"
              placeholder="Departure state"
              value={stateNameById.get(fromStateId) ?? ''}
              options={fromStateOptions}
              onChange={(name) => { setFromStateId(stateIdByName.get(name) ?? ''); setFromCityId(''); }}
            />
            {fromStateId ? (
              <SelectField
                label="From (city / terminal area)"
                placeholder={fromCities.isLoading ? 'Loading cities…' : 'Any city (optional)'}
                value={fromCityNameById.get(fromCityId) ?? ''}
                options={fromCityOptions}
                onChange={(name) => setFromCityId(fromCityIdByName.get(name) ?? '')}
                disabled={fromCities.isLoading}
              />
            ) : null}
            <SelectField
              label="To (state)"
              placeholder="Destination state"
              value={stateNameById.get(toStateId) ?? ''}
              options={toStateOptions}
              onChange={(name) => { setToStateId(stateIdByName.get(name) ?? ''); setToCityId(''); }}
            />
            {toStateId ? (
              <SelectField
                label="To (city / terminal area)"
                placeholder={toCities.isLoading ? 'Loading cities…' : 'Any city (optional)'}
                value={toCityNameById.get(toCityId) ?? ''}
                options={toCityOptions}
                onChange={(name) => setToCityId(toCityIdByName.get(name) ?? '')}
                disabled={toCities.isLoading}
              />
            ) : null}

            <DatePickerField
              label="Departure date"
              value={date}
              onChange={setDate}
              minYear={new Date().getFullYear()}
              maxYear={new Date().getFullYear() + 2}
            />
            {tripType === 'return' ? (
              <DatePickerField
                label="Return date"
                value={returnDate}
                onChange={setReturnDate}
                minYear={new Date().getFullYear()}
                maxYear={new Date().getFullYear() + 2}
              />
            ) : null}

            <View style={styles.paxRow}>
              <Text style={styles.paxLabel}>Passengers</Text>
              <View style={styles.paxStepper}>
                <Pressable
                  style={[styles.paxBtn, pax <= 1 && styles.paxBtnDisabled]}
                  onPress={() => setPax((p) => Math.max(1, p - 1))}
                  disabled={pax <= 1}
                  accessibilityLabel="Reduce passengers"
                  accessibilityRole="button"
                >
                  <Minus size={16} color={pax <= 1 ? Colors.outline : Colors.primary} strokeWidth={2.4} />
                </Pressable>
                <Text style={styles.paxCount} accessibilityLabel={`${pax} passengers`}>{pax}</Text>
                <Pressable
                  style={[styles.paxBtn, pax >= MAX_PAX && styles.paxBtnDisabled]}
                  onPress={() => setPax((p) => Math.min(MAX_PAX, p + 1))}
                  disabled={pax >= MAX_PAX}
                  accessibilityLabel="Add passenger"
                  accessibilityRole="button"
                >
                  <Plus size={16} color={pax >= MAX_PAX ? Colors.outline : Colors.primary} strokeWidth={2.4} />
                </Pressable>
              </View>
            </View>

            {draft?.legs.length ? (
              <Pressable onPress={clearBusDraft} accessibilityRole="button">
                <Text style={styles.clearDraft}>Discard the in-progress booking ({draft.legs.length} leg{draft.legs.length === 1 ? '' : 's'} held)</Text>
              </Pressable>
            ) : null}

            <PrimaryButton label={tripType === 'return' ? 'Search return trips' : 'Search buses'} onPress={onSearch} disabled={!canSearch} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

// PROVIDERS — browse operators (v1 directory unchanged; state filter is geo-fed)
function ProvidersTab() {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const providers = useBusProviders(state || undefined, q || undefined);
  const geoStates = useBusGeoStates();
  const stateOptions = useMemo(
    () => ['All states', ...(geoStates.data ?? []).map((s) => s.name)],
    [geoStates.data],
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <View style={styles.searchCard}>
        <View style={styles.searchInputRow}>
          <SearchIcon size={16} color={Colors.outline} strokeWidth={2} />
          <TextInput
            style={styles.bareInput}
            value={q}
            onChangeText={setQ}
            placeholder="Search operators by name"
            placeholderTextColor={Colors.outline}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        <SelectField
          label="Base state"
          placeholder="All states"
          value={state}
          options={stateOptions}
          onChange={(v) => setState(v === 'All states' ? '' : v)}
        />
      </View>

      {providers.isLoading ? (
        <StateView kind="loading" compact message="Loading operators…" />
      ) : providers.isError ? (
        <MobilityEdgeState kind={errKind(providers.error)} compact actionLabel="Retry" onAction={() => providers.refetch()} />
      ) : (providers.data?.length ?? 0) === 0 ? (
        <MobilityEdgeState kind="empty" compact title="No operators" message="No providers match your filters." />
      ) : (
        providers.data!.map((p) => <ProviderCard key={p.id} provider={p} />)
      )}
    </ScrollView>
  );
}

function ProviderCard({ provider }: { provider: BusProviderListItem }) {
  return (
    <Pressable style={styles.providerCard} onPress={() => router.push(`/mobility/bus/provider/${provider.id}`)}>
      <View style={styles.providerCardIcon}><BusFront size={20} color={Colors.primary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <View style={styles.providerCardTitleRow}>
          <Text style={styles.providerCardName} numberOfLines={1}>{provider.businessName}</Text>
          {provider.verified && (
            <View style={styles.verifiedBadge}>
              <ShieldCheck size={11} color={Colors.tertiaryContainer} strokeWidth={2.4} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          )}
        </View>
        <View style={styles.providerCardMeta}>
          <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
          <Text style={styles.meta}>{provider.ratingAvg.toFixed(1)}</Text>
          <View style={styles.dot} />
          <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta}>{provider.baseState}</Text>
          <View style={styles.dot} />
          <Text style={styles.meta}>{provider.routeCount} route{provider.routeCount === 1 ? '' : 's'}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

// MY TICKETS — v2 bookings list (one row per booking, covers legs + passengers)
function TicketsTab() {
  const bookings = useBusV2Bookings();

  if (bookings.isLoading) return <StateView kind="loading" message="Loading tickets…" />;
  if (bookings.isError) return <MobilityEdgeState kind={errKind(bookings.error)} actionLabel="Retry" onAction={() => bookings.refetch()} />;
  if ((bookings.data?.length ?? 0) === 0) {
    return <MobilityEdgeState kind="empty" title="No tickets yet" message="Book a bus from the Book tab and your tickets will appear here." />;
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => bookings.refetch()} tintColor={Colors.primary} />}
    >
      {bookings.data!.map((b) => (
        <Pressable key={b.bookingRef} style={styles.ticketRow} onPress={() => router.push(`/mobility/bus/ticket/${b.bookingRef}`)}>
          <View style={styles.ticketIcon}><Ticket size={20} color={Colors.primary} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeLine} numberOfLines={1}>{b.routeLabel}</Text>
            <Text style={styles.meta}>
              {dt(b.departureAt)} · {b.passengerCount} pax · {formatNairaWhole(b.totalKobo)}
            </Text>
            <View style={styles.badgeRow}>
              <StatusBadge label={BUS_V2_BOOKING_STATUS_LABEL[b.status]} tone={busV2StatusTone(b.status)} />
            </View>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabsWrap: { paddingBottom: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },

  tripKindWrap: { marginBottom: Spacing.sm },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 6 },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },

  searchCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  searchInputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, height: 52, marginBottom: Spacing.md },
  bareInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },

  paxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  paxLabel: { ...Typography.labelMd, color: Colors.onSurface },
  paxStepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  paxBtn: { width: 36, height: 36, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  paxBtnDisabled: { borderColor: Colors.outlineVariant },
  paxCount: { ...Typography.titleMd, color: Colors.onSurface, minWidth: 24, textAlign: 'center' },
  clearDraft: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },

  resultsWrap: { gap: Spacing.md },
  resultsHeading: { ...Typography.labelMd, color: Colors.onSurfaceVariant },

  providerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginBottom: Spacing.sm },
  providerCardIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  providerCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  providerCardName: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  providerCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  routeLine: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },

  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  ticketIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { marginTop: Spacing.xs },

  providerCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  providerCtaIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  providerCtaTitle: { ...Typography.labelLg, color: Colors.onSurface },
  providerCtaSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
