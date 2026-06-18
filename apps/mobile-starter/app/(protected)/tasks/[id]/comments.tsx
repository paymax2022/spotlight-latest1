// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

interface Comment { id: string; author: string; initials: string; text: string; timestamp: string; }

const MOCK_COMMENTS: Comment[] = [
  { id: '1', author: 'Mr. Adebayo', initials: 'MA', text: 'I will start working on this today.', timestamp: '2 hours ago' },
  { id: '2', author: 'Secretary', initials: 'SC', text: 'Please ensure you document everything for the records.', timestamp: '1 hour ago' },
];

export default function TaskComments() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  const submit = () => {
    if (!text.trim()) return;
    setComments(prev => [...prev, {
      id: Date.now().toString(),
      author: 'You',
      initials: 'YO',
      text: text.trim(),
      timestamp: 'Just now',
    }]);
    setText('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Comments</Text>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.commentCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.initials}</Text>
              </View>
              <View style={styles.bubble}>
                <View style={styles.bubbleTop}>
                  <Text style={styles.authorName}>{item.author}</Text>
                  <Text style={styles.timestamp}>{item.timestamp}</Text>
                </View>
                <Text style={styles.commentText}>{item.text}</Text>
              </View>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Add a comment..."
            placeholderTextColor={colors.neutral.placeholder}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable style={[styles.sendBtn, !text.trim() && { opacity: 0.5 }]} onPress={submit} disabled={!text.trim()}>
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  listContent: { padding: 16, gap: 12, paddingBottom: 10 },
  commentCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary.DEFAULT + '22', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700', color: colors.primary.DEFAULT },
  bubble: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  bubbleTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  authorName: { fontSize: 13, fontWeight: '700', color: colors.neutral.text },
  timestamp: { fontSize: 11, color: colors.neutral.textMuted },
  commentText: { fontSize: 14, color: colors.neutral.text, lineHeight: 20 },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, backgroundColor: colors.neutral.surface, borderTopWidth: 1, borderTopColor: colors.neutral.border },
  input: { flex: 1, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: colors.neutral.text, maxHeight: 100 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
});
