import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function FaqScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="FAQ" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load FAQ" actionLabel="Retry" onAction={refetch} />
      ) : c.faqs.length === 0 ? (
        <StateView kind="empty" icon="HelpCircle" title="No questions yet" message="There are no frequently asked questions for this campaign." />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {c.faqs.map((f) => {
            const isOpen = open === f.id;
            return (
              <Pressable key={f.id} style={styles.card} onPress={() => setOpen(isOpen ? null : f.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                <View style={styles.qRow}>
                  <Text style={styles.question}>{f.question}</Text>
                  {isOpen ? <ChevronUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <ChevronDown size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                </View>
                {isOpen && <Text style={styles.answer}>{f.answer}</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  question: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  answer: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
