/**
 * 卡片库：逐层浏览文件夹，管理文件夹和卡片，选择复习范围。
 * 长按文件夹：重命名 / 移动 / 删除。
 */
import { descendantIds, folderPath, type Folder } from '@memo/core';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardEditor } from './CardEditor';
import {
  createFolder,
  deleteFolder,
  listFolderCards,
  loadFolders,
  moveFolder,
  renameFolder,
  type CardSummary,
} from './db/repo';
import { DEVICE } from './device';
import { FolderPicker, ROOT } from './FolderPicker';
import { useSync } from './sync/SyncProvider';
import type { Colors } from './theme';

interface Props {
  c: Colors;
  /** 当前复习范围，null = 全部。 */
  scope: string | null;
  onScope: (folderId: string | null) => void;
  /** changed = 卡片或文件夹有变动，复习页需要重新加载。 */
  onClose: (changed: boolean) => void;
}

type Row = { kind: 'folder'; folder: Folder } | { kind: 'card'; card: CardSummary };

export function LibrarySheet({ c, scope, onScope, onClose }: Props) {
  const db = useSQLiteContext();
  const { version } = useSync();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [editor, setEditor] = useState<{ cardId?: string; folderId?: string } | null>(null);
  const [moving, setMoving] = useState<Folder | null>(null);
  const changed = useRef(false);

  const here = path[path.length - 1] ?? null;
  const herefolder = folders.find((f) => f.id === here);

  const refresh = useCallback(async () => {
    setFolders(await loadFolders(db));
    setCards(here ? await listFolderCards(db, here) : []);
  }, [db, here]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const touched = async () => {
    changed.current = true;
    await refresh();
  };

  const rows: Row[] = [
    ...folders
      .filter((f) => f.parentId === here)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map((folder) => ({ kind: 'folder' as const, folder })),
    ...cards.map((card) => ({ kind: 'card' as const, card })),
  ];

  const newFolder = () =>
    Alert.prompt('新建文件夹', herefolder ? `放在「${herefolder.name}」里` : undefined, async (name) => {
      if (!name?.trim()) return;
      await createFolder(db, here, name.trim(), DEVICE);
      await touched();
    });

  const add = () => {
    if (!here) {
      newFolder();
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions({ options: ['写一张卡', '新建文件夹', '取消'], cancelButtonIndex: 2 }, (i) => {
      if (i === 0) setEditor({ folderId: here });
      if (i === 1) newFolder();
    });
  };

  const folderMenu = (f: Folder) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: f.name,
        options: ['重命名', '移动到…', '删除', '取消'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
      },
      (i) => {
        if (i === 0) {
          Alert.prompt(
            '重命名',
            undefined,
            async (name) => {
              if (!name?.trim()) return;
              await renameFolder(db, f.id, name.trim(), DEVICE);
              await touched();
            },
            'plain-text',
            f.name,
          );
        }
        if (i === 1) setMoving(f);
        if (i === 2) {
          deleteFolder(db, f.id, DEVICE).then(async (ok) => {
            if (!ok) Alert.alert('文件夹不是空的', '先把里面的卡片和子文件夹移走或删除，再删除它。');
            else {
              if (scope === f.id) onScope(null);
              await touched();
            }
          });
        }
      },
    );

  const finishMove = async (target: string) => {
    if (!moving) return;
    const parentId = target === ROOT ? null : target;
    setMoving(null);
    await moveFolder(db, moving.id, parentId, DEVICE);
    await touched();
  };

  const closeEditor = async (didChange: boolean) => {
    setEditor(null);
    if (didChange) await touched();
  };

  const crumbs = here ? folderPath(folders, here) : [];
  const scopeName = scope ? folders.find((f) => f.id === scope)?.name : null;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { borderColor: c.line }]}>
        <Pressable style={styles.side} hitSlop={12} onPress={() => (here ? setPath(path.slice(0, -1)) : null)}>
          {here && <Text style={[styles.barText, { color: c.quiet }]}>‹ 返回</Text>}
        </Pressable>
        <Text style={[styles.title, { color: c.ink }]} numberOfLines={1}>
          {herefolder?.name ?? '卡片库'}
        </Text>
        <View style={[styles.side, styles.right]}>
          <Pressable hitSlop={12} onPress={add}>
            <Text style={[styles.plus, { color: c.ink }]}>＋</Text>
          </Pressable>
          <Pressable hitSlop={12} onPress={() => onClose(changed.current)}>
            <Text style={[styles.barText, styles.strong, { color: c.ink }]}>完成</Text>
          </Pressable>
        </View>
      </View>

      {crumbs.length > 1 && (
        <Text style={[styles.crumbs, { color: c.quiet }]} numberOfLines={1}>
          {crumbs.map((f) => f.name).join(' / ')}
        </Text>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'folder' ? r.folder.id : r.card.cardId)}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: c.quiet }]}>
            {here ? '这里还是空的。点右上角 ＋ 写卡或建子文件夹。' : '点右上角 ＋ 建第一个文件夹。'}
          </Text>
        }
        renderItem={({ item }) =>
          item.kind === 'folder' ? (
            <Pressable
              style={[styles.row, { borderColor: c.line }]}
              onPress={() => setPath([...path, item.folder.id])}
              onLongPress={() => folderMenu(item.folder)}
            >
              <Text style={[styles.folderName, { color: c.ink }]} numberOfLines={1}>
                {item.folder.name}
              </Text>
              {scope === item.folder.id && <Text style={[styles.tag, { color: c.accent }]}>复习中</Text>}
              <Text style={[styles.chevron, { color: c.quiet }]}>›</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.row, { borderColor: c.line }]}
              onPress={() => setEditor({ cardId: item.card.cardId })}
            >
              <Text style={[styles.cardText, { color: c.ink }]} numberOfLines={1}>
                {item.card.preview || '（空白卡片）'}
              </Text>
              {item.card.linked && <Text style={[styles.tag, { color: c.quiet }]}>关联</Text>}
            </Pressable>
          )
        }
      />

      <View style={[styles.footer, { borderColor: c.line }]}>
        {here ? (
          scope === here ? (
            <Pressable onPress={() => onScope(null)}>
              <Text style={[styles.footerText, { color: c.accent }]}>正在只复习这个文件夹 · 改回全部</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => onScope(here)}>
              <Text style={[styles.footerText, { color: c.ink }]}>只复习这个文件夹</Text>
            </Pressable>
          )
        ) : scopeName ? (
          <Pressable onPress={() => onScope(null)}>
            <Text style={[styles.footerText, { color: c.accent }]}>正在只复习「{scopeName}」 · 改回全部</Text>
          </Pressable>
        ) : (
          <Text style={[styles.footerText, { color: c.quiet }]}>正在复习全部卡片</Text>
        )}
      </View>

      <Modal visible={editor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => closeEditor(false)}>
        {editor && <CardEditor cardId={editor.cardId} folderId={editor.folderId} c={c} onClose={closeEditor} />}
      </Modal>

      <Modal visible={moving !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMoving(null)}>
        {moving && (
          <FolderPicker
            title={`把「${moving.name}」移到`}
            folders={folders}
            allowRoot
            disabled={descendantIds(folders, moving.id)}
            initial={[moving.parentId ?? ROOT]}
            c={c}
            onDone={([target]) => target && finishMove(target)}
            onCancel={() => setMoving(null)}
          />
        )}
      </Modal>
    </View>
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
  side: { width: 96, flexDirection: 'row' },
  right: { justifyContent: 'flex-end', alignItems: 'center', gap: 18 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600' },
  barText: { fontSize: 16 },
  strong: { fontWeight: '600' },
  plus: { fontSize: 24, fontWeight: '300' },
  crumbs: { fontSize: 13, paddingHorizontal: 20, paddingTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderName: { flex: 1, fontSize: 17, fontWeight: '500' },
  cardText: { flex: 1, fontSize: 16 },
  chevron: { fontSize: 22 },
  tag: { fontSize: 12 },
  empty: { fontSize: 15, textAlign: 'center', padding: 40, lineHeight: 22 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 34 },
  footerText: { fontSize: 15, textAlign: 'center' },
});
