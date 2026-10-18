/**
 * 建卡 / 改卡。目前是最简单的「题目 + 答案」，以后换成自由的一页内容块 + 遮盖。
 * 新建时保存后不关闭，清空继续写下一张，方便连续录入。
 */
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createSimpleCard, deleteCard, ensureDefaultFolder, loadCard, updateSimpleCard } from './db/repo';
import { DEVICE } from './device';
import type { Colors } from './theme';

interface Props {
  /** 有值 = 编辑这张卡；没有 = 新建。 */
  cardId?: string;
  c: Colors;
  onClose: (changed: boolean) => void;
}

export function CardEditor({ cardId, c, onClose }: Props) {
  const db = useSQLiteContext();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saved, setSaved] = useState(0);
  const changed = useRef(false);
  const frontRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!cardId) return;
    loadCard(db, cardId).then((content) => {
      const [f, b] = content?.blocks ?? [];
      setFront(f?.content ?? '');
      setBack(b?.content ?? '');
    });
  }, [db, cardId]);

  const canSave = front.trim() !== '' && back.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    const input = { front: front.trim(), back: back.trim() };
    changed.current = true;
    if (cardId) {
      await updateSimpleCard(db, cardId, input, DEVICE);
      onClose(true);
      return;
    }
    const folderId = await ensureDefaultFolder(db);
    await createSimpleCard(db, folderId, input, DEVICE);
    setFront('');
    setBack('');
    setSaved((n) => n + 1);
    frontRef.current?.focus();
  };

  const remove = () => {
    if (!cardId) return;
    Alert.alert('删除这张卡？', '它的复习记录会保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteCard(db, cardId, DEVICE);
          onClose(true);
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { borderColor: c.line }]}>
        <Pressable hitSlop={12} onPress={() => onClose(changed.current)}>
          <Text style={[styles.barText, { color: c.quiet }]}>{cardId ? '取消' : '完成'}</Text>
        </Pressable>
        <Text style={[styles.barTitle, { color: c.ink }]}>{cardId ? '编辑' : '新卡片'}</Text>
        <Pressable hitSlop={12} onPress={save} disabled={!canSave}>
          <Text style={[styles.barText, styles.strong, { color: canSave ? c.ink : c.line }]}>保存</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: c.quiet }]}>题目</Text>
        <TextInput
          ref={frontRef}
          style={[styles.input, { color: c.ink, borderColor: c.line }]}
          value={front}
          onChangeText={setFront}
          placeholder="想让自己回忆起什么？"
          placeholderTextColor={c.quiet}
          multiline
          autoFocus={!cardId}
        />
        <Text style={[styles.label, { color: c.quiet }]}>答案</Text>
        <TextInput
          style={[styles.input, { color: c.ink, borderColor: c.line }]}
          value={back}
          onChangeText={setBack}
          placeholder="揭示后看到的内容"
          placeholderTextColor={c.quiet}
          multiline
        />
        {saved > 0 && !cardId && (
          <Text style={[styles.note, { color: c.quiet }]}>已保存 {saved} 张，可以接着写下一张。</Text>
        )}
        {cardId && (
          <Pressable onPress={remove} style={styles.delete}>
            <Text style={{ color: c.danger, fontSize: 15 }}>删除这张卡</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { fontSize: 16, fontWeight: '600' },
  barText: { fontSize: 16 },
  strong: { fontWeight: '600' },
  body: { padding: 20, gap: 10 },
  label: { fontSize: 13, marginTop: 8 },
  input: {
    fontSize: 18,
    lineHeight: 26,
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    textAlignVertical: 'top',
  },
  note: { fontSize: 14, marginTop: 8 },
  delete: { marginTop: 32, alignSelf: 'center', padding: 8 },
});
