import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  FlaskConical,
  House,
  Layers,
  FileText,
  RefreshCw,
  ChevronRight,
  ClipboardList,
  ShieldCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import LabTestCard from '@/features/health/lab/components/LabTestCard';
import LabStatusPill from '@/features/health/lab/components/LabStatusPill';
import { useTests, usePackages, useOrders } from '@/features/health/lab/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

const QUICK_ACTIONS = [
  { key: 'catalog', label: 'All tests', icon: FlaskConical, href: '/health/lab/catalog', bg: Colors.iconBgTeal, color: Colors.teal },
  { key: 'packages', label: 'Packages', icon: Layers, href: '/health/lab/packages', bg: Colors.iconBgBlue, color: Colors.secondary },
  { key: 'home', label: 'Home test', icon: House, href: '/health/lab/lab-select', bg: Colors.iconBgPurple, color: Colors.primary },
  { key: 'reports', label: 'Reports', icon: FileText, href: '/health/lab/reports', bg: Colors.iconBgGold, color: Colors.onWarning },
] as const;

export default function LabHomeScreen() {
  const { data: tests, isLoading, isError, refetch } = useTests();
  const { data: packages } = usePackages();
  const { data: orders } = useOrders();

  const activeOrder = (orders ?? []).find((o) => o.status !== 'RELEASED' && o.status !== 'CANCELLED');
  const popular = packages?.find((p) => p.popular);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Lab Tests"
        subtitle="Book tests & home sample collection"
        rightSlot={
          <Pressable onPress={() => router.push('/health/lab/test-status')} hitSlop={8} accessibilityLabel="My orders">
            <ClipboardList size={22} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      <SearchBar
        placeholder="Search tests, e.g. FBC, malaria…"
        editable={false}
        onPress={() => router.push('/health/lab/catalog')}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Quick actions */}
        <View style={styles.quickRow}>
          {QUICK_ACTIONS.map((a) => (
            <Pressable key={a.key} style={styles.quick} onPress={() => router.push(a.href)}>
              <View style={[styles.quickIcon, { backgroundColor: a.bg }]}>
                <a.icon size={20} color={a.color} strokeWidth={2} />
              </View>
              <Text style={styles.quickLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Active order */}
        {activeOrder ? (
          <Pressable
            style={[styles.activeCard, shadow1]}
            onPress={() => router.push({ pathname: '/health/lab/test-status', params: { id: activeOrder.id } })}
          >
            <View style={styles.activeHead}>
              <Text style={styles.activeTitle}>Your active order</Text>
              <LabStatusPill status={activeOrder.status} />
            </View>
            <Text style={styles.activeName}>{activeOrder.lines.map((l) => l.name).join(', ')}</Text>
            <Text style={styles.activeMeta}>{activeOrder.labName}</Text>
            <View style={styles.activeFoot}>
              <Text style={styles.activeLink}>Track status</Text>
              <ChevronRight size={16} color={Colors.secondary} strokeWidth={2} />
            </View>
          </Pressable>
        ) : null}

        {/* Featured package */}
        {popular ? (
          <Pressable
            style={[styles.pkgCard, shadow1]}
            onPress={() => router.push({ pathname: '/health/lab/packages', params: { id: popular.id } })}
          >
            <View style={styles.pkgBadge}>
              <Text style={styles.pkgBadgeText}>POPULAR</Text>
            </View>
            <Text style={styles.pkgName}>{popular.name}</Text>
            <Text style={styles.pkgDesc} numberOfLines={2}>
              {popular.description}
            </Text>
            <View style={styles.pkgFoot}>
              <Text style={styles.pkgPrice}>{formatNaira(popular.priceKobo)}</Text>
              <Text style={styles.pkgList}>{formatNaira(popular.listPriceKobo)}</Text>
              <Text style={styles.pkgTat}>· {popular.testCount} tests · {popular.tat}</Text>
            </View>
          </Pressable>
        ) : null}

        {/* NDPA trust line */}
        <View style={styles.trust}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.trustText}>
            All labs are MLSCN-verified. Results are encrypted and shared only with your consent.
          </Text>
        </View>

        {/* Popular tests */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Popular tests</Text>
          <Pressable onPress={() => router.push('/health/lab/catalog')}>
            <Text style={styles.sectionLink}>See all</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <StateView kind="loading" message="Loading tests…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load tests" message="Please try again." actionLabel="Retry" onAction={refetch} compact />
        ) : (tests ?? []).length === 0 ? (
          <StateView kind="empty" icon="FlaskConical" title="No tests available" message="Check back soon." compact />
        ) : (
          <View style={styles.list}>
            {(tests ?? []).slice(0, 5).map((t) => (
              <LabTestCard key={t.id} test={t} onPress={() => router.push({ pathname: '/health/lab/test/[id]', params: { id: t.id } })} />
            ))}
          </View>
        )}

        <Pressable style={styles.reorder} onPress={() => router.push('/health/lab/reorder')}>
          <RefreshCw size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.reorderText}>Reorder a previous test or set a screening reminder</Text>
          <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quick: { alignItems: 'center', gap: 6, flex: 1 },
  quickIcon: { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface },
  activeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  activeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  activeName: { ...Typography.titleMd, color: Colors.onSurface },
  activeMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  activeFoot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  activeLink: { ...Typography.labelMd, color: Colors.secondary },
  pkgCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  pkgBadge: { alignSelf: 'flex-start', backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  pkgBadgeText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  pkgName: { ...Typography.titleMd, color: Colors.onSurface },
  pkgDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pkgFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  pkgPrice: { ...Typography.titleMd, color: Colors.primary },
  pkgList: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  pkgTat: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  trust: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  trustText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionLink: { ...Typography.labelMd, color: Colors.secondary },
  list: { gap: Spacing.sm },
  reorder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  reorderText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
