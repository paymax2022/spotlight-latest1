import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Ticket as TicketIcon, Plus, Search, Bell, ReceiptText, Inbox, LifeBuoy } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import EventCard from '@/features/events/components/EventCard';
import { useEvents } from '@/features/events/hooks';
import { EVENT_CATEGORIES, EventColors, API_BASE, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';
import { HomeMenuButton } from '@/components/HomeMenu';
import EventsTabBar from '@/features/events/components/EventsTabBar';
import type { EventQuery, EventSort } from '@/features/events/types';

// Sort chips mirror the server's whitelisted ORDER BY choices exactly; anything
// else the backend silently falls back to date_asc, so the chip label has to
// promise what the SQL actually does.
const SORTS: { value: EventSort; label: string }[] = [
  { value: 'date_asc',   label: 'Soonest' },
  { value: 'date_desc',  label: 'Latest' },
  { value: 'price_asc',  label: 'Cheapest' },
  { value: 'price_desc', label: 'Dearest' },
];

type DatePreset = 'any' | 'today' | 'week' | 'month';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'any',   label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'week',  label: 'This week' },
  { value: 'month', label: 'This month' },
];

// The window the server filters on (starts_at, RFC3339 bounds). Computed from
// local midnight so "Today" means today here, not the UTC day.
function dateWindow(preset: DatePreset): { from?: string; to?: string } {
  if (preset === 'any') return {};
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (preset === 'today') end.setHours(23, 59, 59, 999);
  if (preset === 'week')  end.setDate(start.getDate() + 7);
  if (preset === 'month') end.setMonth(start.getMonth() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export default function EventsDiscovery() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [sort, setSort] = useState<EventSort>('date_asc');
  const [preset, setPreset] = useState<DatePreset>('any');
  const [city, setCity] = useState('');

  // One request per pause in typing, not per keystroke: the search is server-side
  // over title + venue, so a request per character would queue a query each one.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const params = useMemo<EventQuery>(() => {
    const p: EventQuery = { sort };
    if (cat !== 'all') p.category = cat;
    if (debounced) p.q = debounced;
    const w = dateWindow(preset);
    if (w.from) p.from = w.from;
    if (w.to)   p.to   = w.to;
    // events.city exists only behind the commerce migration; sending the filter
    // any other way would look like a working chip that does nothing.
    if (EVENTS_COMMERCE_ENABLED && city.trim()) p.city = city.trim();
    return p;
  }, [cat, debounced, sort, preset, city]);

  const { data, isLoading, isError, refetch } = useEvents(params);
  const list = Array.isArray(data) ? data : [];
  const filtering = !!(debounced || preset !== 'any' || (EVENTS_COMMERCE_ENABLED && city.trim()));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Events</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {EVENTS_COMMERCE_ENABLED ? (
            <Pressable onPress={() => router.push('/events/notifications')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Event inbox">
              <Bell size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/events/my-tickets')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="My tickets">
            <TicketIcon size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      <Image
        source={{ uri: 'https://res.cloudinary.com/paymax/image/upload/v1792955031/Unforgettable_Nigerian_events_await_yz6iy6.png' }}
        style={styles.heroBanner}
      />

      <SearchBar placeholder="Search events, venues…" value={query} onChangeText={setQuery} />
      <View style={styles.filterWrap}>
        <SegmentedControl scrollable options={EVENT_CATEGORIES as any} value={cat} onChange={setCat} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {DATE_PRESETS.map((d) => (
          <Chip key={d.value} label={d.label} active={preset === d.value} onPress={() => setPreset(d.value)} />
        ))}
        <View style={styles.chipDivider} />
        {SORTS.map((s) => (
          <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />
        ))}
      </ScrollView>

      {EVENTS_COMMERCE_ENABLED ? (
        <View style={{ marginTop: Spacing.sm }}>
          <TextInputField
            label="City"
            placeholder="Lagos, Abuja, Port Harcourt…"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
            leftIcon={<Search size={16} color={EventColors.muted} />}
            returnKeyType="search"
          />
        </View>
      ) : null}

      {EVENTS_COMMERCE_ENABLED ? (
        <View style={styles.ledgerRow}>
          <LedgerLink Icon={ReceiptText} label="My orders" href="/events/orders" />
          <LedgerLink Icon={Inbox}    label="My refunds" href="/events/refunds" />
          <LedgerLink Icon={LifeBuoy} label="Support" href="/events/support" />
        </View>
      ) : null}

      {isLoading ? (
        <StateView kind="loading" message="Loading events…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load events" message="Please check your connection and try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : list.length === 0 ? (
        <StateView
          kind="empty"
          title="No events found"
          message={filtering ? 'Nothing matches these filters. Try widening the date or clearing the city.' : 'Try a different category or search term.'}
          icon="Ticket"
          actionLabel={filtering ? 'Clear filters' : 'Browse all events'}
          onAction={() => { setQuery(''); setDebounced(''); setCity(''); setPreset('any'); setSort('date_asc'); setCat('all'); }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {list.map((e) => (
            <EventCard key={e.id} event={e} onPress={() => router.push(`/events/${e.id}`)} />
          ))}
          <Pressable style={styles.organiserCta} onPress={() => router.push('/events/organiser/dashboard')}>
            <Plus size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.organiserText}>Organising an event? Open dashboard</Text>
          </Pressable>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
      <EventsTabBar />
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function LedgerLink({ Icon, label, href }: { Icon: typeof ReceiptText; label: string; href: typeof API_BASE extends string ? string : never }) {
  return (
    <Pressable onPress={() => router.push(href as never)} style={styles.ledgerBtn} accessibilityRole="link" accessibilityLabel={label}>
      <Icon size={16} color={EventColors.brand} strokeWidth={1.9} />
      <Text style={styles.ledgerText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroBanner: { width: '100%', height: 180, marginHorizontal: 0, marginVertical: Spacing.md },
  filterWrap: { marginBottom: Spacing.sm },
  chipRow: { gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipActive: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  chipDivider: { width: 1, backgroundColor: Colors.outlineVariant, marginHorizontal: Spacing.xs },
  ledgerRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md, paddingHorizontal: Spacing.containerMargin },
  ledgerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow },
  ledgerText: { ...Typography.labelMd, color: EventColors.brand },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  organiserCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, marginTop: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  organiserText: { ...Typography.labelMd, color: Colors.primary },
});
