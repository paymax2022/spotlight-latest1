import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { UserPlus, Copy, Check } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { confirmAsync } from '@/lib/confirm';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useMyStores, useStaff, useInviteStaff, useSetStaffStatus } from '@/features/restaurantmerchant/hooks';
import { resolveActiveOutlet } from '@/features/restaurantmerchant/activeOutlet';
import type { StaffMember } from '@/features/restaurantmerchant/types';

/**
 * Staff for ONE outlet.
 *
 * Authority is per (outlet, user) server-side, so this screen is always scoped to
 * a single shop — a manager at Lekki has nothing at Ikeja, and showing a combined
 * roster would imply otherwise.
 */
const ROLES: { role: StaffMember['role']; label: string; blurb: string }[] = [
  { role: 'MANAGER', label: 'Manager', blurb: 'Runs the outlet: menu, hours, staff, orders. Cannot see or change banking.' },
  { role: 'CASHIER', label: 'Cashier', blurb: 'Takes and progresses orders. No menu or staff access.' },
  { role: 'KITCHEN', label: 'Kitchen', blurb: 'Sees the queue and marks food ready. Cannot accept orders.' },
  { role: 'RIDER', label: 'Rider', blurb: 'Delivery only.' },
];

export default function StaffScreen() {
  const { outlet } = useLocalSearchParams<{ outlet?: string }>();
  const stores = useMyStores();
  const { active } = resolveActiveOutlet(stores.data, typeof outlet === 'string' ? outlet : null);
  const storeId = active?.id ?? '';

  const staff = useStaff(storeId);
  const invite = useInviteStaff(storeId);
  const setStatus = useSetStaffStatus(storeId);

  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('CASHIER');
  const [issued, setIssued] = useState<{ token: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const send = () => {
    if (!userId.trim()) return;
    invite.mutate(
      { userId: userId.trim(), role },
      {
        onSuccess: (inv) => { setIssued({ token: inv.token, role: inv.role }); setUserId(''); },
      },
    );
  };

  const changeStatus = async (m: StaffMember, next: StaffMember['status']) => {
    const verb = next === 'REMOVED' ? 'Remove' : next === 'SUSPENDED' ? 'Suspend' : 'Restore';
    const ok = await confirmAsync({
      title: `${verb} ${m.email || 'this person'}?`,
      message: next === 'ACTIVE'
        ? 'They regain access to this outlet immediately.'
        : 'They lose access to this outlet immediately.',
      confirmLabel: verb,
      destructive: next !== 'ACTIVE',
    });
    if (ok) setStatus.mutate({ userId: m.userId, status: next });
  };

  if (stores.isLoading) return <Shell><StateView kind="loading" title="Loading" /></Shell>;
  if (!active) {
    return (
      <Shell>
        <StateView kind="empty" icon="Store" title="No outlet yet"
          message="Create a restaurant before adding staff." />
      </Shell>
    );
  }

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.outlet}>{active.name}</Text>
        <Text style={styles.muted}>
          Access is per outlet. Someone you add here has no access to your other outlets.
        </Text>

        {/* The token appears exactly once — the server stores only its hash. */}
        {issued && (
          <View style={styles.tokenCard}>
            <Text style={styles.tokenTitle}>Invite created · {issued.role}</Text>
            <Text style={styles.muted}>
              Send this code to them now. It is shown once and cannot be retrieved again —
              if it is lost, invite them again.
            </Text>
            <Text style={styles.token} selectable>{issued.token}</Text>
            <Pressable
              style={styles.copyBtn}
              accessibilityRole="button"
              accessibilityLabel="Copy invite code"
              onPress={async () => {
                await Clipboard.setStringAsync(issued.token);
                setCopied(true);
              }}
            >
              {copied ? <Check size={15} color={Colors.primary} /> : <Copy size={15} color={Colors.primary} />}
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy code'}</Text>
            </Pressable>
            <Pressable onPress={() => { setIssued(null); setCopied(false); }} accessibilityRole="button">
              <Text style={styles.muted}>Done</Text>
            </Pressable>
          </View>
        )}

        {/* Invite */}
        <View style={styles.card}>
          <View style={styles.rowGap}>
            <UserPlus size={18} color={Colors.primary} />
            <Text style={styles.cardTitle}>Add someone</Text>
          </View>
          <Text style={styles.label}>Their Spotlight user ID</Text>
          <TextInput
            value={userId}
            onChangeText={setUserId}
            placeholder="They must already have a Spotlight account"
            placeholderTextColor={Colors.outline}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.label}>Role</Text>
          {ROLES.map((r) => (
            <Pressable
              key={r.role}
              onPress={() => setRole(r.role)}
              style={[styles.roleRow, role === r.role && styles.roleRowOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: role === r.role }}
            >
              <Text style={[styles.roleLabel, role === r.role && styles.roleLabelOn]}>{r.label}</Text>
              <Text style={styles.muted}>{r.blurb}</Text>
            </Pressable>
          ))}
          {invite.isError && (
            <Text style={styles.error}>
              {(invite.error as Error)?.message?.includes('owner')
                ? 'Only the owner can add a manager.'
                : 'Couldn’t create that invite. Check the user ID and try again.'}
            </Text>
          )}
          <PrimaryButton label="Create invite" onPress={send} loading={invite.isPending} disabled={!userId.trim()} />
        </View>

        {/* Roster */}
        <Text style={styles.section}>People with access</Text>
        {staff.isLoading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : staff.isError ? (
          <StateView kind="error" compact title="Couldn't load staff" actionLabel="Retry" onAction={() => staff.refetch()} />
        ) : (
          (staff.data ?? []).map((m) => (
            <View key={m.userId} style={styles.card}>
              <Text style={styles.memberName}>{m.email || m.userId}</Text>
              <Text style={styles.muted}>
                {m.role}
                {m.status !== 'ACTIVE' ? ` · ${m.status === 'INVITED' ? 'invite pending' : m.status.toLowerCase()}` : ''}
              </Text>
              {/* The owner row is system-managed: the server refuses to change it,
                  so offering the control here would only produce an error. */}
              {m.role !== 'OWNER' && (
                <View style={styles.actions}>
                  {m.status === 'SUSPENDED' ? (
                    <Pressable onPress={() => changeStatus(m, 'ACTIVE')} accessibilityRole="button">
                      <Text style={styles.action}>Restore</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => changeStatus(m, 'SUSPENDED')} accessibilityRole="button">
                      <Text style={styles.action}>Suspend</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => changeStatus(m, 'REMOVED')} accessibilityRole="button">
                    <Text style={[styles.action, styles.actionDanger]}>Remove</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Staff" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },
  outlet: { color: Colors.onSurface, fontSize: 18, fontWeight: '700' },
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  section: { color: Colors.onSurface, fontSize: 15, fontWeight: '700', marginTop: Spacing.sm },
  card: {
    gap: 6, padding: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest,
  },
  cardTitle: { color: Colors.onSurface, fontSize: 15, fontWeight: '700' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 10, color: Colors.onSurface,
  },
  roleRow: { gap: 2, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  roleRowOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  roleLabel: { color: Colors.onSurface, fontSize: 14, fontWeight: '600' },
  roleLabelOn: { color: Colors.primary },
  memberName: { color: Colors.onSurface, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  action: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  actionDanger: { color: Colors.error },
  error: { color: Colors.error, fontSize: 13 },
  tokenCard: {
    gap: 8, padding: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow,
  },
  tokenTitle: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  token: { color: Colors.onSurface, fontSize: 13, fontFamily: 'monospace' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
});
