import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { BusFront, MapPin, Search as SearchIcon, Star, ShieldCheck, Ticket, ChevronRight, Store, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { STATE_NAMES, getLGAsForState } from '@/data/nigeria';
import { BUS_ENABLED, BUS_PHASE_LABEL } from '@/features/mobility/constants/modes.constants';
import { useBusSearch, useBusProviders, useProviderMe } from '@/features/mobility/hooks/useBusMarketplace';
import { useBusTickets } from '@/features/mobility/hooks/useModes';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { BusTrip, BusProviderListItem, BusSearchParams, BusTripKind } from '@/features/mobility/types/busProvider.types';

type Tab = 'book' | 'providers' | 'tickets';

const time = (iso: string) => new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// A real connectivity drop (no HTTP response) is "offline"; a server answer
// (404/5xx/parse) is a backend failure, not the user's network.
const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

export default function BusMarketplaceScreen() {
  // Deep-link params from a provider route "Book" action preselect the Book tab.
  const params = useLocalSearchParams<{ tab?: string; fromState?: string; toState?: string; providerId?: string }>();
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

      {tab === 'book' && <BookTab presetFrom={params.fromState} presetTo={params.toState} presetProviderId={params.providerId} />}
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

// ═══════════════════════════════════════════════════════════════════════════════
// BOOK — inter-state (state → state) OR intra-state (city → city within a state)
// ═══════════════════════════════════════════════════════════════════════════════
function BookTab({ presetFrom, presetTo, presetProviderId }: { presetFrom?: string; presetTo?: string; presetProviderId?: string }) {
  const validPreset = Boolean(presetFrom) && Boolean(presetTo) && presetFrom !== presetTo;
  const [tripKind, setTripKind] = useState<BusTripKind>('inter');

  // Inter-state selection
  const [fromState, setFromState] = useState(validPreset ? String(presetFrom) : '');
  const [toState, setToState] = useState(validPreset ? String(presetTo) : '');
  const [providerId] = useState<string | undefined>(validPreset ? presetProviderId : undefined);

  // Intra-state selection (one state, city → city)
  const [state, setState] = useState('');
  const [fromCity, setFromCity] = useState('');
  const [toCity, setToCity] = useState('');

  const [submitted, setSubmitted] = useState<BusSearchParams | null>(
    validPreset ? { fromState: String(presetFrom), toState: String(presetTo), tripKind: 'inter', providerId } : null,
  );

  // Same-value constraints so origin/destination can never be identical.
  const fromOptions = useMemo(() => STATE_NAMES.filter((s) => s !== toState), [toState]);
  const toOptions = useMemo(() => STATE_NAMES.filter((s) => s !== fromState), [fromState]);
  const cityOptions = useMemo(() => (state ? getLGAsForState(state) : []), [state]);
  const fromCityOptions = useMemo(() => cityOptions.filter((c) => c !== toCity), [cityOptions, toCity]);
  const toCityOptions = useMemo(() => cityOptions.filter((c) => c !== fromCity), [cityOptions, fromCity]);

  const interReady = Boolean(fromState) && Boolean(toState) && fromState !== toState;
  const intraReady = Boolean(state) && Boolean(fromCity) && Boolean(toCity) && fromCity !== toCity;
  const canSearch = tripKind === 'inter' ? interReady : intraReady;

  const search = useBusSearch(submitted ?? { fromState: '', toState: '' }, Boolean(submitted));

  const switchKind = (k: BusTripKind) => { setTripKind(k); setSubmitted(null); };

  const onSearch = () => {
    if (!canSearch) return;
    if (tripKind === 'inter') {
      setSubmitted({ fromState, toState, tripKind: 'inter', providerId });
    } else {
      // Intra-state: single state on both ends, filtered by city/terminal.
      setSubmitted({ fromState: state, toState: state, tripKind: 'intra', fromCity, toCity });
    }
  };

  const summary = submitted
    ? submitted.tripKind === 'intra'
      ? `${submitted.fromCity} → ${submitted.toCity} · ${submitted.fromState}`
      : `${submitted.fromState} → ${submitted.toState}`
    : '';

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <View style={styles.tripKindWrap}>
        <SegmentedControl<BusTripKind>
          value={tripKind}
          onChange={switchKind}
          options={[
            { value: 'inter', label: 'Inter-state' },
            { value: 'intra', label: 'Intra-state' },
          ]}
        />
      </View>

      <View style={[styles.hero, shadow1]}>
        <View style={styles.heroIcon}><BusFront size={22} color={Colors.primary} strokeWidth={2.2} /></View>
        <Text style={styles.heroTitle}>{tripKind === 'inter' ? 'Travel between states' : 'Travel within your state'}</Text>
        <Text style={styles.heroSub}>
          {tripKind === 'inter'
            ? 'Compare verified operators across states, pick a departure, and travel with a QR boarding pass.'
            : 'Book city-to-city shuttles inside one state — same verified operators and QR boarding pass.'}
        </Text>
      </View>

      <View style={styles.searchCard}>
        {tripKind === 'inter' ? (
          <>
            <SelectField label="From (state)" placeholder="Departure state" value={fromState} options={fromOptions} onChange={setFromState} />
            <SelectField label="To (state)" placeholder="Destination state" value={toState} options={toOptions} onChange={setToState} />
          </>
        ) : (
          <>
            <SelectField
              label="State"
              placeholder="Choose a state"
              value={state}
              options={STATE_NAMES}
              onChange={(v) => { setState(v); setFromCity(''); setToCity(''); }}
            />
            <SelectField label="From (city / terminal)" placeholder={state ? 'Departure city' : 'Choose a state first'} value={fromCity} options={fromCityOptions} onChange={setFromCity} />
            <SelectField label="To (city / terminal)" placeholder={state ? 'Destination city' : 'Choose a state first'} value={toCity} options={toCityOptions} onChange={setToCity} />
          </>
        )}
        <PrimaryButton label={tripKind === 'inter' ? 'Search inter-state buses' : 'Search intra-state buses'} onPress={onSearch} disabled={!canSearch} />
      </View>

      {submitted && (
        <View style={styles.resultsWrap}>
          {search.isLoading ? (
            <StateView kind="loading" compact message="Finding buses…" />
          ) : search.isError ? (
            <MobilityEdgeState kind={errKind(search.error)} compact actionLabel="Retry" onAction={() => search.refetch()} />
          ) : (search.data?.length ?? 0) === 0 ? (
            <MobilityEdgeState
              kind="empty"
              compact
              title="No buses found"
              message={submitted.tripKind === 'intra' ? 'No operators run this city pair yet. Try other cities.' : 'No operators run this route yet. Try another state pair.'}
            />
          ) : (
            <>
              <Text style={styles.resultsHeading}>{search.data!.length} departure{search.data!.length === 1 ? '' : 's'} · {summary}</Text>
              {search.data!.map((t) => <TripCard key={t.scheduleId} trip={t} />)}
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export function TripCard({ trip }: { trip: BusTrip }) {
  const soldOut = trip.seatsAvailable <= 0;
  return (
    <Pressable
      style={[styles.tripCard, shadow1, soldOut && styles.tripCardDisabled]}
      disabled={soldOut}
      onPress={() => router.push({ pathname: '/mobility/bus/seats', params: { scheduleId: trip.scheduleId } })}
    >
      <View style={styles.tripHead}>
        <View style={styles.providerChip}>
          <Text style={styles.providerName} numberOfLines={1}>{trip.provider.businessName}</Text>
          {trip.provider.verified && (
            <View style={styles.verifiedBadge}>
              <ShieldCheck size={11} color={Colors.tertiaryContainer} strokeWidth={2.4} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          )}
        </View>
        <View style={styles.ratingRow}>
          <Star size={12} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
          <Text style={styles.rating}>{trip.provider.ratingAvg.toFixed(1)}</Text>
        </View>
      </View>

      <Text style={styles.routeLine}>{trip.fromState} → {trip.toState}</Text>
      <Text style={styles.terminalLine} numberOfLines={1}>{trip.fromCity} → {trip.toCity} · {trip.busType}</Text>
      <Text style={styles.departLine}>Departs {time(trip.departureTime)}</Text>

      {trip.amenities.length > 0 && (
        <View style={styles.amenityRow}>
          {trip.amenities.slice(0, 4).map((a) => (
            <View key={a} style={styles.amenityPill}><Text style={styles.amenityText}>{a}</Text></View>
          ))}
        </View>
      )}

      <View style={styles.tripFooter}>
        {soldOut ? <StatusBadge label="Sold out" tone="danger" /> : <Text style={styles.seatsLeft}>{trip.seatsAvailable} seats left</Text>}
        <View style={styles.fareCol}>
          <Text style={styles.fromLabel}>fare</Text>
          <Text style={styles.fare}>{formatNairaWhole(trip.fareKobo)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDERS — browse operators
// ═══════════════════════════════════════════════════════════════════════════════
function ProvidersTab() {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const providers = useBusProviders(state || undefined, q || undefined);
  const stateOptions = useMemo(() => ['All states', ...STATE_NAMES], []);

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

// ═══════════════════════════════════════════════════════════════════════════════
// MY TICKETS
// ═══════════════════════════════════════════════════════════════════════════════
function TicketsTab() {
  const tickets = useBusTickets();

  if (tickets.isLoading) return <StateView kind="loading" message="Loading tickets…" />;
  if (tickets.isError) return <MobilityEdgeState kind={errKind(tickets.error)} actionLabel="Retry" onAction={() => tickets.refetch()} />;
  if ((tickets.data?.length ?? 0) === 0) {
    return <MobilityEdgeState kind="empty" title="No tickets yet" message="Book a bus from the Book tab and your tickets will appear here." />;
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={tickets.isRefetching} onRefresh={() => tickets.refetch()} tintColor={Colors.primary} />}
    >
      {tickets.data!.map((t) => (
        <Pressable key={t.id} style={styles.ticketRow} onPress={() => router.push(`/mobility/bus/ticket/${t.id}`)}>
          <View style={styles.ticketIcon}><Ticket size={20} color={Colors.primary} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeLine}>{t.routeLabel}</Text>
            <Text style={styles.meta}>{time(t.departAt)} · Seat {t.seatNumber} · {formatNairaWhole(t.fareKobo)}</Text>
            <View style={styles.badgeRow}>
              <StatusBadge label={BUS_PHASE_LABEL[t.phase]} tone={t.phase === 'completed' ? 'success' : t.phase === 'cancelled' || t.phase === 'refunded' ? 'danger' : 'info'} />
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

  resultsWrap: { gap: Spacing.md },
  resultsHeading: { ...Typography.labelMd, color: Colors.onSurfaceVariant },

  tripCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  tripCardDisabled: { opacity: 0.6 },
  tripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  providerChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  providerName: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rating: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  routeLine: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 2 },
  terminalLine: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  departLine: { ...Typography.labelSm, color: Colors.secondary },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  amenityPill: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  amenityText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  tripFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, paddingTop: Spacing.sm },
  seatsLeft: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  fareCol: { alignItems: 'flex-end' },
  fromLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  fare: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },

  providerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginBottom: Spacing.sm },
  providerCardIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  providerCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  providerCardName: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  providerCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },

  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  ticketIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { marginTop: Spacing.xs },

  providerCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  providerCtaIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  providerCtaTitle: { ...Typography.labelLg, color: Colors.onSurface },
  providerCtaSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
