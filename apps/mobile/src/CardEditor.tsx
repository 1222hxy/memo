/**
 * 建卡 / 改卡。目前是最简单的「题目 + 答案」，以后换成自由的一页内容块 + 遮盖。
 * 新建时保存后不关闭，清空继续写下一张，方便连续录入；位置保持不变。
 * 卡片有一个主位置，还可以关联到其他文件夹。
 */
import type { Folder } from '@memo/core';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createSimpleCard,
  deleteCard,
  ensureDefaultFolder,
  getSetting,
  loadCard,
  loadFolders,
  loadPlacement,
  setPlacement,
  setSetting,
  updateSimpleCard,
} from './db/repo';
import { DEVICE } from './device';
import { FolderPicker } from './FolderPicker';
import type { Colors } from './theme';

interface Props {
  /** 有值 = 编辑这张卡；没有 = 新建。 */
  cardId?: string;
  /** 新建时放在哪个文件夹；不传则用上次用过的。 */
  folderId?: string;
  c: Colors;
  onClose: (changed: boolean) => void;
}

export function CardEditor({ cardId, folderId: initialFolder, c, onClose }: Props) {
  const db = useSQLiteContext();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [saved, setSaved] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [linked, setLinked] = useState<string[]>([]);
  const [picking, setPicking] = useState<'primary' | 'links' | null>(null);
  const placementChanged = useRef(false);
  const changed = useRef(false);
  const frontRef = useRef<TextInput>(null);

  useEffect(() => {
    (async () => {
      setFolders(await loadFolders(db));
      if (cardId) {
        const content = await loadCard(db, cardId);
        const [f, b] = content?.blocks ?? [];
        setFront(f?.content ?? '');
        setBack(b?.content ?? '');
        const placement = await loadPlacement(db, cardId);
        setFolderId(placement?.folderId ?? null);
        setLinked([...(placement?.linkedFolderIds ?? [])]);
        return;
      }
      const fallback = await ensureDefaultFolder(db);
      const last = await getSetting<string | null>(db, 'lastFolderId', null);
      const live = await loadFolders(db);
      setFolders(live);
      setFolderId(initialFolder ?? (last && live.some((f) => f.id === last) ? last : fallback));
    })();
  }, [db, cardId, initialFolder]);

  const nameOf = (id: string) => folders.find((f) => f.id === id)?.name ?? '';

  const canSave = front.trim() !== '' && back.trim() !== '' && folderId !== null;

  const save = async () => {
    if (!canSave || !folderId) return;
    const input = { front: front.trim(), back: back.trim() };
    changed.current = true;
    if (cardId) {
      await updateSimpleCard(db, cardId, input, DEVICE);
      if (placementChanged.current) await setPlacement(db, cardId, folderId, linked, DEVICE);
      onClose(true);
      return;
    }
    const memory = await createSimpleCard(db, folderId, input, DEVICE);
    if (linked.length > 0) await setPlacement(db, memory.cardId, folderId, linked, DEVICE);
    await setSetting(db, 'lastFolderId', folderId, DEVICE);
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
        <Text style={[styles.label, { color: c.quiet }]}>位置</Text>
        <View style={[styles.box, { borderColor: c.line }]}>
          <Pressable style={styles.place} onPress={() => setPicking('primary')}>
            <Text style={[styles.placeLabel, { color: c.quiet }]}>放在</Text>
            <Text style={[styles.placeValue, { color: c.ink }]} numberOfLines={1}>
              {folderId ? nameOf(folderId) : ''}
            </Text>
            <Text style={[styles.chevron, { color: c.quiet }]}>›</Text>
          </Pressable>
          <Pressable
            style={[styles.place, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}
            onPress={() => setPicking('links')}
          >
            <Text style={[styles.placeLabel, { color: c.quiet }]}>也出现在</Text>
            <Text style={[styles.placeValue, { color: linked.length ? c.ink : c.quiet }]} numberOfLines={1}>
              {linked.length ? linked.map(nameOf).join('、') : '无'}
            </Text>
            <Text style={[styles.chevron, { color: c.quiet }]}>›</Text>
          </Pressable>
        </View>
        {saved > 0 && !cardId && (
          <Text style={[styles.note, { color: c.quiet }]}>已保存 {saved} 张，可以接着写下一张。</Text>
        )}
        {cardId && (
          <Pressable onPress={remove} style={styles.delete}>
            <Text style={{ color: c.danger, fontSize: 15 }}>删除这张卡</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={picking !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicking(null)}>
        {picking && (
          <FolderPicker
            title={picking === 'primary' ? '放在' : '也出现在'}
            folders={folders}
            multi={picking === 'links'}
            disabled={folderId && picking === 'links' ? new Set([folderId]) : undefined}
            initial={picking === 'primary' ? (folderId ? [folderId] : []) : linked}
            c={c}
            onCancel={() => setPicking(null)}
            onDone={(ids) => {
              placementChanged.current = true;
              if (picking === 'primary' && ids[0]) {
                setFolderId(ids[0]);
                setLinked((l) => l.filter((x) => x !== ids[0]));
              } else if (picking === 'links') {
                setLinked(ids);
              }
              setPicking(null);
            }}
          />
        )}
      </Modal>
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
  box: { borderWidth: 1, borderRadius: 12 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  placeLabel: { fontSize: 15, width: 64 },
  placeValue: { flex: 1, fontSize: 16 },
  chevron: { fontSize: 20 },
  delete: { marginTop: 32, alignSelf: 'center', padding: 8 },
});
