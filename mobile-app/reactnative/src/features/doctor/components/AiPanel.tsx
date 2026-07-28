import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Sparkles, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  model:        string;            // AI model display label (from the envelope)
  disclaimer:   string;            // not-medical-advice copy (always rendered)
  generating?:  boolean;           // mutation isPending -> show spinner
  confidence?:  number;            // 0-100, shown once ready
  generatedAt?: string;            // ISO, shown once ready
  children?:    React.ReactNode;   // structured output slot (rendered when ready)
}

// New component: shared AI-assist panel chrome (model label + confidence +
// generating spinner + a content slot) plus the mandatory not-medical-advice
// disclaimer footer. No existing component renders the AiEnvelope generating /
// ready framing, so this is genuinely new; the three AI screens compose their
// output inside it.
export default function AiPanel({ model, disclaimer, generating, confidence, generatedAt, children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.card, generating && styles.cardGenerating]}>
        <View style={styles.head}>
          <View style={styles.modelTag}>
            <Sparkles size={14} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.model} numberOfLines={1}>{model}</Text>
          </View>
          {!generating && typeof confidence === 'number' && (
            <Text style={styles.confidence}>{confidence}% confidence</Text>
          )}
        </View>

        {generating ? (
          <View style={styles.generating}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.generatingText}>Generating draft...</Text>
          </View>
        ) : (
          <>
            {children}
            {!!generatedAt && (
              <Text style={styles.generatedAt}>
                Generated {new Date(generatedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </>
        )}
      </View>

      <View style={styles.disclaimer}>
        <ShieldAlert size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.disclaimerText}>{disclaimer}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:            { marginBottom: Spacing.md },
  card:            { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  cardGenerating:  { borderColor: Colors.primaryContainer, backgroundColor: Colors.primaryFixed },
  head:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.sm },
  modelTag:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flex: 1 },
  model:           { ...Typography.labelMd, color: Colors.primary },
  confidence:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  generating:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  generatingText:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  generatedAt:     { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  disclaimer:      { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, marginTop: Spacing.sm, paddingHorizontal: Spacing.xs },
  disclaimerText:  { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
});
