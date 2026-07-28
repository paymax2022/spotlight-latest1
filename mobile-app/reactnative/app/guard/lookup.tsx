import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Phone, MapPin, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import AccessCodeCard from '@/features/visitor/components/AccessCodeCard';
import { useLookup } from '@/features/visitor/hooks/useVisitor';

export default function GuardLookupScreen() {
  const [query, setQuery] = useState('');
  const { data, isLoading, isError } = useLookup(query);
  const ready = query.trim().length >= 2;
  const hasResults = (data?.codes.length ?? 0) + (data?.residents.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Lookup" subtitle="Visitor or resident" />
      <SearchBar placeholder="Code, name, phone, plate or unit…" value={query} onChangeText={setQuery} />

      {!ready ? (
        <StateView kind="empty" icon="Search" title="Search the estate" message="Find a visitor by code, name, phone or plate — or a resident by name or unit." compact />
      ) : isLoading ? (
        <StateView kind="loading" message="Searching…" />
      ) : isError ? (
        <StateView kind="error" title="Search failed" message="Please try again." />
      ) : !hasResults ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message={`Nothing found for "${query.trim()}".`} compact />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {data!.codes.length > 0 ? (
            <>
              <Text style={styles.section}>Visitor codes</Text>
              <View style={styles.group}>
                {data!.codes.map((c) => (
                  <AccessCodeCard key={c.id} code={c} onPress={() => router.push(`/guard/confirm/${c.codeValue}`)} />
                ))}
              </View>
            </>
          ) : null}

          {data!.residents.length > 0 ? (
            <>
              <Text style={styles.section}>Residents</Text>
              <View style={styles.card}>
                {data!.residents.map((r, i) => (
                  <Pressable
                    key={r.id}
                    onPress={() => Linking.openURL(`tel:${r.phone}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${r.name}`}
                    style={[styles.resRow, i > 0 && styles.divider]}
                  >
                    <View style={styles.avatar}><Text style={styles.avatarText}>{r.name.charAt(0)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resName}>{r.name}</Text>
                      <Text style={styles.resMeta}><MapPin size={12} color={Colors.onSurfaceVariant} /> {r.unitLabel}</Text>
                    </View>
                    <Phone size={18} color={Colors.secondary} strokeWidth={1.8} />
                    <ChevronRight size={16} color={Colors.outline} strokeWidth={1.8} />
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  group: { gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md },
  resRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  divider: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: Colors.onPrimary },
  resName: { ...Typography.labelMd, color: Colors.onSurface },
  resMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
