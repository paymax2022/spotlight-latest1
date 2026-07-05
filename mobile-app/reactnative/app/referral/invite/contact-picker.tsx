import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { useContacts, useInviteContacts } from '@/features/referral/invite/hooks';
import type { InviteContact } from '@/features/referral/invite/types';

// M-INV-03 — Contact picker (consented): select contacts to invite.
export default function ContactPickerScreen() {
  const { data, isLoading, isError, refetch } = useContacts();
  const invite = useInviteContacts();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (!query.trim()) return list;
    return list.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  }, [data, query]);

  const toggle = (c: InviteContact) => {
    if (c.alreadyJoined) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
      return next;
    });
  };

  const onInvite = () => {
    invite.mutate(Array.from(selected), {
      onSuccess: (res) => { setDone(res.invited); setSelected(new Set()); },
    });
  };

  if (done != null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invite from contacts" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title={`${done} invite${done === 1 ? '' : 's'} sent`}
          message="We'll let you know when they sign up and start using Paymax."
          actionLabel="Track invites"
          onAction={() => router.replace('/referral/invite/tracking')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invite from contacts" />
      {isLoading ? (
        <StateView kind="loading" message="Loading contacts…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="We need permission to read your contacts." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Contact" title="No contacts" message="No contacts available to invite right now." />
      ) : (
        <>
          <View style={styles.header}>
            <DisclosureCard tone="info" body="We only use the contacts you pick, and only to send an invite. We never auto-message anyone." />
            <View style={{ marginTop: Spacing.sm }}>
              <SearchBar placeholder="Search contacts" value={query} onChangeText={setQuery} />
            </View>
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSel = selected.has(item.id);
              return (
                <Pressable
                  style={[styles.contact, item.alreadyJoined && styles.contactDisabled]}
                  onPress={() => toggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSel, disabled: item.alreadyJoined }}
                >
                  <View style={styles.avatar}><Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactPhone}>{item.alreadyJoined ? 'Already on Paymax' : item.phoneMasked}</Text>
                  </View>
                  {!item.alreadyJoined && (
                    <View style={[styles.checkbox, isSel && styles.checkboxOn]}>
                      {isSel && <Check size={14} color={Colors.onPrimary} strokeWidth={2.6} />}
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
          <View style={styles.footer}>
            <PrimaryButton
              label={selected.size ? `Invite ${selected.size} contact${selected.size === 1 ? '' : 's'}` : 'Select contacts'}
              onPress={onInvite}
              disabled={selected.size === 0}
              loading={invite.isPending}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerMargin },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 100, gap: Spacing.sm },
  contact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  contactDisabled: { opacity: 0.55 },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  contactName: { ...Typography.labelLg, color: Colors.onSurface },
  contactPhone: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.containerMargin, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
