import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Building2, ChevronDown, Check, X, Store, ShieldCheck, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { useContext as usePropertyContext, useSwitchContext } from '@/features/property/hooks';
import type { ContextType, PropertyContext } from '@/features/property/types';

const TYPE_ICON: Record<ContextType, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  estate:   ShieldCheck,
  property: Building2,
  agency:   Briefcase,
  org:      Store,
};

const TYPE_LABEL: Record<ContextType, string> = {
  estate:   'Estate',
  property: 'Property',
  agency:   'Agency',
  org:      'Organisation',
};

/**
 * Reusable active-context picker shown in the Property hub top bar. Lets a user
 * switch which estate / property / agency / org scopes their Property experience.
 * Backed by /api/finance/property/context(+/switch) (mock-flagged).
 */
export default function ContextSwitcher() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = usePropertyContext();
  const switchCtx = useSwitchContext();

  const contexts = data?.contexts ?? [];
  const active = data?.activeContext
    ? contexts.find((c) => c.type === data.activeContext!.type && c.id === data.activeContext!.id)
    : undefined;

  const ActiveIcon = active ? TYPE_ICON[active.type] : Building2;

  const onSelect = (c: PropertyContext) => {
    if (switchCtx.isPending) return;
    switchCtx.mutate({ contextType: c.type, contextId: c.id });
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch active context"
        disabled={isLoading || contexts.length === 0}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <ActiveIcon size={16} color={Colors.primary} strokeWidth={2} />
        <Text style={styles.pillText} numberOfLines={1}>
          {active?.name ?? (isLoading ? 'Loading…' : 'No context')}
        </Text>
        <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Switch context</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Close">
                <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>
            <Text style={styles.sheetSub}>Choose the estate, property, agency or org to act within.</Text>

            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {contexts.map((c) => {
                const Icon = TYPE_ICON[c.type];
                const isActive = active?.type === c.type && active?.id === c.id;
                return (
                  <Pressable
                    key={`${c.type}:${c.id}`}
                    onPress={() => onSelect(c)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.row, isActive && styles.rowActive, pressed && styles.pressed]}
                  >
                    <View style={styles.rowIcon}>
                      <Icon size={18} color={Colors.primary} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {TYPE_LABEL[c.type]} · {c.roles.join(', ')}
                      </Text>
                    </View>
                    {isActive ? <Check size={18} color={Colors.teal} strokeWidth={2.5} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    maxWidth: 200,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  pillText: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1 },
  pressed: { opacity: 0.7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '70%',
    ...shadow1,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.md },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    marginBottom: Spacing.sm,
  },
  rowActive: { borderColor: Colors.teal },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowName: { ...Typography.labelLg, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
});
