import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Platform, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Send, ArrowDown, RefreshCw, ArrowUpRight, Gift } from 'lucide-react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AppHeader from '@/components/AppHeader';
import SearchBar from '@/components/SearchBar';
import BalanceCard from '@/components/BalanceCard';
import ModuleGrid from '@/components/ModuleGrid';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { SERVICE_MODULES, QUICK_ACTIONS } from '@/constants/modules';
import type { ServiceModule } from '@/constants/modules';
import { useModuleVisibility } from '@/features/modules/visibility';
import {
  registryKeyFor,
  quickActionRegistryKeyFor,
} from '@/features/modules/serviceModuleKeys';
import { getDashboard } from '@/api/dashboard.api';

// 16px glyphs keep each chip as narrow as its label allows. At 390px the four
// still wrap 3+1 in the flex row — measured in the browser — but nothing is
// clipped, which 20px icons did cause.
const QUICK_ACTION_ICONS: Record<string, React.ReactNode> = {
  add:      <Plus      size={16} color={Colors.onPrimary} strokeWidth={2} />,
  send:     <Send      size={16} color={Colors.onPrimary} strokeWidth={2} />,
  withdraw: <ArrowDown size={16} color={Colors.onPrimary} strokeWidth={2} />,
  exchange: <RefreshCw size={16} color={Colors.onPrimary} strokeWidth={2} />,
};

// The landing screen's first row is a short list of repeat tasks, lifted from the
// prototype's "Everyday" concept. These are real SERVICE_MODULES ids, so every
// tile keeps its own route, tint and registry gate — unpublishing a module in
// /admin/modules removes it from this row too. 'data' is deliberately not here
// (the prototype pairs it with airtime); it stays on the Services tab, which the
// "All services" action below links to.
const ESSENTIAL_SERVICE_IDS = [
  'transfer', 'airtime', 'electricity', 'cable-tv',
  'telemedicine', 'ride', 'food', 'events',
] as const;

const MODULE_BY_ID = new Map<string, ServiceModule>(SERVICE_MODULES.map((m) => [m.id, m]));

// --- Landing-only block shapes ----------------------------------------------
// Eyebrow + headline section lead, the referral strip and the editorial feature
// panel. They live in this screen because nothing else renders this composition.
// The landing no longer uses the shared SectionHeader at all — SectionLead's own
// action carries the only link out, "All services".

function SectionLead({ eyebrow, title, actionLabel, onAction }: {
  eyebrow:      string;
  title:        string;
  actionLabel?: string;
  onAction?:    () => void;
}) {
  return (
    <View style={styles.leadRow}>
      <View style={styles.leadText}>
        <Text style={styles.leadEyebrow}>{eyebrow}</Text>
        <Text style={styles.leadTitle}>{title}</Text>
      </View>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={10} style={styles.leadAction}>
          <Text style={styles.leadActionText}>{actionLabel}</Text>
          <ArrowUpRight size={14} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ReferralStrip({ label, route }: { label: string; route: string }) {
  return (
    <Pressable
      onPress={() => router.push(route as never)}
      style={({ pressed }) => [styles.refRow, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.refIconChip}>
        <Gift size={18} color={Colors.onWarning} strokeWidth={2} />
      </View>
      <View style={styles.refText}>
        <Text style={styles.refTitle}>Bring your people along</Text>
        <Text style={styles.refSubtitle}>Explore {label}</Text>
      </View>
      <ArrowUpRight size={16} color={Colors.onWarning} strokeWidth={2.2} />
    </Pressable>
  );
}

function AcademyFeature({ route }: { route: string }) {
  return (
    <Pressable
      onPress={() => router.push(route as never)}
      style={({ pressed }) => [styles.featCard, pressed && { opacity: 0.92 }]}
    >
      {/* Painted first so the glyph sits behind the copy, the way the
          prototype's ::after ornament does. */}
      <Text style={styles.featMark} accessibilityElementsHidden>✦</Text>
      <Text style={styles.featEyebrow}>Explore your potential</Text>
      <Text style={styles.featTitle}>Your story.{'\n'}Your next chapter.</Text>
      <View style={styles.featLinkRow}>
        <Text style={styles.featLink}>Discover Film Academy</Text>
        <ArrowUpRight size={14} color={Colors.onPrimaryFixed} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [search, setSearch] = React.useState('');

  // Registry gate for every home surface. Each has its OWN id-space, so each
  // resolves through its own map — 'withdraw'/'exchange' are quick-action ids
  // that do not exist as service tiles, so QUICK_ACTIONS cannot be gated with
  // registryKeyFor.
  const { isVisible } = useModuleVisibility();
  const gate = React.useCallback(
    (key: string | null) => key === null || isVisible(key),
    [isVisible],
  );

  const quickActions = React.useMemo(
    () => QUICK_ACTIONS.filter((qa) => gate(quickActionRegistryKeyFor(qa.id))),
    [gate],
  );

  // The landing blocks, on the same gate as the tiles. Each strip that has no
  // visible module renders nothing at all, so a hidden referral or academy
  // programme leaves no dead tap target.
  const essentials = React.useMemo(
    () =>
      ESSENTIAL_SERVICE_IDS
        .map((id) => MODULE_BY_ID.get(id))
        .filter((m): m is ServiceModule => Boolean(m))
        .filter((m) => gate(registryKeyFor(m.id))),
    [gate],
  );
  const referral     = MODULE_BY_ID.get('referral');
  const filmAcademy  = MODULE_BY_ID.get('film-academy');
  const showReferral = referral ? gate(registryKeyFor(referral.id)) : false;
  const showAcademy  = filmAcademy ? gate(registryKeyFor(filmAcademy.id)) : false;

  const runSearch = (text: string) => {
    const q = text.trim();
    if (!q) return;
    router.push({ pathname: '/(tabs)/services', params: { q } });
  };

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  getDashboard,
    retry: (failureCount, err) => {
      // Don't retry auth failures — redirect instead.
      if (err instanceof Error && err.message === 'Not authenticated') return false;
      return failureCount < 2;
    },
  });

  // Redirect to login on auth failure (session expired / not logged in).
  React.useEffect(() => {
    if (error instanceof Error && error.message === 'Not authenticated') {
      router.replace('/(auth)/login');
    }
  }, [error]);

  const balance  = data?.wallet.balance ?? 0;
  const userName = data?.user.fullName?.split(' ')[0] ?? 'there';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        <AppHeader name={userName} notifCount={0} />
        <SearchBar placeholder="Find a service" value={search} onChangeText={setSearch} onSubmit={runSearch} />

        {isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Could not load dashboard. Pull down to retry.</Text>
          </View>
        ) : null}

        <BalanceCard
          compact
          balance={balance}
          currency="NGN"
          balanceUnavailable={data?.wallet.balanceUnavailable}
          unavailableHint="Couldn’t load your balance — pull down to refresh"
          quickActions={quickActions.map((qa) => ({
            id:      qa.id,
            label:   qa.label,
            icon:    QUICK_ACTION_ICONS[qa.id],
            onPress: () => { try { router.push(qa.route as never); } catch {} },
          }))}
        />

        {essentials.length > 0 ? (
          <>
            <SectionLead
              eyebrow="Your daily essentials"
              title="What’s on today?"
              actionLabel="All services"
              onAction={() => router.push('/(tabs)/services')}
            />
            <ModuleGrid modules={essentials} compact />
          </>
        ) : null}

        {showReferral && referral ? (
          <ReferralStrip label={referral.label} route={referral.route} />
        ) : null}

        {showAcademy && filmAcademy ? (
          <AcademyFeature route={filmAcademy.route} />
        ) : null}

        {/* The landing page ends here. What used to sit below — the grouped
            catalogue, featured services, the contest/event/ad banners and recent
            activity — stays reachable from the Services and Wallet tabs, and the
            essentials row above links straight into it via "All services". */}

        <View style={{ height: Platform.OS === 'ios' ? 100 : 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { paddingBottom: Spacing.xl },
  loader:  { paddingVertical: Spacing.xl, alignItems: 'center' },
  errorBox:{ marginHorizontal: Spacing.containerMargin, padding: Spacing.md, backgroundColor: 'rgba(220,38,38,0.06)', borderRadius: Radius.lg, marginBottom: Spacing.md },
  errorText:{ ...Typography.labelSm, color: Colors.error, textAlign: 'center' },

  // --- Landing-only composition (prototype 01 "Everyday") ---
  // Eyebrow + headline, action pinned to the headline's baseline like the
  // prototype's `.section-head{align-items:end}`.
  leadRow: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.containerMargin,
    marginTop:         Spacing.lg,
    marginBottom:      Spacing.md,
  },
  leadText:   { flexShrink: 1, gap: 2 },
  leadEyebrow: {
    ...Typography.caption,
    fontSize:      10,
    lineHeight:    14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    fontWeight:    '700',
    color:         Colors.onSurfaceVariant,
  },
  leadTitle: {
    ...Typography.titleMd,
    letterSpacing: -0.7,
    color:         Colors.onSurface,
  },
  leadAction: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           2,
    paddingLeft:   Spacing.sm,
    paddingBottom: 3,
  },
  leadActionText: { ...Typography.labelSm, color: Colors.primary },

  // Refer & Earn — one-line strip in the brand's gold accent tint (the prototype
  // uses a warm cream card here; onWarning is the token for text on gold).
  refRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.sm,
    marginHorizontal:  Spacing.containerMargin,
    marginTop:         Spacing.lg,
    paddingVertical:   12,
    paddingHorizontal: Spacing.md,
    borderWidth:       1,
    borderColor:       'rgba(234,179,8,0.32)',
    backgroundColor:   Colors.iconBgGold,
    borderRadius:      Radius.md,
  },
  refIconChip: {
    width:             38,
    height:            38,
    borderRadius:      Radius.DEFAULT,
    backgroundColor:   'rgba(234,179,8,0.22)',
    alignItems:        'center',
    justifyContent:    'center',
  },
  refText:      { flex: 1, gap: 1 },
  refTitle:     { ...Typography.labelSm, fontWeight: '700', color: Colors.onSurface },
  refSubtitle:  { ...Typography.caption, color: Colors.onSurfaceVariant },

  // Film Academy — editorial panel on the brand's fixed light-purple surface.
  featCard: {
    marginHorizontal:  Spacing.containerMargin,
    marginTop:         Spacing.lg,
    marginBottom:      Spacing.lg,
    padding:           Spacing.cardPadding,
    borderRadius:      Radius.lg,
    backgroundColor:   Colors.primaryFixed,
    overflow:          'hidden',
  },
  featMark: {
    position:      'absolute',
    right:         -2,
    bottom:        -34,
    fontSize:      110,
    lineHeight:    120,
    letterSpacing: 0,
    color:         'rgba(52,0,115,0.10)',
  },
  featEyebrow: {
    ...Typography.caption,
    fontSize:      10,
    lineHeight:    14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    fontWeight:    '700',
    color:         Colors.onPrimaryFixedVariant,
  },
  featTitle: {
    ...Typography.headlineMd,
    lineHeight:    28,
    letterSpacing: -1,
    marginTop:     Spacing.sm,
    marginBottom:  Spacing.md,
    color:         Colors.onPrimaryFixed,
  },
  featLinkRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           2,
  },
  featLink: { ...Typography.labelSm, color: Colors.onPrimaryFixed },
});
