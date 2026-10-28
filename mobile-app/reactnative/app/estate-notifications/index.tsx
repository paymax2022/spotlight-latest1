import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Archive, ArchiveRestore, CheckCheck, Pin, PinOff, Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import {
  useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications,
  useSetNotificationArchived, useSetNotificationPinned,
} from '@/features/notifications/hooks';
import { CATEGORY_META } from '@/features/notifications/api';
import type { EstateNotification, InboxState, NotificationCategory } from '@/features/notifications/api';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';

const PAGE = 50;
// The feed answers with a page, and the estate surface caps one page at 200 rows. Growing the window
// rather than walking offsets keeps this screen stateless; past the cap the search box is the way to an
// older notice, and the footer says so instead of pretending the list is everything.
const WINDOW_MAX = 200;

export default function EstateNotificationsScreen() {
  const [state, setState] = useState<InboxState>('active');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [searchHint, setSearchHint] = useState('');
  const [windowSize, setWindowSize] = useState(PAGE);

  const params = useMemo(
    () => ({ state, ...(q ? { q } : {}), limit: windowSize, offset: 0 }),
    [state, q, windowSize],
  );
  const { data, isLoading, isError, refetch, isRefetching } = useNotifications(params);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archive = useSetNotificationArchived();
  const pin = useSetNotificationPinned();

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const unread = rows.filter((n) => !n.readAt).length;
  const archivedView = state === 'archived';

  const submitSearch = () => {
    const trimmed = term.trim();
    if (trimmed.length > 0 && trimmed.length < 2) {
      setSearchHint('Type at least 2 characters');
      return;
    }
    setSearchHint('');
    setQ(trimmed);
    setWindowSize(PAGE);
  };
  const clearSearch = () => { setTerm(''); setQ(''); setSearchHint(''); };

  const onPress = (n: EstateNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.deepLink) router.push(n.deepLink as never);
  };

  const renderItem = ({ item }: { item: EstateNotification }) => {
    const meta = CATEGORY_META[item.category as NotificationCategory] ?? CATEGORY_META.general;
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Bell;
    const read = !!item.readAt;
    const busy = archive.isPending || pin.isPending;
    return (
      <Pressable onPress={() => onPress(item)} accessibilityRole="button" style={({ pressed }) => [styles.card, !read && styles.cardUnread, pressed && styles.pressed]}>
        <View style={[styles.iconBox, !read && styles.iconBoxUnread]}><Icon size={20} color={read ? Colors.onSurfaceVariant : Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <Text style={[styles.title, !read && styles.titleUnread]} numberOfLines={1}>{item.title}</Text>
          {item.body ? <Text style={styles.bodyText} numberOfLines={2}>{item.body}</Text> : null}
          <Text style={styles.meta}>
            {meta.label} · {relativeTime(item.createdAt)}
            {item.archivedAt ? ` · archived ${relativeTime(item.archivedAt)}` : ''}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.pinned ? 'Unpin notification' : 'Keep this notification'}
            hitSlop={8}
            disabled={busy}
            onPress={() => pin.mutate({ id: item.id, pinned: !item.pinned })}
            style={[styles.action, item.pinned && styles.actionActive]}
          >
            {item.pinned ? <PinOff size={16} color={Colors.primary} strokeWidth={2} /> : <Pin size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.archivedAt ? 'Restore to inbox' : 'Archive notification'}
            hitSlop={8}
            disabled={busy}
            onPress={() => archive.mutate({ id: item.id, archived: !item.archivedAt })}
            style={styles.action}
          >
            {item.archivedAt
              ? <ArchiveRestore size={16} color={Colors.primary} strokeWidth={2} />
              : <Archive size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
          </Pressable>
          {!read ? <View style={styles.dot} /> : null}
        </View>
      </Pressable>
    );
  };

  const segments: { key: InboxState; label: string }[] = [
    { key: 'active', label: 'Inbox' },
    { key: 'archived', label: 'Archived' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" subtitle={unread > 0 ? `${unread} unread` : undefined} rightSlot={
        !archivedView && unread > 0 ? (
          <Pressable onPress={() => markAll.mutate()} accessibilityRole="button" accessibilityLabel="Mark all read" hitSlop={8} style={styles.allBtn}><CheckCheck size={20} color={Colors.secondary} strokeWidth={1.8} /></Pressable>
        ) : undefined
      } />

      <View style={styles.bar}>
        <View style={styles.tabs}>
          {segments.map((s) => (
            <Pressable key={s.key} accessibilityRole="button" onPress={() => { setState(s.key); setWindowSize(PAGE); }} style={[styles.tab, state === s.key && styles.tabActive]}>
              <Text style={[styles.tabText, state === s.key && styles.tabTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.search}>
          <Search size={16} color={Colors.outline} strokeWidth={2} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            placeholder="Search titles and bodies"
            placeholderTextColor={Colors.outline}
            style={styles.searchInput}
            accessibilityLabel="Search notifications"
          />
          {(term || q) ? (
            <Pressable onPress={clearSearch} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
              <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {searchHint ? <Text style={styles.hint}>{searchHint}</Text> : null}

      {isLoading ? <StateView kind="loading" message="Loading…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList
            data={rows}
            keyExtractor={(n) => n.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshing={isRefetching}
            onRefresh={refetch}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={
              q
                ? <StateView kind="empty" icon="SearchX" title="Nothing found" message={`No ${archivedView ? 'archived ' : ''}notification matches “${q}”.`} />
                : <StateView kind="empty" icon={archivedView ? 'Archive' : 'BellOff'} title={archivedView ? 'Nothing archived' : 'No notifications'} message={archivedView ? 'Notices you archive land here.' : "You're all caught up."} />
            }
            ListFooterComponent={
              total > rows.length
                ? (
                  <View style={styles.footer}>
                    <Text style={styles.footerText}>{`Showing ${rows.length} of ${total}${q ? ` matching “${q}”` : ''}`}</Text>
                    {windowSize < WINDOW_MAX
                      ? (
                        <Pressable accessibilityRole="button" onPress={() => setWindowSize((w) => Math.min(w + PAGE, WINDOW_MAX))} style={styles.moreBtn}>
                          <Text style={styles.moreText}>Load older</Text>
                        </Pressable>
                      )
                      : <Text style={styles.footerHint}>Search to reach notices older than this.</Text>}
                  </View>
                )
                : null
            }
          />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  allBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  tabs: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, padding: 3 },
  tab: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  tabActive: { backgroundColor: Colors.surfaceContainerLowest },
  tabText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabTextActive: { color: Colors.onSurface, fontWeight: '700' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest, paddingHorizontal: Spacing.sm },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  hint: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm, ...Typography.labelSm, color: Colors.error },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  cardUnread: { borderColor: Colors.primary },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconBoxUnread: { backgroundColor: Colors.iconBgPurple },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  titleUnread: { fontWeight: '700' },
  bodyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelSm, color: Colors.outline },
  actions: { alignItems: 'center', gap: 6 },
  action: { width: 30, height: 30, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  actionActive: { backgroundColor: Colors.iconBgPurple },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  footer: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  footerText: { ...Typography.labelSm, color: Colors.outline },
  footerHint: { ...Typography.labelSm, color: Colors.outline },
  moreBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  moreText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
});
