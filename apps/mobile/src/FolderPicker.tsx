/**
 * 从文件夹树里选文件夹。single = 选一个（可选「顶层」）；multi = 选多个。
 */
import { flattenTree, type Folder } from '@memo/core';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Colors } from './theme';

/** 代表「顶层」（没有父文件夹）的选项。 */
export const ROOT = '__root__';

interface Props {
  title: string;
  folders: Folder[];
  multi?: boolean;
  /** 是否提供「顶层」选项（移动文件夹时用）。 */
  allowRoot?: boolean;
  /** 不能选的文件夹（比如移动文件夹时，它自己和它的后代）。 */
  disabled?: Set<string>;
  initial: string[];
  c: Colors;
  onDone: (selected: string[]) => void;
  onCancel: () => void;
}

export function FolderPicker({ title, folders, multi, allowRoot, disabled, initial, c, onDone, onCancel }: Props) {
  const [selected, setSelected] = useState<string[]>(initial);
  const rows = [
    ...(allowRoot ? [{ id: ROOT, name: '顶层', depth: 0 }] : []),
    ...flattenTree(folders).map(({ folder, depth }) => ({ id: folder.id, name: folder.name, depth })),
  ];

  const toggle = (id: string) => {
    if (!multi) {
      onDone([id]);
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { borderColor: c.line }]}>
        <Pressable style={styles.side} hitSlop={12} onPress={onCancel}>
          <Text style={[styles.barText, { color: c.quiet }]}>取消</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
        <Pressable style={[styles.side, styles.right]} hitSlop={12} onPress={() => onDone(selected)}>
          {multi && <Text style={[styles.barText, styles.strong, { color: c.ink }]}>完成</Text>}
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => {
          const off = disabled?.has(item.id) ?? false;
          const on = selected.includes(item.id);
          return (
            <Pressable
              disabled={off}
              onPress={() => toggle(item.id)}
              style={[styles.row, { paddingLeft: 20 + item.depth * 20, borderColor: c.line }]}
            >
              <Text style={[styles.name, { color: off ? c.line : c.ink }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.check, { color: c.accent }]}>{on ? '✓' : ''}</Text>
            </Pressable>
          );
        }}
      />
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
  side: { width: 56 },
  right: { alignItems: 'flex-end' },
  title: { fontSize: 16, fontWeight: '600' },
  barText: { fontSize: 16 },
  strong: { fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontSize: 16 },
  check: { fontSize: 17, width: 24, textAlign: 'right' },
});
