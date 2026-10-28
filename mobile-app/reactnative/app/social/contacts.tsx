import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Send, HandCoins, UserPlus } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import { useContacts } from '@/features/social/hooks';
import { SocialColors } from '@/features/social/constants/social.constants';

export default function Contacts() {
  const contacts = useContacts();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase().replace(/^@/, '');
  const onPaymax = useMemo(() => {
    const list = contacts.data?.onPaymax ?? [];
    return q ? list.filter((c) => c.handle.includes(q) || c.displayName.toLowerCase().includes(q)) : list;
  }, [contacts.data, q]);
  const others = useMemo(() => {
    const list = contacts.data?.others ?? [];
    return q ? list.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)) : list;
  }, [contacts.data, q]);

  const invite = (name: string) =>
    Share.share({ message: `Hi ${name}, join me on Paymax to send and receive money instantly with a @cashtag.` }).catch(() => {});

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contacts" />
      <View style={styles.searchWrap}>
        <SearchBar placeholder="Search name, number or @cashtag" value={query} onChangeText={setQuery} />
      </View>

      {contacts.isLoading ? (
        <StateView kind="loading" message="Loading contacts…" />
      ) : contacts.isError ? (
        <StateView kind="error" title="Couldn't load contacts" actionLabel="Retry" onAction={() => contacts.refetch()} />
      ) : contacts.data?.access === 'denied' ? (
        <StateView
          kind="empty"
          title="Allow contacts access"
          message="Let Paymax read your phone contacts to find friends you can pay."
          icon="Users"
          actionLabel={Platform.OS === 'web' ? 'Try again' : 'Open settings'}
          onAction={() => (Platform.OS === 'web' ? contacts.refetch() : Linking.openSettings())}
        />
      ) : contacts.data?.access === 'unavailable' ? (
        <StateView
          kind="empty"
          title="Contacts not available here"
          message="Open Paymax on your phone to pick from your contacts, or send to a @cashtag."
          icon="Users"
          actionLabel="Send to a @cashtag"
          onAction={() => router.push('/social/send')}
        />
      ) : onPaymax.length === 0 && others.length === 0 ? (
        <StateView kind="empty" title="No contacts found" message="Try a different name or number." icon="Users" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {onPaymax.length > 0 && <Text style={styles.section}>On Paymax</Text>}
          {onPaymax.map((c) => (
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
          {others.length > 0 && <Text style={styles.section}>Invite to Paymax</Text>}
          {others.map((c) => (
            <View key={c.id} style={styles.row}>
              <CashtagAvatar name={c.name} handle={c.name} color={SocialColors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.handle}>{c.phone}</Text>
              </View>
              <Pressable onPress={() => invite(c.name)} style={styles.ghostBtn} accessibilityLabel={`Invite ${c.name}`}>
                <UserPlus size={18} color={SocialColors.brand} />
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
  section: { ...Typography.labelSm, color: SocialColors.muted, marginTop: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  name: { ...Typography.labelLg, color: SocialColors.text },
  handle: { ...Typography.bodySm, color: SocialColors.muted },
  ghostBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: SocialColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  payBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, height: 40, borderRadius: Radius.full, backgroundColor: SocialColors.brand },
  payBtnText: { ...Typography.labelSm, color: '#FFFFFF' },
});
