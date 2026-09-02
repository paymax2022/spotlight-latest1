import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, IdCard, KeyRound, QrCode, Ticket, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SearchBar from '@/components/SearchBar';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import PromoBanner from '@/components/PromoBanner';
import OrganisationCard from '@/features/association/components/OrganisationCard';
import QuickNav from '@/features/association/components/QuickNav';
import { useOrganisations } from '@/features/association/hooks/useAssociation';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function AssociationDiscovery() {
  const [search, setSearch] = useState('');
  const orgs = useOrganisations(search);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Spotlight</Text>
          <Text style={styles.headerTitle}>Associations</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable
            onPress={() => router.push('/association/home')}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityLabel="My membership"
          >
            <IdCard size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <SearchBar
          placeholder="Search associations, unions, alumni…"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {orgs.isLoading ? (
        <StateView kind="loading" message="Finding organisations…" />
      ) : orgs.isError ? (
        <StateView
          kind="error"
          title="Couldn't load organisations"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => orgs.refetch()}
        />
      ) : (orgs.data?.length ?? 0) === 0 ? (
        <StateView
          kind="empty"
          icon="Search"
          title={search ? 'No matches' : 'No organisations yet'}
          message={search ? `Nothing matches “${search}”.` : 'New organisations will appear here.'}
        />
      ) : (
        <FlatList
          data={orgs.data ?? []}
          keyExtractor={(o) => o.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              {!search ? (
                <View style={styles.bannerBleed}>
                  <PromoBanner
                    title="Run your association online"
                    subtitle="Dues, elections, events and digital member IDs — all in one place."
                    cta="Create an organisation"
                    onPress={() => router.push('/association/create')}
                  />
                </View>
              ) : null}
              {!search ? (
                <>
                  {/* The module's navigation. Without this, every section
                      (dues, meetings, chat, documents, voting…) was reachable
                      only from /association/home, and the sole route there was
                      an unlabelled ID-card icon in the header — so this screen
                      was a dead end for anyone who did not already know the
                      URLs. Hidden while searching: a result list should not
                      have a menu wedged above it. */}
                  <SectionHeader title="Your association" style={styles.sectionGap} />
                  <QuickNav />
                </>
              ) : null}
              {!search ? (
                <View style={styles.codeRow}>
                  <CodeChip icon={<Ticket size={18} color={Colors.primary} strokeWidth={2} />} label="Invite code" onPress={() => router.push('/association/join/invite')} />
                  <CodeChip icon={<KeyRound size={18} color={Colors.primary} strokeWidth={2} />} label="Access code" onPress={() => router.push('/association/join/access-code')} />
                  <CodeChip icon={<QrCode size={18} color={Colors.primary} strokeWidth={2} />} label="Scan QR" onPress={() => router.push('/association/join/scan')} />
                </View>
              ) : null}
              <SectionHeader title={search ? 'Results' : 'Discover organisations'} style={styles.sectionGap} />
            </>
          }
          renderItem={({ item }) => (
            <OrganisationCard organisation={item} onPress={() => router.push(`/association/organisation/${item.id}`)} />
          )}
        />
      )}

      <Pressable onPress={() => router.push('/association/create')} style={styles.fab} accessibilityLabel="Create organisation">
        <Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} />
        <Text style={styles.fabLabel}>Create</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function CodeChip({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.codeChip, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.codeIcon}>{icon}</View>
      <Text style={styles.codeLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  bannerBleed: { marginHorizontal: -Spacing.containerMargin },
  codeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  codeChip: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.md },
  codeIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  codeLabel: { ...Typography.labelSm, color: Colors.onSurface },
  fab: { position: 'absolute', right: Spacing.containerMargin, bottom: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.lg, height: 52, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  fabLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  searchWrap: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  sectionGap: { marginTop: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
});
