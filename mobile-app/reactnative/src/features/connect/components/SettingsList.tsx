import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

export interface SettingsRowDef {
  icon: string;          // lucide name
  label: string;
  sub?: string;
  href?: string;
  onPress?: () => void;
  danger?: boolean;
  badge?: string;        // small trailing pill (e.g. tier label / status)
}

export interface SettingsGroupDef {
  title?: string;
  rows: SettingsRowDef[];
}

/** Grouped settings list — mirrors crowdfunding/settings/index.tsx card pattern. */
export default function SettingsList({ groups }: { groups: SettingsGroupDef[] }) {
  return (
    <>
      {groups.map((g, gi) => (
        <View key={g.title ?? `g${gi}`} style={styles.group}>
          {g.title ? <Text style={styles.groupTitle}>{g.title}</Text> : null}
          <View style={styles.card}>
            {g.rows.map((r, i, arr) => {
              const Icon =
                (Icons as unknown as Record<string, Icons.LucideIcon>)[r.icon] ?? Icons.Circle;
              return (
                <Pressable
                  key={r.label}
                  style={[styles.row, i < arr.length - 1 && styles.rowBorder]}
                  onPress={() => {
                    if (r.onPress) r.onPress();
                    else if (r.href) router.push(r.href as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={r.label}
                >
                  <View style={[styles.rowIcon, r.danger && styles.rowIconDanger]}>
                    <Icon size={18} color={r.danger ? Colors.error : Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowLabel, r.danger && styles.rowLabelDanger]}>{r.label}</Text>
                    {r.sub ? <Text style={styles.rowSub}>{r.sub}</Text> : null}
                  </View>
                  {r.badge ? (
                    <View style={styles.pill}>
                      <Text style={styles.pillText}>{r.badge}</Text>
                    </View>
                  ) : null}
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: Spacing.lg },
  groupTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: Colors.iconBgRed },
  rowBody: { flex: 1 },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowLabelDanger: { color: Colors.error },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pill: {
    backgroundColor: Colors.iconBgPurple,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  pillText: { ...Typography.caption, color: Colors.primary },
});
