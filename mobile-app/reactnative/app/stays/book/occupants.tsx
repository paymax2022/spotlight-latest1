import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useStaysStore } from '@/features/stays/store';
import type { Occupant } from '@/features/stays/types';
import { StaysColors } from '@/features/stays/constants/stays.constants';

export default function OccupantsScreen() {
  const { draft, leadGuest, occupants, setOccupants } = useStaysStore();
  const guests = draft?.guests ?? { adults: 1, children: 0, childrenAges: [], rooms: 1 };

  // Build the occupant slots: lead guest fills slot 0, plus remaining adults & children.
  const slots = useMemo(() => {
    const out: Occupant[] = [];
    for (let i = 0; i < guests.adults; i++) out.push({ fullName: '', type: 'adult' });
    guests.childrenAges.forEach((age) => out.push({ fullName: '', type: 'child', age }));
    if (leadGuest && out[0]) out[0] = { ...out[0], fullName: leadGuest.fullName };
    return out;
  }, [guests, leadGuest]);

  const [list, setList] = useState<Occupant[]>(occupants.length === slots.length ? occupants : slots);

  const update = (i: number, name: string) => {
    setList((prev) => prev.map((o, idx) => (idx === i ? { ...o, fullName: name } : o)));
  };

  const next = () => {
    setOccupants(list);
    router.push('/stays/book/addons');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Occupants" subtitle="Step 2 of 5 · who's staying" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.banner}>
          <Users size={16} color={StaysColors.brand} strokeWidth={2} />
          <Text style={styles.bannerText}>{guests.adults} adult{guests.adults > 1 ? 's' : ''}{guests.children > 0 ? ` · ${guests.children} child${guests.children > 1 ? 'ren' : ''}` : ''} across {guests.rooms} room{guests.rooms > 1 ? 's' : ''}</Text>
        </View>

        {list.map((o, i) => (
          <TextInputField
            key={i}
            label={i === 0 ? 'Lead guest (room 1)' : o.type === 'child' ? `Child${o.age != null ? ` · age ${o.age}` : ''}` : `Adult ${i + 1}`}
            value={o.fullName}
            onChangeText={(t) => update(i, t)}
            placeholder="Full name"
            autoCapitalize="words"
            editable={i !== 0}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to add-ons" onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
