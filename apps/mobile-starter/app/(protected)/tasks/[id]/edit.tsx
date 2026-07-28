// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTask, updateTaskStatus } from '@/api/tasks.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const PRIORITIES = ['low', 'medium', 'high'] as const;
const priorityColors = { low: colors.secondary.DEFAULT, medium: colors.secondary.amber, high: colors.secondary.red };

export default function EditTask() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id, estateId],
    queryFn: () => getTask(id, estateId),
    staleTime: 30_000,
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low'|'medium'|'high'>('medium');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setAssignee(task.assignee_name ?? '');
      setDueDate(task.due_date ?? '');
      setPriority(task.priority);
    }
  }, [task]);

  const mut = useMutation({
    mutationFn: () => updateTaskStatus(id, estateId, task?.status ?? 'todo'),
    onSuccess: () => {
      Alert.alert('Success', 'Task updated successfully');
      qc.invalidateQueries({ queryKey: ['task', id, estateId] });
      qc.invalidateQueries({ queryKey: ['tasks', estateId] });
      router.back();
    },
    onError: () => Alert.alert('Error', 'Failed to update task'),
  });

  if (isLoading) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Task</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Task</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} placeholder="Task title" placeholderTextColor={colors.neutral.placeholder} value={title} onChangeText={setTitle} />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.textarea]} placeholder="Describe the task..." placeholderTextColor={colors.neutral.placeholder} value={description} onChangeText={setDescription} multiline numberOfLines={4} textAlignVertical="top" />
        </View>

        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Assignee</Text>
            <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.neutral.placeholder} value={assignee} onChangeText={setAssignee} />
          </View>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Due Date</Text>
            <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.neutral.placeholder} value={dueDate} onChangeText={setDueDate} />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map(p => (
              <Pressable key={p} style={[styles.chip, priority === p && { backgroundColor: priorityColors[p], borderColor: priorityColors[p] }]} onPress={() => setPriority(p)}>
                <Text style={[styles.chipText, priority === p && { color: '#fff' }]}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable style={[styles.primaryBtn, mut.isPending && { opacity: 0.6 }]} onPress={() => mut.mutate()} disabled={mut.isPending || !title.trim()}>
          <Text style={styles.primaryBtnText}>{mut.isPending ? 'Saving...' : 'Save Changes'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  fieldGroup: { gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 110, paddingTop: 14 },
  chipRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center', backgroundColor: colors.neutral.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, textTransform: 'capitalize' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
