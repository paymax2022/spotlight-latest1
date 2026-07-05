import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Send, HandCoins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import { useContacts } from '@/features/social/hooks';
import { SocialColors } from '@/features/social/constants/social.constants';

export default function Contacts() {
  const contacts = useContacts();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = contacts.data ?? [];
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return list;
    return list.filter((c) => c.handle.includes(q) || c.displayName.toLowerCase().includes(q));
  }, [contacts.data, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contacts" />
      <View style={styles.searchWrap}>
        <SearchBar placeholder="Search name or @cashtag" value={query} onChangeText={setQuery} />
      </View>

      {contacts.isLoading ? (
        <StateView kind="loading" message="Loading contacts…" />
      ) : contacts.isError ? (
        <StateView kind="error" title="Couldn't load contacts" actionLabel="Retry" onAction={() => contacts.refetch()} />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" title="No contacts found" message="Try a different name or cashtag." icon="Users" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {filtered.map((c) => (
            <View key={c.id} style={styles.row}>
              <CashtagAvatar name={c.displayName} handle={c.handle} color={c.avatarColor} verified={c.verified} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.displayName}</Text>
                <Text style={styles.handle}>{c.handle}</Text>
              </View>
              <Pressable onPress={() => router.push({ pathname: '/social/request', params: { handle: c.handle } })} style={styles.ghostBtn} accessibilityLabel={`Request from ${c.handle}`}>
                <HandCoins size={18} color={SocialColors.brand} />
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: '/social/send', params: { handle: c.handle } })} style={styles.payBtn} accessibilityLabel={`Send to ${c.handle}`}>
                <Send size={16} color="#FFFFFF" />
                <Text style={styles.payBtnText}>Pay</Text>
              </Pressable>
            </View>
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  name: { ...Typography.labelLg, color: SocialColors.text },
  handle: { ...Typography.bodySm, color: SocialColors.muted },
  ghostBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: SocialColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  payBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, height: 40, borderRadius: Radius.full, backgroundColor: SocialColors.brand },
  payBtnText: { ...Typography.labelSm, color: '#FFFFFF' },
});
