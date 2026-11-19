import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Building2, Check, ChevronDown, Search, X } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography, shadow1 } from '@/constants/tokens';
import StateView from '@/components/StateView';
import type { useAdminOrgScope } from '../hooks';

/**
 * The shape `useAdminOrgScope()` returns, read off the hook so this component
 * cannot drift from it.
 */
export type AdminOrgScopeState = ReturnType<typeof useAdminOrgScope>;

/**
 * Decides what an admin-console screen may show, based on the organisation it is
 * acting on.
 *
 * Every org-scoped admin read (`/admin/kpis`, `/admin/approvals`, `/admin/finance`,
 * `/admin/audit-log`, the member directory) needs an `org_id` from the console when
 * the signed-in admin is a platform super-admin — those accounts hold no
 * `assoc_memberships` row, so the backend's "fall back to the caller's own org"
 * path answers 404 and the screens rendered that as a bare "Couldn't load".
 * The screens under `app/association/admin` wrap their body in this gate, so:
 *
 *   - nothing org-scoped is fetched before a scope exists (`enabled` in the hooks),
 *   - a super-admin is asked which organisation they mean instead of shown an error,
 *   - the chosen organisation stays visible at the top of every screen, because a
 *     number with no org next to it can be read as any of the orgs it administers.
 *
 * A real per-org officer sees no prompt at all: their own org is the scope, which is
 * exactly what the console did before, so their screens are unchanged.
 */
export default function AdminOrgScopeGate({ scope, children }: { scope: AdminOrgScopeState; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // The scope itself could not be resolved and nothing org-scoped was ever sent,
  // so this is the error to show — not the screen's own, which would blame a
  // request that never happened. Checked before the loading branch because a
  // failed access call leaves the list in flight and would otherwise spin forever.
  if (scope.isError && !scope.orgId) {
    return (
      <StateView
        kind="error"
        title="Couldn't load your organisation access"
        message="Check your connection and try again."
        actionLabel="Retry"
        onAction={() => scope.retry()}
      />
    );
  }

  if (scope.isLoading || scope.isResolving) {
    return <StateView kind="loading" message="Loading your organisations…" />;
  }

  // Nothing to pick from. A real answer, not a race: the list came back empty.
  if (!scope.orgId && !scope.needsPick) {
    return (
      <StateView
        kind="empty"
        icon="Building2"
        title="No organisation to manage"
        message="Your admin role isn’t attached to an organisation yet, so there is nothing to show here."
      />
    );
  }

  if (scope.needsPick) {
    return (
      <>
        <PickPrompt onPress={() => setOpen(true)} />
        <OrgSheet open={open} scope={scope} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      {scope.isExplicit ? <ContextBar scope={scope} onChange={() => setOpen(true)} /> : null}
      {children}
      <OrgSheet open={open} scope={scope} onClose={() => setOpen(false)} />
    </>
  );
}

function PickPrompt({ onPress }: { onPress: () => void }) {
  return (
    <View style={[styles.prompt, shadow1]}>
      <View style={styles.promptIcon}><Building2 size={22} color={Colors.primary} strokeWidth={2} /></View>
      <Text style={styles.promptTitle}>Choose an organisation</Text>
      <Text style={styles.promptBody}>
        Your admin account covers more than one organisation, so pick the one whose members, approvals and dues you want to see.
      </Text>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Choose an organisation" style={({ pressed }) => [styles.promptBtn, pressed && styles.pressed]}>
        <Text style={styles.promptBtnText}>Choose organisation</Text>
        <ChevronDown size={16} color={Colors.onPrimary} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function ContextBar({ scope, onChange }: { scope: AdminOrgScopeState; onChange: () => void }) {
  return (
    <Pressable
      onPress={onChange}
      accessibilityRole="button"
      accessibilityLabel={`Managing ${scope.orgName ?? 'selected organisation'}. Change organisation`}
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
    >
      <View style={styles.barIcon}><Building2 size={16} color={Colors.primary} strokeWidth={2} /></View>
      <View style={styles.barTextWrap}>
        <Text style={styles.barEyebrow}>Managing</Text>
        <Text style={styles.barName} numberOfLines={1}>{scope.orgName ?? 'Organisation'}</Text>
      </View>
      <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

/**
 * The list of organisations the account can administer.
 *
 * Filtering happens here rather than as a second `search` request: the backend
 * already returns the picker's page (100 most recent, `ListAdminOrganisations`),
 * and the console needs that same list on every screen it visits, so a keystroke
 * would re-fetch a list it already has.
 */
function OrgSheet({ open, scope, onClose }: { open: boolean; scope: AdminOrgScopeState; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scope.orgs;
    return scope.orgs.filter((o) =>
      o.name.toLowerCase().includes(q)
        || (o.acronym ?? '').toLowerCase().includes(q)
        || o.category.toLowerCase().includes(q),
    );
  }, [query, scope.orgs]);

  const onPick = (id: string) => {
    scope.select(id);
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Choose organisation</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>Every number, member and record you open next belongs to the organisation you pick here.</Text>

          <View style={styles.search}>
            <Search size={16} color={Colors.outline} strokeWidth={1.8} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, acronym or category…"
              placeholderTextColor={Colors.outline}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {rows.length === 0 ? (
              <Text style={styles.noMatch}>Nothing matches “{query.trim()}”.</Text>
            ) : null}
            {rows.map((o) => {
              const isCurrent = o.id === scope.orgId;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onPick(o.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${o.name}`}
                  accessibilityState={{ selected: isCurrent }}
                  style={({ pressed }) => [styles.row, isCurrent && styles.rowCurrent, pressed && styles.pressed]}
                >
                  <View style={styles.rowIcon}><Building2 size={18} color={Colors.primary} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{o.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {o.category} · {o.memberCount.toLocaleString('en-NG')} members{o.verified ? '' : ' · unverified'}
                    </Text>
                  </View>
                  {isCurrent ? <Check size={18} color={Colors.teal} strokeWidth={2.5} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  prompt: {
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.sm,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  promptIcon: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  promptTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  promptBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  promptBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginTop: Spacing.xs, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full, backgroundColor: Colors.primary,
  },
  promptBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow,
  },
  barIcon: {
    width: 32, height: 32, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center',
  },
  barTextWrap: { flex: 1 },
  barEyebrow: { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700' as const },
  barName: { ...Typography.labelLg, color: Colors.onSurface },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Spacing.xl,
    maxHeight: '75%', ...shadow1,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.md },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, height: 44, marginBottom: Spacing.md,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  list: { flexGrow: 0 },
  noMatch: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingVertical: Spacing.md, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm,
  },
  rowCurrent: { borderColor: Colors.teal },
  rowIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  rowName: { ...Typography.labelLg, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
