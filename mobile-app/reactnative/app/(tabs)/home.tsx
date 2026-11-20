import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Platform, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Send, ArrowDown, RefreshCw, ArrowUpRight, Gift } from 'lucide-react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AppHeader from '@/components/AppHeader';
import SearchBar from '@/components/SearchBar';
import BalanceCard from '@/components/BalanceCard';
import BannerCarousel from '@/components/BannerCarousel';
import ModuleGrid from '@/components/ModuleGrid';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { SERVICE_MODULES, QUICK_ACTIONS, LANDING_BANNERS, HOME_CONTEST_SERVICE_IDS } from '@/constants/modules';
import type { ServiceModule } from '@/constants/modules';
import { useModuleVisibility } from '@/features/modules/visibility';
import {
  registryKeyFor,
  quickActionRegistryKeyFor,
} from '@/features/modules/serviceModuleKeys';
import { getDashboard } from '@/api/dashboard.api';
import { useBalances } from '@/features/fx/hooks/useFx';

// 20px glyphs on 44pt tiles — the hero card's own scale, and what the wallet
// tab's card already uses, so the two cards cannot look like different controls.
const QUICK_ACTION_ICONS: Record<string, React.ReactNode> = {
  add:      <Plus      size={20} color={Colors.onPrimary} strokeWidth={2} />,
  send:     <Send      size={20} color={Colors.onPrimary} strokeWidth={2} />,
  withdraw: <ArrowDown size={20} color={Colors.onPrimary} strokeWidth={2} />,
  exchange: <RefreshCw size={20} color={Colors.onPrimary} strokeWidth={2} />,
};

// The hero card's currency switch. NGN is the spendable naira wallet the
// dashboard read already returns; USD is a real held pot, fetched from the same
// endpoint the FX hub drives (GET /api/v1/fx/balances → orch_balances), never a
// client-side conversion of the naira figure. Both codes are always offered:
// tapping USD with no pot yet shows a true $0.00 rather than hiding the option.
const HERO_CURRENCIES = ['NGN', 'USD'] as const;
type HeroCurrency = (typeof HERO_CURRENCIES)[number];

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

// The entertainment shelf, rendered directly after the essentials row above (so
// it is the row immediately under Event Tickets). Its ids live in
// constants/modules.ts as HOME_CONTEST_SERVICE_IDS, next to the tiles they name,
// so a test can assert the row against the same array this screen renders.
// Film Academy is the existing hub — it already lists every training area; the
// other three are the named contest sections, which resolve against whatever
// contests the admin has published instead of hardcoded ids, so the shelf is
// correct the day a Rising Star contest is created without the app changing.

const MODULE_BY_ID = new Map<string, ServiceModule>(SERVICE_MODULES.map((m) => [m.id, m]));

// --- Landing-only block shapes ----------------------------------------------
// Eyebrow + headline section lead and the referral strip. They live in this
// screen because nothing else renders this composition. The promotional feature
// panel that used to sit here is now one slide of BannerCarousel, so the landing
// has no editorial card of its own any more.
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

export default function HomeScreen() {
  const [search, setSearch] = React.useState('');
  // Which wallet the hero card is showing. Defaults to naira, the currency the
  // rest of the app spends from.
  const [currency, setCurrency] = React.useState<HeroCurrency>('NGN');

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
  const showReferral = referral ? gate(registryKeyFor(referral.id)) : false;

  const contestRow = React.useMemo(
    () =>
      HOME_CONTEST_SERVICE_IDS
        .map((id) => MODULE_BY_ID.get(id))
        .filter((m): m is ServiceModule => Boolean(m))
        .filter((m) => gate(registryKeyFor(m.id))),
    [gate],
  );

  // The banner carousel under the referral strip. A banner is only ever as
  // publishable as the service it advertises: each slide rides that module's
  // registry key and taps into that module's own route (or, where the artwork
  // names a more specific screen, the route it declares), so /admin/modules
  // retires the artwork and the destination together. A banner whose module has
  // no tile, or whose route is gone, is dropped rather than left as a tap that
  // goes nowhere.
  const banners = React.useMemo(
    () =>
      LANDING_BANNERS
        .filter((b) => gate(registryKeyFor(b.moduleId)))
        .map((b) => {
          const route = b.routeOverride ?? MODULE_BY_ID.get(b.moduleId)?.route;
          if (!route) return null;
          return {
            id:       b.id,
            publicId: b.publicId,
            alt:      b.alt,
            onPress:  () => { try { router.push(route as never); } catch {} },
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [gate],
  );

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

  // The USD side of the hero card's currency switch, from the same read the FX
  // hub drives. NGN deliberately does NOT come from here: the dashboard read is
  // the KYC-gated primary with the Supabase fallback behind it, and that is the
  // figure the rest of the wallet screens agree on.
  const usdBalances = useBalances();

  // Redirect to login on auth failure (session expired / not logged in).
  React.useEffect(() => {
    if (error instanceof Error && error.message === 'Not authenticated') {
      router.replace('/(auth)/login');
    }
  }, [error]);

  const userName = data?.user.fullName?.split(' ')[0] ?? 'there';

  // The selected pot, in the major units BalanceCard renders. A USD wallet the
  // user simply does not hold comes back as a true 0 — the FX hub's own card
  // does the same, so the two screens cannot disagree.
  const usdPot = (usdBalances.data ?? []).find((b) => b.currency === 'USD');
  const balance = currency === 'NGN' ? (data?.wallet.balance ?? 0) : (usdPot?.available ?? 0) / 100;
  // Neither figure is known until its own read comes back, and a pending or
  // failed read is not an empty wallet: rendering ₦0.00 there would hide money
  // the user has, which is the exact failure the card's unavailable state
  // exists to avoid. NGN keeps the dashboard read's own balanceUnavailable too,
  // because that call can succeed while reporting that the wallet behind it
  // could not be read.
  const balanceUnavailable = currency === 'NGN'
    ? isLoading || isError || Boolean(data?.wallet.balanceUnavailable)
    : usdBalances.isLoading || usdBalances.isError;
  const unavailableHint = currency === 'NGN'
    ? 'Couldn’t load your balance — pull down to refresh'
    : 'Couldn’t load your USD wallet — pull down to refresh';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching || usdBalances.isRefetching} onRefresh={() => { refetch(); usdBalances.refetch(); }} tintColor={Colors.primary} />}
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

        {/* The hero card: gradient balance panel with the hide/show eye, the
            NGN|USD switch, the receive control and the four action tiles. It is
            the full card, not the compact strip, so every control on it is a
            control that goes somewhere — the pill switches wallets, the QR
            opens the collection accounts, and pull-to-refresh re-reads both
            balances. */}
        <BalanceCard
          balance={balance}
          currency={currency}
          balanceUnavailable={balanceUnavailable}
          unavailableHint={unavailableHint}
          currencies={[...HERO_CURRENCIES]}
          onSelectCurrency={(code) => setCurrency(code as HeroCurrency)}
          onPressQr={() => { try { router.push('/fx/receive' as never); } catch {} }}
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

        {/* Contests, on the row immediately after Event Tickets. Four tiles, one
            grid row. A section tile is only as live as the contest behind it, so
            the copy here never promises one is running. */}
        {contestRow.length > 0 ? (
          <>
            <SectionLead
              eyebrow="Entertainment"
              title="Contests"
              actionLabel="All contests"
              onAction={() => router.push('/voting')}
            />
            <ModuleGrid modules={contestRow} compact />
          </>
        ) : null}

        {showReferral && referral ? (
          <ReferralStrip label={referral.label} route={referral.route} />
        ) : null}

        {/* The promotional carousel, straight after Refer & Earn: five finished
            campaign banners, one per screen, each tapping through to the service
            it shows. It replaces the single Film Academy panel that used to sit
            here — that route is now one of the slides, so the landing does not
            offer it twice. */}
        <BannerCarousel banners={banners} />

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
});
