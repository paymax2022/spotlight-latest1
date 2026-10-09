import React from 'react';
import { View, Text, Modal, Pressable, FlatList, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDirectory } from '@/features/association/hooks';
import { initials } from '@/features/association/utils';

interface Props {
  visible: boolean;
  /** Membership ids already on the committee (any status) — not offered again. */
  excludeIds: readonly string[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (membershipIds: string[]) => void;
}

/**
 * Pick association members to add to a committee.
 *
 * Lists ACTIVE members from the directory (its `id` is the assoc_memberships id
 * the add endpoint takes). The server only adds ACTIVE members of the
 * committee's own organisation and drops anything else without failing the
 * batch, so the caller reports the returned `added` count rather than assuming
 * every selection landed.
 */
export default function CommitteeMemberPicker({ visible, excludeIds, busy, onCancel, onSubmit }: Props) {
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Fresh selection every time it opens, so a cancelled pick never leaks into the next.
  React.useEffect(() => {
    if (!visible) return;
    setSearch('');
    setSelected(new Set());
  }, [visible]);

  const directory = useDirectory({ search: search.trim() || undefined, status: 'ACTIVE' });
  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds]);
  const candidates = React.useMemo(
    () => (directory.data ?? []).filter((m) => !excluded.has(m.id)),
    [directory.data, excluded],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const count = selected.size;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Add members</Text>
          <Pressable onPress={onCancel} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
            <X size={20} color={Colors.onSurface} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.searchWrap}>
          <SearchBar placeholder="Search by name or member ID…" value={search} onChangeText={setSearch} />
        </View>

        {directory.isLoading ? (
          <StateView kind="loading" message="Loading members…" />
        ) : directory.isError ? (
          <StateView kind="error" title="Couldn't load members" message="Please try again." actionLabel="Retry" onAction={() => directory.refetch()} />
        ) : candidates.length === 0 ? (
          <StateView
            kind="empty"
            icon="Users"
            title="No one to add"
            message={search ? `Nothing matches “${search}”.` : 'Every active member is already on this committee.'}
          />
        ) : (
          <FlatList
            data={candidates}
            keyExtractor={(m) => m.id}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  disabled={busy}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${item.fullName}, ${item.categoryLabel}`}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={styles.avatar}>
                    {item.photoUrl
                      ? <Image source={{ uri: item.photoUrl }} style={styles.avatarImg} />
                      : <Text style={styles.avatarText}>{initials(item.fullName)}</Text>}
                  </View>
                  <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={1}>{item.fullName}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.memberId}{item.profession ? ` · ${item.profession}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label={count === 0 ? 'Select members' : `Add ${count} member${count === 1 ? '' : 's'}`}
            onPress={() => onSubmit(Array.from(selected))}
            loading={busy}
            disabled={busy || count === 0}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  closeBtn: { padding: 4 },
  searchWrap: { marginBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.7 },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.labelMd, color: Colors.primary },
  body: { flex: 1 },
  name: { ...Typography.bodyMd, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
});
