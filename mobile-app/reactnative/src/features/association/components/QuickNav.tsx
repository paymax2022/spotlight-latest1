import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import {
  IdCard, CreditCard, MessageCircle, CalendarDays, Ticket, ListTodo,
  Building2, FileText, Sparkles, Vote, Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

/**
 * The association module's navigation.
 *
 * Lives here rather than inside a screen because TWO screens need it and they
 * must not drift: the member hub (/association/home) and the discovery landing
 * (/association). Discovery previously offered no way into the module at all
 * beyond a single unlabelled ID-card icon in the header — every section below
 * was reachable only by already knowing the URL.
 */
export const ASSOCIATION_QUICK_ACTIONS = [
  { id: 'card', label: 'My card', icon: IdCard, to: '/association/card' },
  { id: 'dues', label: 'Dues', icon: CreditCard, to: '/association/dues' },
  { id: 'chat', label: 'Chat', icon: MessageCircle, to: '/association/chat' },
  { id: 'meetings', label: 'Meetings', icon: CalendarDays, to: '/association/meetings' },
  { id: 'events', label: 'Events', icon: Ticket, to: '/association/events' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, to: '/association/tasks' },
  { id: 'committees', label: 'Committees', icon: Building2, to: '/association/committees' },
  { id: 'documents', label: 'Documents', icon: FileText, to: '/association/documents' },
  { id: 'ai-notes', label: 'AI notes', icon: Sparkles, to: '/association/ai-notes' },
  { id: 'voting', label: 'Voting', icon: Vote, to: '/association/governance' },
  { id: 'directory', label: 'Directory', icon: Users, to: '/association/directory' },
] as const;

export type AssociationQuickAction = (typeof ASSOCIATION_QUICK_ACTIONS)[number];

interface QuickNavProps {
  /** Render a subset, in this order. Omit for the full menu. */
  only?: readonly AssociationQuickAction['id'][];
}

export default function QuickNav({ only }: QuickNavProps) {
  const items = only
    ? only
        .map((id) => ASSOCIATION_QUICK_ACTIONS.find((a) => a.id === id))
        .filter((a): a is AssociationQuickAction => Boolean(a))
    : ASSOCIATION_QUICK_ACTIONS;

  return (
    <View style={styles.row}>
      {items.map((a) => {
        const Icon = a.icon;
        return (
          <Pressable
            key={a.id}
            style={styles.action}
            onPress={() => router.push(a.to as never)}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <View style={styles.actionIcon}>
              <Icon size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: {
    flexBasis: '31%', flexGrow: 1, alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, paddingVertical: Spacing.md,
  },
  actionIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface },
});
