import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Ticket as TicketIcon, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import EventCard from '@/features/events/components/EventCard';
import { useEvents } from '@/features/events/hooks';
import { EVENT_CATEGORIES } from '@/features/events/constants/events.constants';

export default function EventsDiscovery() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>('all');
  const { data, isLoading, isError, refetch } = useEvents(cat !== 'all' ? { category: cat } : undefined);

  const filtered = useMemo(() => {
    let list = Array.isArray(data) ? data : [];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((e) => e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q));
    }
    return list;
  }, [data, query]);

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
        <Pressable onPress={() => router.push('/events/my-tickets')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="My tickets">
          <TicketIcon size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <SearchBar placeholder="Search events, venues, cities…" value={query} onChangeText={setQuery} />
      <View style={styles.filterWrap}>
        <SegmentedControl scrollable options={EVENT_CATEGORIES as any} value={cat} onChange={setCat} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading events…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load events" message="Please check your connection and try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" title="No events found" message="Try a different category or search term." icon="Ticket" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {filtered.map((e) => (
            <EventCard key={e.id} event={e} onPress={() => router.push(`/events/${e.id}`)} />
          ))}
          <Pressable style={styles.organiserCta} onPress={() => router.push('/events/organiser/dashboard')}>
            <Plus size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.organiserText}>Organising an event? Open dashboard</Text>
          </Pressable>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  filterWrap: { marginBottom: Spacing.md },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  organiserCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, marginTop: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  organiserText: { ...Typography.labelMd, color: Colors.primary },
});
