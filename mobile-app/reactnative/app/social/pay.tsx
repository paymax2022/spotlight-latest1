import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AtSign, UserPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import { useCashtagSearch } from '@/features/social/hooks';
import { SocialColors, CASHTAG_REGEX } from '@/features/social/constants/social.constants';

export default function PayCashtag() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const results = useCashtagSearch(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const goSend = (handle: string) =>
    router.push({ pathname: '/social/send', params: { handle } });

  const validTyped = CASHTAG_REGEX.test(query);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pay a cashtag" />
      <View style={styles.searchWrap}>
        <TextInputField
          placeholder="@cashtag or name"
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          leftIcon={<AtSign size={18} color={SocialColors.muted} />}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.push('/social/contacts')} style={styles.contactsRow}>
          <View style={styles.contactsIcon}><UserPlus size={18} color={SocialColors.brand} /></View>
          <Text style={styles.contactsText}>Pick from contacts</Text>
        </Pressable>

        {results.isLoading ? (
          <View style={styles.loadingRow}><ActivityIndicator color={Colors.primary} /></View>
        ) : results.isError ? (
          <StateView kind="error" compact title="Search failed" actionLabel="Retry" onAction={() => results.refetch()} />
        ) : (results.data?.length ?? 0) === 0 ? (
          validTyped ? (
            <Pressable onPress={() => goSend(query)} style={styles.row}>
              <CashtagAvatar handle={query} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Pay {query.startsWith('@') ? query : `@${query}`}</Text>
                <Text style={styles.handle}>Tap to continue</Text>
              </View>
            </Pressable>
          ) : (
            <StateView kind="empty" compact title="No matches" message="Enter a valid @cashtag or search a name." icon="AtSign" />
          )
        ) : (
          <View style={styles.list}>
            {results.data!.map((c) => (
              <Pressable key={c.id} onPress={() => goSend(c.handle)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
                <CashtagAvatar name={c.displayName} handle={c.handle} color={c.avatarColor} verified={c.verified} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{c.displayName}</Text>
                  <Text style={styles.handle}>{c.handle}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  contactsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  contactsIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: SocialColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  contactsText: { ...Typography.labelLg, color: SocialColors.brand },
  loadingRow: { paddingVertical: Spacing.xl, alignItems: 'center' },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  name: { ...Typography.labelLg, color: SocialColors.text },
  handle: { ...Typography.bodySm, color: SocialColors.muted },
});
