// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMeeting } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface AgendaItem { title: string; description?: string; timeAllocation?: string; presenter?: string; }

export default function MeetingAgenda() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: meeting, isLoading, isError, refetch } = useQuery({
    queryKey: ['meeting', estateId, id],
    queryFn: () => getMeeting(estateId, id),
    staleTime: 30_000,
  });

  // Parse agenda items from meeting.agenda string (newline separated) or empty
  const agendaItems: AgendaItem[] = meeting?.agenda
    ? meeting.agenda.split('\n').filter(Boolean).map((line, i) => ({ title: line, description: '', timeAllocation: '', presenter: '' }))
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Agenda</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Failed to load agenda</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {agendaItems.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="list-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No agenda items added yet</Text>
            </View>
          ) : agendaItems.map((item, index) => (
            <View key={index} style={styles.card}>
              <Pressable style={styles.itemHeader} onPress={() => setExpanded(expanded === index ? null : index)}>
                <View style={styles.numBadge}>
                  <Text style={styles.numText}>{index + 1}</Text>
                </View>
                <Text style={[styles.itemTitle, { flex: 1 }]}>{item.title}</Text>
                <Ionicons name={expanded === index ? 'chevron-up' : 'chevron-down'} size={18} color={colors.neutral.placeholder} />
              </Pressable>
              {expanded === index ? (
                <View style={styles.itemBody}>
                  {item.description ? <Text style={styles.bodyText}>{item.description}</Text> : null}
                  {item.timeAllocation ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="time-outline" size={14} color={colors.neutral.textMuted} />
                      <Text style={styles.metaText}>{item.timeAllocation}</Text>
                    </View>
                  ) : null}
                  {item.presenter ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="person-outline" size={14} color={colors.neutral.textMuted} />
                      <Text style={styles.metaText}>{item.presenter}</Text>
                    </View>
                  ) : null}
                  {!item.description && !item.timeAllocation && !item.presenter ? (
                    <Text style={styles.emptyText}>No additional details</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  numBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  numText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  itemBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4, gap: 6, borderTopWidth: 1, borderTopColor: colors.neutral.border },
  bodyText: { fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: colors.neutral.textMuted },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10, margin: 20 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
