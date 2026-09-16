// ── AI Trading — module entry: Landing (pre-access) or Dashboard (post-access) ─
// §16A #1 (landing / honest risk framing / fee model) + #16 (portfolio dashboard)
// + #7 (KYC status). Access is decided ONLY by Module-KYC (decoupled from app
// tiers). Paper mode: the fund holds cash and mints/redeems units — no live venue
// trading — and all copy avoids any guaranteed-return language.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldAlert, TrendingUp, Wallet, Info, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useKyc, usePosition } from '@/features/aitrading/hooks';
import { formatNaira, formatUnits, type TradingKycStatus } from '@/features/aitrading/api';
import { HomeMenuButton } from '@/components/HomeMenu';

const STATUS_LABEL: Record<TradingKycStatus, string> = {
  NOT_STARTED: 'Not started', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved', REJECTED: 'Rejected', BYPASSED: 'Approved (manual)', EXPIRED: 'Expired',
};

export default function AiTradingHome() {
  const kyc = useKyc();
  const hasAccess = kyc.data?.hasAccess ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.topTitle}>AI Trading</Text>
        <HomeMenuButton />
      </View>

      {kyc.isLoading ? (
        <View style={styles.centre}><ActivityIndicator color={Colors.primary} /></View>
      ) : hasAccess ? (
        <Dashboard />
      ) : (
        <Landing status={kyc.data?.status ?? 'NOT_STARTED'} onRefresh={() => kyc.refetch()} refreshing={kyc.isFetching} />
      )}
    </SafeAreaView>
  );
}

// ── Landing (no access yet) ────────────────────────────────────────────────────
function Landing({ status, onRefresh, refreshing }: { status: TradingKycStatus; onRefresh: () => void; refreshing: boolean }) {
  const pending = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  return (
    <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}>
      <View style={styles.hero}>
        <TrendingUp size={28} color={Colors.primary} />
        <Text style={styles.heroTitle}>Autonomous AI portfolio management</Text>
        <Text style={styles.heroSub}>A disciplined, risk-first system manages a diversified fund on your behalf. Its first job is to protect capital — including deciding when not to trade.</Text>
      </View>

      {/* Honest, non-dismissible risk framing (§16A #1 / §0). */}
      <View style={[styles.card, styles.riskCard]}>
        <View style={styles.riskHead}><ShieldAlert size={18} color={Colors.error} /><Text style={styles.riskTitle}>You can lose money</Text></View>
        <Text style={styles.riskBody}>Trading carries real risk. You can lose some or all of the capital you deposit. Returns are never guaranteed, and past performance does not indicate future results. Only deposit what you can afford to lose.</Text>
      </View>

      <Section title="How it works">
        <Bullet>Capital preservation comes first — the system trades only high-conviction opportunities and holds cash otherwise.</Bullet>
        <Bullet>All risk limits and sizing are computed deterministically; AI reasons and explains, it never sets the numbers that move money.</Bullet>
        <Bullet>Every action is logged and explainable, and independent risk & safety checks can halt trading at any time.</Bullet>
      </Section>

      <Section title="Fees">
        <Row k="Subscription" v="Access to the service (see plan)" />
        <Row k="Performance fee" v="A share of new net profits only, above your high-water mark" />
        <Text style={styles.finePrint}>All performance figures shown in the app are net of fees. No fee is charged on losses or on recovering a prior loss.</Text>
      </Section>

      {/* Access CTA driven by Module-KYC status (§16A #7). */}
      <View style={{ marginTop: Spacing.md }}>
        {pending ? (
          <View style={[styles.card, styles.pendingCard]}>
            <Info size={18} color={Colors.primary} />
            <Text style={styles.pendingText}>Your Trading Access Verification is <Text style={{ fontWeight: '700' }}>{STATUS_LABEL[status].toLowerCase()}</Text>. We'll notify you when it's reviewed — this is separate from your app verification level.</Text>
          </View>
        ) : (
          <>
            <PrimaryButton label={status === 'REJECTED' || status === 'EXPIRED' ? 'Re-verify to continue' : 'Get started'} onPress={() => router.push('/ai-trading/kyc' as never)} />
            <Text style={styles.gateNote}><Lock size={12} color={Colors.onSurfaceVariant} /> Trading requires a separate verification, independent of your app tier.</Text>
          </>
        )}
      </View>

      <Pressable style={styles.manageLink} onPress={() => router.push('/ai-trading/strategies' as never)}>
        <TrendingUp size={16} color={Colors.primary} />
        <Text style={styles.manageLinkText}>How your fund is managed</Text>
        <Text style={styles.manageChevron}>›</Text>
      </Pressable>
      <View style={{ height: Spacing.xl }} />
    </ScrollView>
  );
}

// ── Dashboard (has access) ──────────────────────────────────────────────────────
function Dashboard() {
  const pos = usePosition();
  const p = pos.data;
  return (
    <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={pos.isFetching} onRefresh={() => pos.refetch()} tintColor={Colors.primary} />}>
      <View style={styles.modeBanner}>
        <Info size={14} color={Colors.onWarning ?? '#8A6D00'} />
        <Text style={styles.modeText}>Paper mode — the fund is in accounting/validation only. No live market trades are placed yet.</Text>
      </View>

      <View style={[styles.card, styles.navCard]}>
        <Text style={styles.navLabel}>Your holding value</Text>
        <Text style={styles.navValue}>{p ? formatNaira(p.valueKobo) : '—'}</Text>
        <View style={styles.navMetaRow}>
          <Meta k="Units" v={p ? formatUnits(p.units) : '—'} />
          <Meta k="Unit price (NAV)" v={p ? formatNaira(p.navPerUnitKobo) : '—'} />
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.action} onPress={() => router.push('/ai-trading/fund' as never)}>
          <Wallet size={20} color={Colors.primary} /><Text style={styles.actionText}>Fund</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push('/ai-trading/redeem' as never)}>
          <ArrowLeft size={20} color={Colors.primary} /><Text style={styles.actionText}>Withdraw</Text>
        </Pressable>
      </View>

      <View style={[styles.card, styles.riskCard]}>
        <Text style={styles.riskBody}>Your funds are held segregated from platform operating funds and are valued at the fund's current NAV. Withdrawals are paid at NAV, net of any fees. You can lose deposited capital.</Text>
      </View>

      <Pressable style={styles.manageLink} onPress={() => router.push('/ai-trading/strategies' as never)}>
        <TrendingUp size={16} color={Colors.primary} />
        <Text style={styles.manageLinkText}>How your fund is managed</Text>
        <Text style={styles.manageChevron}>›</Text>
      </Pressable>
      <View style={{ height: Spacing.xl }} />
    </ScrollView>
  );
}

// ── bits ───────────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.card}>{children}</View></View>;
}
function Bullet({ children }: { children: React.ReactNode }) {
  return <View style={styles.bulletRow}><Text style={styles.bulletDot}>•</Text><Text style={styles.bulletText}>{children}</Text></View>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.kvRow}><Text style={styles.kvKey}>{k}</Text><Text style={styles.kvVal}>{v}</Text></View>;
}
function Meta({ k, v }: { k: string; v: string }) {
  return <View><Text style={styles.metaKey}>{k}</Text><Text style={styles.metaVal}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  topTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.lg, gap: Spacing.md },
  hero: { gap: 8, marginBottom: Spacing.sm },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  riskCard: { borderColor: Colors.error, backgroundColor: '#FFF5F5' },
  riskHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  riskTitle: { ...Typography.labelLg, color: Colors.error, fontWeight: '800' },
  riskBody: { ...Typography.bodySm, color: Colors.onSurface },
  section: { gap: 8 },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  bulletDot: { color: Colors.primary, fontWeight: '800' },
  bulletText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  kvKey: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  kvVal: { ...Typography.bodySm, color: Colors.onSurface, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  finePrint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 6 },
  pendingCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderColor: Colors.primary, backgroundColor: '#F3F0FF' },
  pendingText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  gateNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 },
  modeBanner: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FFF8E1', borderColor: '#EAB308', borderWidth: 1, borderRadius: Radius.md, padding: Spacing.sm },
  modeText: { ...Typography.labelSm, color: '#8A6D00', flex: 1 },
  navCard: { alignItems: 'flex-start' },
  navLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  navValue: { ...Typography.headlineLg, color: Colors.onSurface, fontWeight: '800', marginVertical: 4 },
  navMetaRow: { flexDirection: 'row', gap: Spacing.xl, marginTop: 8 },
  metaKey: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaVal: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: Spacing.md },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: 14 },
  actionText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' },
  manageLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, marginTop: Spacing.md },
  manageLinkText: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '600', flex: 1 },
  manageChevron: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
});
